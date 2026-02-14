export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool_calling'
  | 'waiting'
  | 'error'
  | 'done'

export type AgentType = 'cursor' | 'cli' | 'mcp' | 'copilot'

export type CelebrationType =
  | 'confetti'
  | 'rocket'
  | 'sparkles'
  | 'explosion'
  | 'trophy'
  | 'pizza_party'
  | 'floppy_rain'
  | 'dialup_wave'
  | 'fax_blast'

export type HairStyle = 'short' | 'long' | 'ponytail' | 'buzz' | 'mohawk'

export interface AgentAppearance {
  shirtColor: string
  hairColor: string
  hairStyle: HairStyle
  skinTone: string
  pantsColor: string
  gender: 'masculine' | 'feminine'
}

export interface Agent {
  id: string
  name: string
  agent_type: AgentType
  status: AgentStatus
  currentTask: string
  model: string
  tokens_input: number
  tokens_output: number
  files_modified: number
  started_at: number
  deskIndex: number
  appearance: AgentAppearance
  commitCount: number
  activeCelebration: CelebrationType | null
  celebrationStartedAt: number | null
}

const SHIRT_COLORS = ['#4fa3f7', '#4ade80', '#a78bfa', '#fb923c', '#f87171', '#22d3ee', '#e879f9', '#facc15', '#34d399', '#f472b6']
const HAIR_COLORS = ['#1a1a2e', '#3b2f1e', '#8b4513', '#d4a574', '#c0392b', '#e8e0d4', '#6b4c9a', '#2563eb']
const SKIN_TONES = ['#ffdbb4', '#f5c6a0', '#d4a373', '#a67b5b', '#8d5524', '#6b3e26']
const PANTS_COLORS = ['#4a5568', '#1e293b', '#3f3f46', '#1e3a5f', '#4a3728', '#2d2d44']
const HAIR_STYLES: HairStyle[] = ['short', 'long', 'ponytail', 'buzz', 'mohawk']

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomAppearance(): AgentAppearance {
  return {
    shirtColor: randomFrom(SHIRT_COLORS),
    hairColor: randomFrom(HAIR_COLORS),
    hairStyle: randomFrom(HAIR_STYLES),
    skinTone: randomFrom(SKIN_TONES),
    pantsColor: randomFrom(PANTS_COLORS),
    gender: Math.random() > 0.5 ? 'feminine' : 'masculine'
  }
}

export const AGENT_COLORS: Record<AgentType, string> = {
  cursor: '#4fa3f7',
  cli: '#4ade80',
  mcp: '#a78bfa',
  copilot: '#fb923c'
}

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking...',
  streaming: 'Streaming',
  tool_calling: 'Tool Call',
  waiting: 'Waiting',
  error: 'Error!',
  done: 'Done'
}
