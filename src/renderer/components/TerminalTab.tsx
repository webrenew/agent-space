import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ClaudeDetector } from '../services/claudeDetector'
import { useAgentStore } from '../store/agents'
import { useSettingsStore } from '../store/settings'
import type { Agent } from '../types'
import { randomAppearance } from '../types'

interface TerminalTabProps {
  terminalId: string
  isActive: boolean
}

const THEME = {
  background: '#16162a',
  foreground: '#e2e8f0',
  cursor: '#4ade80',
  cursorAccent: '#16162a',
  selectionBackground: '#334155',
  black: '#1e1e2e',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc'
}

let agentIdCounter = 0

export function TerminalTab({ terminalId, isActive }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const detectorRef = useRef(new ClaudeDetector())
  const cleanupRef = useRef<(() => void) | null>(null)

  const updateAgent = useAgentStore((s) => s.updateAgent)
  const addAgent = useAgentStore((s) => s.addAgent)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateTerminal = useAgentStore((s) => s.updateTerminal)
  const getNextDeskIndex = useAgentStore((s) => s.getNextDeskIndex)
  const addToast = useAgentStore((s) => s.addToast)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { appearance, terminal: termSettings } = useSettingsStore.getState().settings

    const term = new Terminal({
      theme: THEME,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      lineHeight: 1.2,
      cursorBlink: appearance.cursorBlink,
      cursorStyle: appearance.cursorStyle,
      allowTransparency: true,
      scrollback: termSettings.scrollbackLines,
      macOptionIsMeta: termSettings.optionAsMeta
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Wire terminal input → PTY
    const inputDisposable = term.onData((data) => {
      window.electronAPI.terminal.write(terminalId, data)
    })

    // Wire PTY output → terminal + claude detector
    const unsubData = window.electronAPI.terminal.onData((id, data) => {
      if (id !== terminalId) return
      term.write(data)

      // Feed to Claude detector if an agent exists for this terminal
      const currentAgent = useAgentStore
        .getState()
        .agents.find((a) => a.terminalId === terminalId)
      if (currentAgent?.isClaudeRunning) {
        const update = detectorRef.current.feed(data)
        if (update) {
          const agentUpdates: Record<string, unknown> = {}
          if (update.status) agentUpdates.status = update.status
          if (update.currentTask) agentUpdates.currentTask = update.currentTask
          if (update.model) agentUpdates.model = update.model

          // Token counts (CLI reports cumulative totals — set directly)
          if (update.tokensInput != null) agentUpdates.tokens_input = update.tokensInput
          if (update.tokensOutput != null) agentUpdates.tokens_output = update.tokensOutput

          // File modification (increment counter)
          if (update.fileModified) {
            agentUpdates.files_modified = currentAgent.files_modified + 1
          }

          // Git commit detected → trigger celebration
          if (update.commitDetected) {
            const newCount = currentAgent.commitCount + 1
            agentUpdates.commitCount = newCount
            agentUpdates.activeCelebration = 'confetti' as const
            agentUpdates.celebrationStartedAt = Date.now()
            addToast({ message: `${currentAgent.name} committed!`, type: 'success' })

            // Auto-clear celebration after 4 seconds
            const agentId = currentAgent.id
            setTimeout(() => {
              useAgentStore.getState().updateAgent(agentId, {
                activeCelebration: null,
                celebrationStartedAt: null
              })
            }, 4000)
          }

          updateAgent(currentAgent.id, agentUpdates)
        }
      }
    })

    // Claude status from main process polling — this is where agents spawn/despawn
    const unsubClaude = window.electronAPI.terminal.onClaudeStatus((id, isRunning) => {
      if (id !== terminalId) return

      // Update terminal tab indicator
      updateTerminal(terminalId, { isClaudeRunning: isRunning })

      const existingAgent = useAgentStore
        .getState()
        .agents.find((a) => a.terminalId === terminalId)

      if (isRunning && !existingAgent) {
        // Claude just started → spawn agent
        const deskIndex = getNextDeskIndex()
        const agent: Agent = {
          id: `agent-${++agentIdCounter}`,
          name: `Claude ${agentIdCounter}`,
          agent_type: 'cli',
          status: 'thinking',
          currentTask: 'Starting up...',
          model: '',
          tokens_input: 0,
          tokens_output: 0,
          files_modified: 0,
          started_at: Date.now(),
          deskIndex,
          terminalId,
          isClaudeRunning: true,
          appearance: randomAppearance(),
          commitCount: 0,
          activeCelebration: null,
          celebrationStartedAt: null
        }
        addAgent(agent)
        addToast({ message: `${agent.name} sat down`, type: 'info' })
      } else if (isRunning && existingAgent) {
        // Claude restarted in same terminal
        updateAgent(existingAgent.id, {
          isClaudeRunning: true,
          status: 'thinking'
        })
      } else if (!isRunning && existingAgent) {
        // Claude exited → remove agent
        addToast({ message: `${existingAgent.name} left`, type: 'info' })
        removeAgent(terminalId)
        detectorRef.current.reset()
      }
    })

    // Handle resize
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit()
        const dims = fitAddon.proposeDimensions()
        if (dims) {
          window.electronAPI.terminal.resize(terminalId, dims.cols, dims.rows)
        }
      })
    })
    observer.observe(container)

    cleanupRef.current = () => {
      inputDisposable.dispose()
      unsubData()
      unsubClaude()
      observer.disconnect()
      term.dispose()
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [terminalId, updateAgent, addAgent, removeAgent, updateTerminal, getNextDeskIndex, addToast])

  // Re-fit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        terminalRef.current?.focus()
      })
    }
  }, [isActive])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}
