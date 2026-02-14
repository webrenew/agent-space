import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../../../store/agents'
import { useSettingsStore } from '../../../store/settings'
import { TerminalTab } from '../../TerminalTab'
import { matchScope } from '../../../lib/scopeMatcher'
import { preloadSounds } from '../../../lib/soundPlayer'

// Preload sounds once
preloadSounds()

let terminalCounter = 0

/**
 * Stripped-down terminal panel for the workspace layout.
 * Only manages terminal tabs + xterm instances. Chat, Events, and
 * Tokens are now separate workspace panels.
 *
 * Auto-creates a terminal on mount if none exist.
 */
export function TerminalPanelWrapper() {
  const terminals = useAgentStore((s) => s.terminals)
  const activeTerminalId = useAgentStore((s) => s.activeTerminalId)
  const setActiveTerminal = useAgentStore((s) => s.setActiveTerminal)
  const addTerminal = useAgentStore((s) => s.addTerminal)
  const removeTerminal = useAgentStore((s) => s.removeTerminal)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateTerminal = useAgentStore((s) => s.updateTerminal)

  const [contextMenu, setContextMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null)
  const autoCreated = useRef(false)

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const handleCreateTerminal = useCallback(async () => {
    try {
      const { id, cwd } = await window.electronAPI.terminal.create({ cols: 80, rows: 24 })
      terminalCounter++

      const { scopes } = useSettingsStore.getState().settings
      const matched = matchScope(cwd, scopes)

      addTerminal({
        id,
        label: `Terminal ${terminalCounter}`,
        isClaudeRunning: false,
        scopeId: matched?.id ?? null,
        cwd,
      })

      // Clean up on process exit
      const unsub = window.electronAPI.terminal.onExit((exitId) => {
        if (exitId === id) {
          removeAgent(id)
          removeTerminal(id)
          unsub()
        }
      })
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }, [addTerminal, removeTerminal, removeAgent])

  // Auto-create a terminal on mount if none exist (with retry for IPC readiness)
  useEffect(() => {
    if (autoCreated.current) return
    const create = () => {
      if (autoCreated.current) return
      if (useAgentStore.getState().terminals.length === 0) {
        autoCreated.current = true
        void handleCreateTerminal()
      }
    }
    create()
    // Retry after a short delay in case IPC wasn't ready on first attempt
    const timer = setTimeout(create, 300)
    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for hotkey event from WorkspaceLayout (Cmd+Shift+N)
  useEffect(() => {
    const handler = (): void => { void handleCreateTerminal() }
    window.addEventListener('hotkey:newTerminal', handler as EventListener)
    return () => window.removeEventListener('hotkey:newTerminal', handler as EventListener)
  }, [handleCreateTerminal])

  const handleCloseTerminal = useCallback(
    async (terminalId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await window.electronAPI.terminal.kill(terminalId)
      } catch (err) {
        console.error('Failed to kill terminal:', err)
      }
      removeAgent(terminalId)
      removeTerminal(terminalId)
    },
    [removeTerminal, removeAgent]
  )

  const getScopeColor = useCallback((terminalId: string) => {
    const term = terminals.find((t) => t.id === terminalId)
    if (!term?.scopeId) return 'transparent'
    const { scopes, defaultScope } = useSettingsStore.getState().settings
    const scope = scopes.find((s) => s.id === term.scopeId)
    return scope?.color ?? defaultScope.color
  }, [terminals])

  const handleTabContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault()
    setContextMenu({ terminalId, x: e.clientX, y: e.clientY })
  }, [])

  const handleChangeScopeFromMenu = useCallback((terminalId: string, scopeId: string | null) => {
    updateTerminal(terminalId, { scopeId })
    setContextMenu(null)
  }, [updateTerminal])

  const handleAutoDetectScope = useCallback((terminalId: string) => {
    const term = terminals.find((t) => t.id === terminalId)
    if (!term?.cwd) {
      handleChangeScopeFromMenu(terminalId, null)
      return
    }
    const { scopes } = useSettingsStore.getState().settings
    const matched = matchScope(term.cwd, scopes)
    handleChangeScopeFromMenu(terminalId, matched?.id ?? null)
  }, [terminals, handleChangeScopeFromMenu])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 28, padding: '0 4px', gap: 2,
        flexShrink: 0, borderBottom: '1px solid rgba(89,86,83,0.15)',
      }}>
        {terminals.map((term) => {
          const scopeColor = getScopeColor(term.id)
          const isActiveTab = activeTerminalId === term.id
          return (
            <button
              key={term.id}
              onClick={() => setActiveTerminal(term.id)}
              onContextMenu={(e) => handleTabContextMenu(e, term.id)}
              className="nav-item"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 24,
                borderRadius: 4, fontSize: 12, fontWeight: 600, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                background: isActiveTab ? 'rgba(154,150,146,0.08)' : 'transparent',
                color: isActiveTab ? '#9A9692' : '#595653',
                borderLeft: isActiveTab && scopeColor !== 'transparent'
                  ? `2px solid ${scopeColor}`
                  : '2px solid transparent',
                transition: 'all 0.15s ease',
              }}
            >
              {/* Status dot */}
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: term.isClaudeRunning ? '#548C5A' : '#595653',
                  animation: term.isClaudeRunning ? 'pulse-green 2s ease-in-out infinite' : undefined,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                {term.label}
              </span>
              <span
                onClick={(e) => handleCloseTerminal(term.id, e)}
                style={{
                  marginLeft: 2, color: '#595653', cursor: 'pointer', borderRadius: 2,
                  padding: '0 2px', fontSize: 10, transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => { (e.target as HTMLSpanElement).style.color = '#c45050' }}
                onMouseLeave={(e) => { (e.target as HTMLSpanElement).style.color = '#595653' }}
              >
                x
              </span>
            </button>
          )
        })}

        {/* New terminal button */}
        <button
          onClick={() => void handleCreateTerminal()}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, color: '#595653', borderRadius: 4,
            fontSize: 16, lineHeight: 1, background: 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'color 0.15s ease',
          }}
          title="New Terminal"
        >
          +
        </button>
      </div>

      {/* Context menu for scope switching */}
      {contextMenu && (
        <div
          className="glass-panel"
          style={{
            position: 'fixed', zIndex: 50, borderRadius: 8, padding: '4px 0',
            minWidth: 160, left: contextMenu.x, top: contextMenu.y,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{
            padding: '6px 12px', fontSize: 10, fontWeight: 600,
            letterSpacing: 1, color: '#74747C', textTransform: 'uppercase',
          }}>
            Change Scope
          </div>
          <button
            onClick={() => handleAutoDetectScope(contextMenu.terminalId)}
            className="hover-row"
            style={{
              width: '100%', padding: '6px 12px', fontSize: 12,
              textAlign: 'left', color: '#9A9692', background: 'transparent',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Auto-detect
          </button>
          <button
            onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, null)}
            className="hover-row"
            style={{
              width: '100%', padding: '6px 12px', fontSize: 12,
              textAlign: 'left', color: '#9A9692', background: 'transparent',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#595653' }} />
            None
          </button>
          {useSettingsStore.getState().settings.scopes.map((scope) => (
            <button
              key={scope.id}
              onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, scope.id)}
              className="hover-row"
              style={{
                width: '100%', padding: '6px 12px', fontSize: 12,
                textAlign: 'left', color: '#9A9692', background: 'transparent',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: scope.color }} />
              {scope.name}
            </button>
          ))}
        </div>
      )}

      {/* Terminal content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {terminals.map((term) => (
          <TerminalTab
            key={term.id}
            terminalId={term.id}
            isActive={activeTerminalId === term.id}
          />
        ))}
      </div>
    </div>
  )
}
