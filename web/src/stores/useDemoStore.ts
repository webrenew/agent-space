import { create } from 'zustand'
import type { Agent } from '@/types'
import { randomAppearance } from '@/types'
import {
  resolveWorldTierConfig,
  type WorldTierEntityCaps,
  type WorldUnlockFlags,
} from '@/lib/world-tier-config'

interface Toast {
  id: string
  message: string
  type: 'info' | 'error' | 'success'
}

interface DemoState {
  agents: Agent[]
  selectedAgentId: string | null
  toasts: Toast[]
  sceneUnlocks: WorldUnlockFlags
  sceneCaps: WorldTierEntityCaps
  experimentalDecorationsEnabled: boolean

  selectAgent: (id: string | null) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  setVisibleAgentCap: (maxAgents: number) => void
  setSceneTierState: (unlocks: WorldUnlockFlags, caps: WorldTierEntityCaps) => void
  setExperimentalDecorationsEnabled: (enabled: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastIdCounter = 0
const BASE_WORLD_TIER = resolveWorldTierConfig(0)
const BASE_WORLD_CAPS = BASE_WORLD_TIER.caps
const BASE_WORLD_UNLOCKS = BASE_WORLD_TIER.unlocks
const MAX_DEMO_AGENTS = 8

const DEMO_AGENT_POOL: Agent[] = [
  {
    id: 'agent-1',
    name: 'Claude #1',
    agent_type: 'cli',
    model: 'claude-sonnet-4-5-20250929',
    status: 'tool_calling',
    currentTask: 'Refactoring auth middleware',
    tokens_input: 30200,
    tokens_output: 45100,
    files_modified: 44,
    commitCount: 6,
    deskIndex: 0,
    started_at: Date.now() - 180000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-2',
    name: 'Claude #2',
    agent_type: 'cli',
    model: 'claude-opus-4-6-20250915',
    status: 'streaming',
    currentTask: 'Reviewing pull request #42',
    tokens_input: 61800,
    tokens_output: 50000,
    files_modified: 43,
    commitCount: 5,
    deskIndex: 1,
    started_at: Date.now() - 420000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-3',
    name: 'Claude #3',
    agent_type: 'cli',
    model: 'claude-sonnet-4-5-20250929',
    status: 'tool_calling',
    currentTask: 'Adding API rate limiting',
    tokens_input: 17100,
    tokens_output: 24900,
    files_modified: 39,
    commitCount: 4,
    deskIndex: 2,
    started_at: Date.now() - 90000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-4',
    name: 'Claude #4',
    agent_type: 'cli',
    model: 'claude-haiku-4-5-20251001',
    status: 'streaming',
    currentTask: 'Writing unit tests for utils',
    tokens_input: 21600,
    tokens_output: 45900,
    files_modified: 40,
    commitCount: 5,
    deskIndex: 3,
    started_at: Date.now() - 60000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-5',
    name: 'Claude #5',
    agent_type: 'cli',
    model: 'claude-sonnet-4-5-20250929',
    status: 'thinking',
    currentTask: 'Refining ingestion retry strategy',
    tokens_input: 12900,
    tokens_output: 17500,
    files_modified: 24,
    commitCount: 3,
    deskIndex: 4,
    started_at: Date.now() - 150000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-6',
    name: 'Claude #6',
    agent_type: 'cli',
    model: 'claude-opus-4-6-20250915',
    status: 'tool_calling',
    currentTask: 'Hardening webhook dedupe path',
    tokens_input: 22100,
    tokens_output: 19800,
    files_modified: 29,
    commitCount: 4,
    deskIndex: 5,
    started_at: Date.now() - 210000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-7',
    name: 'Claude #7',
    agent_type: 'cli',
    model: 'claude-haiku-4-5-20251001',
    status: 'streaming',
    currentTask: 'Drafting migration checklist',
    tokens_input: 9700,
    tokens_output: 11300,
    files_modified: 18,
    commitCount: 2,
    deskIndex: 6,
    started_at: Date.now() - 85000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
  {
    id: 'agent-8',
    name: 'Claude #8',
    agent_type: 'cli',
    model: 'claude-sonnet-4-5-20250929',
    status: 'thinking',
    currentTask: 'Tracing release metadata mismatch',
    tokens_input: 10800,
    tokens_output: 12600,
    files_modified: 16,
    commitCount: 2,
    deskIndex: 7,
    started_at: Date.now() - 132000,
    appearance: randomAppearance(),
    activeCelebration: null,
    celebrationStartedAt: null,
  },
]

function clampVisibleAgentCount(maxAgents: number): number {
  if (!Number.isFinite(maxAgents)) return BASE_WORLD_CAPS.maxAgents
  const floored = Math.floor(maxAgents)
  const boundedByPool = Math.min(floored, MAX_DEMO_AGENTS, DEMO_AGENT_POOL.length)
  return Math.max(BASE_WORLD_CAPS.maxAgents, boundedByPool)
}

export const useDemoStore = create<DemoState>((set) => ({
  agents: DEMO_AGENT_POOL.slice(0, BASE_WORLD_CAPS.maxAgents),
  selectedAgentId: null,
  toasts: [],
  sceneUnlocks: { ...BASE_WORLD_UNLOCKS },
  sceneCaps: { ...BASE_WORLD_CAPS },
  experimentalDecorationsEnabled: true,

  selectAgent: (id) => set({ selectedAgentId: id }),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    })),

  setVisibleAgentCap: (maxAgents) =>
    set((state) => {
      const nextVisibleCount = clampVisibleAgentCount(maxAgents)
      if (nextVisibleCount === state.agents.length) return state

      const currentById = new Map(state.agents.map((agent) => [agent.id, agent]))
      const nextAgents = DEMO_AGENT_POOL
        .slice(0, nextVisibleCount)
        .map((agent) => currentById.get(agent.id) ?? { ...agent })

      const selectedAgentStillVisible =
        state.selectedAgentId !== null &&
        nextAgents.some((agent) => agent.id === state.selectedAgentId)

      return {
        agents: nextAgents,
        selectedAgentId: selectedAgentStillVisible ? state.selectedAgentId : null,
      }
    }),

  setSceneTierState: (unlocks, caps) =>
    set({
      sceneUnlocks: { ...unlocks },
      sceneCaps: { ...caps },
    }),

  setExperimentalDecorationsEnabled: (enabled) =>
    set({ experimentalDecorationsEnabled: enabled }),

  addToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: `toast-${++toastIdCounter}` },
      ].slice(-5),
    })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}))
