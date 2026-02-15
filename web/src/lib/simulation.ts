import type { Agent, AgentStatus, CelebrationType } from '@/types'

interface AgentPhase {
  durationMs: number
  status: AgentStatus
  tokenInPerSec: number
  tokenOutPerSec: number
  filePerSec?: number
  celebrationOnEnter?: CelebrationType
  toastOnEnter?: { type: 'info' | 'error' | 'success'; message: string }
}

interface AgentLoopScript {
  task: string
  loopMs: number
  offsetMs: number
  phases: AgentPhase[]
}

interface AgentCarryState {
  input: number
  output: number
  files: number
}

const SCRIPT_BY_AGENT_ID: Record<string, AgentLoopScript> = {
  'agent-1': {
    task: 'Refactoring auth middleware',
    loopMs: 48_000,
    offsetMs: 10_000, // start inside tool_calling
    phases: [
      { durationMs: 7_000, status: 'thinking', tokenInPerSec: 18, tokenOutPerSec: 8 },
      { durationMs: 16_000, status: 'tool_calling', tokenInPerSec: 120, tokenOutPerSec: 230, filePerSec: 0.14 },
      { durationMs: 14_000, status: 'streaming', tokenInPerSec: 185, tokenOutPerSec: 360, filePerSec: 0.04 },
      { durationMs: 6_000, status: 'waiting', tokenInPerSec: 20, tokenOutPerSec: 16 },
      {
        durationMs: 5_000,
        status: 'done',
        tokenInPerSec: 8,
        tokenOutPerSec: 10,
        celebrationOnEnter: 'confetti',
        toastOnEnter: { type: 'success', message: 'Claude #1 shipped auth middleware changes' },
      },
    ],
  },
  'agent-2': {
    task: 'Reviewing pull request #42',
    loopMs: 55_000,
    offsetMs: 16_000, // start in streaming
    phases: [
      { durationMs: 8_000, status: 'thinking', tokenInPerSec: 16, tokenOutPerSec: 10 },
      { durationMs: 22_000, status: 'streaming', tokenInPerSec: 155, tokenOutPerSec: 240, filePerSec: 0.03 },
      { durationMs: 12_000, status: 'tool_calling', tokenInPerSec: 115, tokenOutPerSec: 180, filePerSec: 0.12 },
      { durationMs: 8_000, status: 'streaming', tokenInPerSec: 145, tokenOutPerSec: 215, filePerSec: 0.02 },
      {
        durationMs: 5_000,
        status: 'done',
        tokenInPerSec: 9,
        tokenOutPerSec: 10,
        celebrationOnEnter: 'sparkles',
        toastOnEnter: { type: 'success', message: 'Claude #2 resolved pull request review' },
      },
    ],
  },
  'agent-3': {
    task: 'Adding API rate limiting',
    loopMs: 42_000,
    offsetMs: 10_000, // start in tool_calling
    phases: [
      { durationMs: 6_000, status: 'thinking', tokenInPerSec: 20, tokenOutPerSec: 8 },
      { durationMs: 14_000, status: 'tool_calling', tokenInPerSec: 138, tokenOutPerSec: 250, filePerSec: 0.18 },
      { durationMs: 10_000, status: 'streaming', tokenInPerSec: 170, tokenOutPerSec: 330, filePerSec: 0.04 },
      {
        durationMs: 4_000,
        status: 'error',
        tokenInPerSec: 28,
        tokenOutPerSec: 12,
        celebrationOnEnter: 'explosion',
        toastOnEnter: { type: 'error', message: 'Claude #3 hit a limiter regression' },
      },
      { durationMs: 4_000, status: 'tool_calling', tokenInPerSec: 120, tokenOutPerSec: 185, filePerSec: 0.2 },
      {
        durationMs: 4_000,
        status: 'done',
        tokenInPerSec: 8,
        tokenOutPerSec: 10,
        celebrationOnEnter: 'confetti',
        toastOnEnter: { type: 'success', message: 'Claude #3 stabilized API rate limiting' },
      },
    ],
  },
  'agent-4': {
    task: 'Writing unit tests for utils',
    loopMs: 60_000,
    offsetMs: 32_000, // start in streaming
    phases: [
      { durationMs: 10_000, status: 'thinking', tokenInPerSec: 14, tokenOutPerSec: 8 },
      { durationMs: 18_000, status: 'tool_calling', tokenInPerSec: 135, tokenOutPerSec: 228, filePerSec: 0.18 },
      { durationMs: 16_000, status: 'streaming', tokenInPerSec: 185, tokenOutPerSec: 345, filePerSec: 0.03 },
      { durationMs: 8_000, status: 'waiting', tokenInPerSec: 20, tokenOutPerSec: 12 },
      {
        durationMs: 8_000,
        status: 'done',
        tokenInPerSec: 8,
        tokenOutPerSec: 9,
        celebrationOnEnter: 'trophy',
        toastOnEnter: { type: 'success', message: 'Claude #4 test suite turned green' },
      },
    ],
  },
}

