import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ClaudeDetector } from '../services/claudeDetector'
import { useAgentStore } from '../store/agents'
import { useSettingsStore } from '../store/settings'
import type { Agent, Scope } from '../types'
import { randomAppearance } from '../types'
import { getTheme } from '../lib/terminalThemes'
import { playSoundForEvent } from '../lib/soundPlayer'

interface TerminalTabProps {
  terminalId: string
  isActive: boolean
}

function getTerminalScope(terminalId: string): Scope {
  const terminal = useAgentStore.getState().terminals.find(t => t.id === terminalId)
  const { scopes, defaultScope } = useSettingsStore.getState().settings
  return scopes.find(s => s.id === terminal?.scopeId) ?? defaultScope
}

let agentIdCounter = 0

export function TerminalTab({ terminalId, isActive }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const detectorRef = useRef(new ClaudeDetector())
  const cleanupRef = useRef<(() => void) | null>(null)

  const fileModTimestamps = useRef<number[]>([])
  const snapshotIntervalsRef = useRef(new Map<string, ReturnType<typeof setInterval>>())

  const updateAgent = useAgentStore((s) => s.updateAgent)
  const addAgent = useAgentStore((s) => s.addAgent)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateTerminal = useAgentStore((s) => s.updateTerminal)
  const getNextDeskIndex = useAgentStore((s) => s.getNextDeskIndex)
  const addToast = useAgentStore((s) => s.addToast)
  const addEvent = useAgentStore((s) => s.addEvent)

  const clearCelebration = (agentId: string) => {
    useAgentStore.getState().updateAgent(agentId, {
      activeCelebration: null,
      celebrationStartedAt: null
    })
  }

  // Live theme switching
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      const themeName = state.settings.appearance.terminalTheme
      if (terminalRef.current) {
        terminalRef.current.options.theme = getTheme(themeName)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { appearance, terminal: termSettings } = useSettingsStore.getState().settings

    const term = new Terminal({
      theme: getTheme(appearance.terminalTheme),
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
          const agentId = currentAgent.id
          const evtBase = { agentId, agentName: currentAgent.name }
          const scope = getTerminalScope(terminalId)
          const soundsEnabled = useSettingsStore.getState().settings.soundsEnabled

          // Status change
          if (update.status) {
            agentUpdates.status = update.status
            if (update.status !== currentAgent.status) {
              addEvent({ ...evtBase, type: 'status_change', description: `${currentAgent.status} → ${update.status}` })
            }
          }
          if (update.currentTask) agentUpdates.currentTask = update.currentTask
          if (update.model) agentUpdates.model = update.model

          // Token counts (CLI reports cumulative totals — set directly)
          if (update.tokensInput != null && update.tokensOutput != null) {
            agentUpdates.tokens_input = update.tokensInput
            agentUpdates.tokens_output = update.tokensOutput

            // Track per-model if model is known
            const model = update.model || currentAgent.model
            if (model) {
              useAgentStore.getState().recordModelTokens(
                currentAgent.id,
                model,
                update.tokensInput,
                update.tokensOutput
              )
            }
          }

          // Tool call event
          if (update.status === 'tool_calling' && update.currentTask) {
            addEvent({ ...evtBase, type: 'tool_call', description: update.currentTask })
          }

          // File modification (increment counter + sparkles on rapid saves)
          if (update.fileModified) {
            agentUpdates.files_modified = currentAgent.files_modified + 1
            addEvent({ ...evtBase, type: 'file_write', description: `Modified ${update.fileModified}` })

            // Rapid file saves → sparkles
            fileModTimestamps.current.push(Date.now())
            fileModTimestamps.current = fileModTimestamps.current.filter(t => Date.now() - t < 5000)
            if (fileModTimestamps.current.length >= 3) {
              agentUpdates.activeCelebration = 'sparkles' as const
              agentUpdates.celebrationStartedAt = Date.now()
              fileModTimestamps.current = []
              setTimeout(() => clearCelebration(agentId), 2500)
            }
          }

          // Git commit detected → confetti + sound
          if (update.commitDetected) {
            const newCount = currentAgent.commitCount + 1
            agentUpdates.commitCount = newCount
            agentUpdates.activeCelebration = 'confetti' as const
            agentUpdates.celebrationStartedAt = Date.now()
            addToast({ message: `${currentAgent.name} committed!`, type: 'success' })
            addEvent({ ...evtBase, type: 'commit', description: 'Committed changes' })
            setTimeout(() => clearCelebration(agentId), 4000)
            playSoundForEvent('commit', scope, soundsEnabled)
          }

          // Git push → rocket + sound
          if (update.pushDetected) {
            agentUpdates.activeCelebration = 'rocket' as const
            agentUpdates.celebrationStartedAt = Date.now()
            addToast({ message: `${currentAgent.name} pushed!`, type: 'success' })
            addEvent({ ...evtBase, type: 'push', description: 'Pushed to remote' })
            setTimeout(() => clearCelebration(agentId), 3000)
            playSoundForEvent('push', scope, soundsEnabled)
          }

          // Test/build fail → explosion + sound
          if (update.testFailed || update.buildFailed) {
            agentUpdates.activeCelebration = 'explosion' as const
            agentUpdates.celebrationStartedAt = Date.now()
            const msg = update.testFailed ? 'tests failed' : 'build failed'
            addToast({ message: `${currentAgent.name} ${msg}!`, type: 'error' })
            addEvent({ ...evtBase, type: update.testFailed ? 'test_fail' : 'build_fail', description: msg.charAt(0).toUpperCase() + msg.slice(1) })
            setTimeout(() => clearCelebration(agentId), 2000)
            playSoundForEvent(update.testFailed ? 'test_fail' : 'build_fail', scope, soundsEnabled)
          }

          // Test/build pass → toast + sound
          if (update.testPassed) {
            addToast({ message: `${currentAgent.name} tests passed!`, type: 'success' })
            addEvent({ ...evtBase, type: 'test_pass', description: 'Tests passed' })
            playSoundForEvent('test_pass', scope, soundsEnabled)
          }
          if (update.buildSucceeded) {
            addToast({ message: `${currentAgent.name} build succeeded!`, type: 'success' })
            addEvent({ ...evtBase, type: 'build_pass', description: 'Build succeeded' })
            playSoundForEvent('build_pass', scope, soundsEnabled)
          }

          // Agent done → trophy + sound
          if (update.status === 'done' && currentAgent.status !== 'done') {
            agentUpdates.activeCelebration = 'trophy' as const
            agentUpdates.celebrationStartedAt = Date.now()
            setTimeout(() => clearCelebration(agentId), 3000)
            playSoundForEvent('agent_done', scope, soundsEnabled)
          }

          // Error event + sound
          if (update.status === 'error' && currentAgent.status !== 'error') {
            addEvent({ ...evtBase, type: 'error', description: update.currentTask || 'Error detected' })
            playSoundForEvent('error', scope, soundsEnabled)
          }

          updateAgent(agentId, agentUpdates)
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
          celebrationStartedAt: null,
          sessionStats: {
            tokenHistory: [],
            peakInputRate: 0,
            peakOutputRate: 0,
            tokensByModel: {},
          }
        }
        addAgent(agent)
        addToast({ message: `${agent.name} sat down`, type: 'info' })
        addEvent({ agentId: agent.id, agentName: agent.name, type: 'spawn', description: 'Started working' })

        // Start periodic token snapshots
        const snapshotInterval = setInterval(() => {
          const cur = useAgentStore.getState().agents.find((a) => a.terminalId === terminalId)
          if (cur) {
            useAgentStore.getState().recordTokenSnapshot(cur.id)
          }
        }, 10_000)
        snapshotIntervalsRef.current.set(terminalId, snapshotInterval)
      } else if (isRunning && existingAgent) {
        // Claude restarted in same terminal
        updateAgent(existingAgent.id, {
          isClaudeRunning: true,
          status: 'thinking'
        })
        addEvent({ agentId: existingAgent.id, agentName: existingAgent.name, type: 'spawn', description: 'Restarted' })
      } else if (!isRunning && existingAgent) {
        // Claude exited → remove agent
        addToast({ message: `${existingAgent.name} left`, type: 'info' })
        addEvent({ agentId: existingAgent.id, agentName: existingAgent.name, type: 'exit', description: 'Finished working' })
        const interval = snapshotIntervalsRef.current.get(terminalId)
        if (interval) {
          clearInterval(interval)
          snapshotIntervalsRef.current.delete(terminalId)
        }
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
      // Clear snapshot intervals to prevent memory leak
      const interval = snapshotIntervalsRef.current.get(terminalId)
      if (interval) {
        clearInterval(interval)
        snapshotIntervalsRef.current.delete(terminalId)
      }
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [terminalId, updateAgent, addAgent, removeAgent, updateTerminal, getNextDeskIndex, addToast, addEvent])

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
