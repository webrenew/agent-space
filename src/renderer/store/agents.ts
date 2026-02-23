import { create } from 'zustand'
import type { Agent, AgentEvent, TokenSnapshot } from '../types'

export interface TerminalInfo {
  id: string
  label: string
  isClaudeRunning: boolean
  scopeId: string | null
  cwd: string | null
  needsInput?: boolean
  needsInputReason?: string
}

export interface ChatSessionInfo {
  id: string
  label: string
  agentId: string | null
  claudeConversationId: string
  scopeId: string | null
  workingDirectory: string | null
  directoryMode: 'workspace' | 'custom'
}

interface AgentStore {
  // Terminal state (tabs — always present)
  terminals: TerminalInfo[]
  activeTerminalId: string | null
  addTerminal: (info: TerminalInfo) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string | null) => void
  updateTerminal: (id: string, updates: Partial<TerminalInfo>) => void

  // Chat session state (tabs — mirrors terminal pattern)
  chatSessions: ChatSessionInfo[]
  activeChatSessionId: string | null
  addChatSession: (info: ChatSessionInfo) => void
  removeChatSession: (id: string) => void
  setActiveChatSession: (id: string | null) => void
  updateChatSession: (id: string, updates: Partial<ChatSessionInfo>) => void

  // Agent state (3D characters — only when Claude is running)
  agents: Agent[]
  selectedAgentId: string | null
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  removeAgent: (idOrTerminalId: string) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  selectAgent: (id: string | null) => void
  getNextDeskIndex: () => number

  // Toasts
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void
  removeToast: (id: string) => void

  // Events
  events: AgentEvent[]
  addEvent: (event: Omit<AgentEvent, 'id' | 'timestamp'>) => void
  clearEvents: () => void

  // Navigation
  focusAgentTerminal: (agentId: string) => void

  // Token tracking
  recordTokenSnapshot: (id: string) => void
  recordModelTokens: (id: string, model: string, input: number, output: number) => void
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'error' | 'success' | 'attention'
  timestamp: number
  action?: { label: string; handler: () => void }
  persistent?: boolean
}

let toastCounter = 0
let eventCounter = 0
const CHAT_STATE_KEY = 'agent-observer:chatState'
const TEMP_SMOKE_PATTERN = /(?:^|\/)agent-observer-smoke-[^/]+(?:\/|$)/

interface PersistedChatSession {
  id: string
  label: string
  claudeConversationId: string
  scopeId: string | null
  workingDirectory: string | null
  directoryMode: 'workspace' | 'custom'
}