let anchorTimeMs: number | null = null
let previousTickMs: number | null = null
const lastPhaseIndexByAgentId = new Map<string, number>()
const carryByAgentId = new Map<string, AgentCarryState>()
let lastToastAtMs = 0

function ensureCarry(agentId: string): AgentCarryState {
  const existing = carryByAgentId.get(agentId)
  if (existing) return existing
  const next = { input: 0, output: 0, files: 0 }
  carryByAgentId.set(agentId, next)
  return next
}

function resolveScript(agent: Agent): AgentLoopScript {
  return (
    SCRIPT_BY_AGENT_ID[agent.id] ?? {
      task: agent.currentTask,
      loopMs: 45_000,
      offsetMs: 6_000,
      phases: [
        { durationMs: 8_000, status: 'thinking', tokenInPerSec: 18, tokenOutPerSec: 9 },
        { durationMs: 16_000, status: 'tool_calling', tokenInPerSec: 120, tokenOutPerSec: 210, filePerSec: 0.14 },
        { durationMs: 14_000, status: 'streaming', tokenInPerSec: 170, tokenOutPerSec: 300, filePerSec: 0.03 },
        { durationMs: 7_000, status: 'waiting', tokenInPerSec: 22, tokenOutPerSec: 15 },
      ],
    }
  )
}

function clampDeltaSeconds(deltaMs: number): number {
  return Math.min(2.25, Math.max(0.2, deltaMs / 1000))
}

function locatePhase(phases: readonly AgentPhase[], elapsedMs: number): {
  phaseIndex: number
  phase: AgentPhase
  elapsedInPhaseMs: number
} {
  let cursor = elapsedMs
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index]
    if (cursor < phase.durationMs) {
      return { phaseIndex: index, phase, elapsedInPhaseMs: cursor }
    }
    cursor -= phase.durationMs
  }
  const fallback = phases[phases.length - 1]
  return { phaseIndex: phases.length - 1, phase: fallback, elapsedInPhaseMs: fallback.durationMs - 1 }
}

function shouldEmitToast(now: number): boolean {
  if (now - lastToastAtMs < 5_000) return false
  lastToastAtMs = now
  return true
}

export interface SimulationUpdate {
  agentUpdates: Array<{ id: string; changes: Partial<Agent> }>
  toasts: Array<{ message: string; type: 'info' | 'error' | 'success' }>
}

export function simulateStep(agents: Agent[], now = Date.now()): SimulationUpdate {
  const updates: SimulationUpdate = { agentUpdates: [], toasts: [] }
  if (agents.length === 0) return updates

  if (anchorTimeMs === null) anchorTimeMs = now
  if (previousTickMs === null) previousTickMs = now
  const deltaSeconds = clampDeltaSeconds(now - previousTickMs)
  previousTickMs = now

  for (const agent of agents) {
    const script = resolveScript(agent)
    const elapsedInLoopMs = ((now - anchorTimeMs + script.offsetMs) % script.loopMs + script.loopMs) % script.loopMs
    const { phaseIndex, phase, elapsedInPhaseMs } = locatePhase(script.phases, elapsedInLoopMs)
    const lastPhaseIndex = lastPhaseIndexByAgentId.get(agent.id)
    const enteredPhase = lastPhaseIndex !== phaseIndex
    lastPhaseIndexByAgentId.set(agent.id, phaseIndex)

    const rhythm = 0.9 + 0.2 * (0.5 + 0.5 * Math.sin((elapsedInPhaseMs / phase.durationMs) * Math.PI * 2))
    const carry = ensureCarry(agent.id)

    carry.input += phase.tokenInPerSec * deltaSeconds * rhythm
    carry.output += phase.tokenOutPerSec * deltaSeconds * rhythm
    carry.files += (phase.filePerSec ?? 0) * deltaSeconds

    const inputDelta = Math.floor(carry.input)
    const outputDelta = Math.floor(carry.output)
    const filesDelta = Math.floor(carry.files)

    carry.input -= inputDelta
    carry.output -= outputDelta
    carry.files -= filesDelta

    const changes: Partial<Agent> = {}
    if (agent.status !== phase.status) changes.status = phase.status
    if (agent.currentTask !== script.task) changes.currentTask = script.task
    if (inputDelta > 0) changes.tokens_input = agent.tokens_input + inputDelta
    if (outputDelta > 0) changes.tokens_output = agent.tokens_output + outputDelta
    if (filesDelta > 0) changes.files_modified = agent.files_modified + filesDelta

    if (enteredPhase && phase.status === 'done') {
      changes.commitCount = agent.commitCount + 1
    }

    if (enteredPhase && phase.celebrationOnEnter) {
      changes.activeCelebration = phase.celebrationOnEnter
      changes.celebrationStartedAt = now
    }

    if (Object.keys(changes).length > 0) {
      updates.agentUpdates.push({ id: agent.id, changes })
    }

    if (enteredPhase && phase.toastOnEnter && shouldEmitToast(now)) {
      updates.toasts.push(phase.toastOnEnter)
    }
  }

  return updates
}
