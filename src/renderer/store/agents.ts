import { create } from 'zustand'
import type { Agent, AgentEvent, TokenSnapshot } from '../types'

export interface TerminalInfo {
  id: string
  label: string
  isClaudeRunning: boolean
  scopeId: string | null
  cwd: string | null
}

interface AgentStore {
  // Terminal state (tabs — always present)
  terminals: TerminalInfo[]
  activeTerminalId: string | null
  addTerminal: (info: TerminalInfo) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string | null) => void
  updateTerminal: (id: string, updates: Partial<TerminalInfo>) => void

  // Agent state (3D characters — only when Claude is running)
  agents: Agent[]
  selectedAgentId: string | null
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  removeAgent: (terminalId: string) => void
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

  // Token tracking
  recordTokenSnapshot: (id: string) => void
  recordModelTokens: (id: string, model: string, input: number, output: number) => void
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'error' | 'success'
  timestamp: number
}

let toastCounter = 0
let eventCounter = 0

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

  // Agents
  agents: [],
  selectedAgentId: null,

  setAgents: (agents) => set({ agents }),

  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  removeAgent: (terminalId) =>
    set((state) => {
      const agent = state.agents.find((a) => a.terminalId === terminalId)
      return {
        agents: state.agents.filter((a) => a.terminalId !== terminalId),
        selectedAgentId:
          state.selectedAgentId === agent?.id ? null : state.selectedAgentId
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