interface PersistedChatState {
  sessions: PersistedChatSession[]
  activeId: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizePath(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function createConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16)
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

function isConversationId(value: string | null | undefined): value is string {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isEphemeralSmokeWorkspace(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (!TEMP_SMOKE_PATTERN.test(normalized)) return false
  return normalized.startsWith('/var/folders/') || normalized.startsWith('/tmp/')
}

function normalizePersistedChatSession(value: unknown): PersistedChatSession | null {
  if (!isObject(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null

  const labelRaw = typeof value.label === 'string' ? value.label.trim() : ''
  const label = labelRaw.length > 0 ? labelRaw : 'Chat'
  const conversationIdRaw = typeof value.claudeConversationId === 'string'
    ? value.claudeConversationId.trim()
    : ''
  const claudeConversationId = isConversationId(conversationIdRaw)
    ? conversationIdRaw
    : createConversationId()
  const scopeId = typeof value.scopeId === 'string' ? value.scopeId : null
  const workingDirectoryCandidate = normalizePath(
    typeof value.workingDirectory === 'string' ? value.workingDirectory : null
  )
  const workingDirectory = workingDirectoryCandidate && !isEphemeralSmokeWorkspace(workingDirectoryCandidate)
    ? workingDirectoryCandidate
    : null
  let directoryMode: 'workspace' | 'custom' = value.directoryMode === 'custom' ? 'custom' : 'workspace'
  if (!workingDirectory && directoryMode === 'custom') directoryMode = 'workspace'

  return {
    id,
    label,
    claudeConversationId,
    scopeId,
    workingDirectory,
    directoryMode,
  }
}

function loadPersistedChatState(): {
  chatSessions: ChatSessionInfo[]
  activeChatSessionId: string | null
} {
  try {
    const raw = localStorage.getItem(CHAT_STATE_KEY)
    if (!raw) return { chatSessions: [], activeChatSessionId: null }
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || !Array.isArray(parsed.sessions)) {
      return { chatSessions: [], activeChatSessionId: null }
    }

    const deduped = new Map<string, PersistedChatSession>()
    for (const candidate of parsed.sessions) {
      const normalized = normalizePersistedChatSession(candidate)
      if (!normalized) continue
      deduped.set(normalized.id, normalized)
    }

    const chatSessions: ChatSessionInfo[] = Array.from(deduped.values()).map((session) => ({
      ...session,
      agentId: null,
    }))

    const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null
    const activeChatSessionId = activeId && chatSessions.some((session) => session.id === activeId)
      ? activeId
      : chatSessions[chatSessions.length - 1]?.id ?? null

    return { chatSessions, activeChatSessionId }
  } catch {
    return { chatSessions: [], activeChatSessionId: null }
  }
}

function savePersistedChatState(
  chatSessions: ChatSessionInfo[],
  activeChatSessionId: string | null
): void {
  try {
    const sessions: PersistedChatSession[] = chatSessions.map((session) => {
      const workingDirectoryCandidate = normalizePath(session.workingDirectory)
      const workingDirectory = workingDirectoryCandidate && !isEphemeralSmokeWorkspace(workingDirectoryCandidate)
        ? workingDirectoryCandidate
        : null
      const directoryMode: 'workspace' | 'custom' =
        workingDirectory && session.directoryMode === 'custom' ? 'custom' : 'workspace'
      const claudeConversationId = isConversationId(session.claudeConversationId)
        ? session.claudeConversationId
        : createConversationId()

      return {
        id: session.id,
        label: session.label,
        claudeConversationId,
        scopeId: session.scopeId,
        workingDirectory,
        directoryMode,
      }
    })

    const payload: PersistedChatState = {
      sessions,
      activeId: activeChatSessionId && sessions.some((session) => session.id === activeChatSessionId)
        ? activeChatSessionId
        : sessions[sessions.length - 1]?.id ?? null,
    }

    localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.error('[agents] Failed to persist chat sessions:', err)
  }
}

const hydratedChatState = loadPersistedChatState()

export const useAgentStore = create<AgentStore>((set, get) => ({
  // Terminals
  terminals: [],
  activeTerminalId: null,

  addTerminal: (info) =>
    set((state) => ({
      terminals: [...state.terminals, info],
      activeTerminalId: info.id
    })),

  removeTerminal: (id) =>
    set((state) => {
      const remaining = state.terminals.filter((t) => t.id !== id)
      return {
        terminals: remaining,
        activeTerminalId:
          state.activeTerminalId === id
            ? remaining[remaining.length - 1]?.id ?? null
            : state.activeTerminalId
      }
    }),

  setActiveTerminal: (id) => set({ activeTerminalId: id }),

  updateTerminal: (id, updates) =>
    set((state) => ({
      terminals: state.terminals.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),

  // Chat sessions
  chatSessions: hydratedChatState.chatSessions,
  activeChatSessionId: hydratedChatState.activeChatSessionId,

  addChatSession: (info) =>
    set((state) => {
      const normalizedInfo: ChatSessionInfo = {
        ...info,
        claudeConversationId: isConversationId(info.claudeConversationId)
          ? info.claudeConversationId
          : createConversationId(),
      }
      const chatSessions = [...state.chatSessions, normalizedInfo]
      const activeChatSessionId = normalizedInfo.id
      savePersistedChatState(chatSessions, activeChatSessionId)
      return { chatSessions, activeChatSessionId }
    }),

  removeChatSession: (id) =>
    set((state) => {
      const remaining = state.chatSessions.filter((s) => s.id !== id)
      const activeChatSessionId =
        state.activeChatSessionId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : state.activeChatSessionId
      savePersistedChatState(remaining, activeChatSessionId)
      return {
        chatSessions: remaining,
        activeChatSessionId
      }
    }),

  setActiveChatSession: (id) =>
    set((state) => {
      const activeChatSessionId =
        id && state.chatSessions.some((session) => session.id === id)
          ? id
          : id === null
            ? null
            : state.activeChatSessionId
      savePersistedChatState(state.chatSessions, activeChatSessionId)
      return { activeChatSessionId }
    }),

  updateChatSession: (id, updates) =>
    set((state) => {
      const normalizedUpdates: Partial<ChatSessionInfo> = updates.claudeConversationId === undefined
        ? updates
        : {
          ...updates,
          claudeConversationId: isConversationId(updates.claudeConversationId)
            ? updates.claudeConversationId
            : createConversationId(),
        }
      const chatSessions = state.chatSessions.map((s) => (s.id === id ? { ...s, ...normalizedUpdates } : s))
      savePersistedChatState(chatSessions, state.activeChatSessionId)
      return { chatSessions }
    }),

  // Agents
  agents: [],
  selectedAgentId: null,

  setAgents: (agents) => set({ agents }),

  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  removeAgent: (idOrTerminalId) =>
    set((state) => {
      const directMatches = state.agents.filter(
        (a) => a.id === idOrTerminalId || a.terminalId === idOrTerminalId
      )
      if (directMatches.length === 0) return {}

      const removedIds = new Set(directMatches.map((a) => a.id))
      const remaining = state.agents.filter((a) => {
        if (a.id === idOrTerminalId || a.terminalId === idOrTerminalId) return false
        if (a.parentAgentId && removedIds.has(a.parentAgentId)) return false
        return true
      })
      const selectedAgentId =
        state.selectedAgentId && remaining.some((a) => a.id === state.selectedAgentId)
          ? state.selectedAgentId
          : null

      return {
        agents: remaining,
        selectedAgentId,
      }
    }),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a))
    })),

  selectAgent: (id) => set({ selectedAgentId: id }),

  getNextDeskIndex: () => {
    const usedIndices = new Set(get().agents.map((a) => a.deskIndex))
    let i = 0
    while (usedIndices.has(i)) i++
    return i
  },

  // Toasts
  toasts: [],

  addToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: `toast-${++toastCounter}`, timestamp: Date.now() }
      ].slice(-5)
    })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    })),

  // Events
  events: [],

  addEvent: (event) =>
    set((state) => ({
      events: [
        ...state.events,
        { ...event, id: `evt-${++eventCounter}`, timestamp: Date.now() }
      ].slice(-500)
    })),

  clearEvents: () => set({ events: [] }),

  // Navigation
  focusAgentTerminal: (agentId) => {
    const state = get()
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent) return
    set({ activeTerminalId: agent.terminalId })
    window.dispatchEvent(new CustomEvent('agent:focusTerminal', { detail: { terminalId: agent.terminalId } }))
  },

  // Token tracking
  recordTokenSnapshot: (id) =>
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== id) return a
        const snapshot: TokenSnapshot = {
          timestamp: Date.now(),
          tokens_input: a.tokens_input,
          tokens_output: a.tokens_output,
        }
        const history = [...a.sessionStats.tokenHistory, snapshot].slice(-360)

        const prev = a.sessionStats.tokenHistory.at(-1)
        let inputRate = 0
        let outputRate = 0
        if (prev) {
          const dt = (snapshot.timestamp - prev.timestamp) / 1000
          if (dt > 0) {
            inputRate = (snapshot.tokens_input - prev.tokens_input) / dt
            outputRate = (snapshot.tokens_output - prev.tokens_output) / dt
          }
        }

        return {
          ...a,
          sessionStats: {
            ...a.sessionStats,
            tokenHistory: history,
            peakInputRate: Math.max(a.sessionStats.peakInputRate, inputRate),
            peakOutputRate: Math.max(a.sessionStats.peakOutputRate, outputRate),
          },
        }
      }),
    })),

  recordModelTokens: (id, model, input, output) =>
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== id) return a
        const prev = a.sessionStats.tokensByModel[model] ?? { input: 0, output: 0 }
        return {
          ...a,
          sessionStats: {
            ...a.sessionStats,
            tokensByModel: {
              ...a.sessionStats.tokensByModel,
              [model]: { input: Math.max(prev.input, input), output: Math.max(prev.output, output) },
            },
          },
        }
      }),
    })),
}))
