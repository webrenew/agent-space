import { create } from 'zustand'
import type { Agent } from '../types'

export interface TerminalInfo {
  id: string
  label: string
  isClaudeRunning: boolean
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
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'error' | 'success'
  timestamp: number
}

let toastCounter = 0

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
    }))
}))
