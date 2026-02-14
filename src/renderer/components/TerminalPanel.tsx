import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../store/agents'
import { useSettingsStore } from '../store/settings'
import { TerminalTab } from './TerminalTab'
import { EventLog } from './EventLog'
import { ObservabilityPanel } from './ObservabilityPanel'
import { ChatPanel } from './chat/ChatPanel'
import { matchScope } from '../lib/scopeMatcher'
import { preloadSounds } from '../lib/soundPlayer'

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 300
const MAX_HEIGHT_RATIO = 0.7

type PanelView = 'terminal' | 'events' | 'observability' | 'chat'

let terminalCounter = 0

// Preload sounds on first import
preloadSounds()

export function TerminalPanel() {
  const LEGACY_CHAT_SESSION_ID = 'terminal-panel-chat'
  const terminals = useAgentStore((s) => s.terminals)
  const activeTerminalId = useAgentStore((s) => s.activeTerminalId)
  const setActiveTerminal = useAgentStore((s) => s.setActiveTerminal)
  const addTerminal = useAgentStore((s) => s.addTerminal)
  const removeTerminal = useAgentStore((s) => s.removeTerminal)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateTerminal = useAgentStore((s) => s.updateTerminal)
  const eventCount = useAgentStore((s) => s.events.length)

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT)
  const [activeView, setActiveView] = useState<PanelView>('terminal')
  const [contextMenu, setContextMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  // Cmd+Shift+O toggles observability
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'o') {
        e.preventDefault()
        setActiveView((v) => (v === 'observability' ? 'terminal' : 'observability'))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

      setActiveView('terminal')

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

  // Listen for hotkey event from WorkspaceLayout (Cmd+Shift+N)
  useEffect(() => {
    const handler = (): void => { void handleCreateTerminal() }
    window.addEventListener('hotkey:newTerminal', handler as EventListener)
    return () => window.removeEventListener('hotkey:newTerminal', handler as EventListener)
  }, [handleCreateTerminal])

  const handleCloseTerminal = useCallback(
    async (terminalId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await window.electronAPI.terminal.kill(terminalId)
      removeAgent(terminalId)
      removeTerminal(terminalId)
    },
    [removeTerminal, removeAgent]
  )

  const handleSelectTerminal = useCallback(
    (id: string) => {
      setActiveTerminal(id)
      setActiveView('terminal')
    },
    [setActiveTerminal]
  )

  // Drag handle for resizing
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      dragStartY.current = e.clientY
      dragStartHeight.current = panelHeight

      const handleDragMove = (me: MouseEvent) => {
        if (!isDragging.current) return
        const delta = dragStartY.current - me.clientY
        const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO
        const newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, dragStartHeight.current + delta))
        setPanelHeight(newHeight)
      }

      const handleDragEnd = () => {
        isDragging.current = false
        document.removeEventListener('mousemove', handleDragMove)
        document.removeEventListener('mouseup', handleDragEnd)
      }

      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('mouseup', handleDragEnd)
    },
    [panelHeight]
  )

  const getScopeColor = useCallback((terminalId: string) => {
    const term = terminals.find(t => t.id === terminalId)
    if (!term?.scopeId) return 'transparent'
    const { scopes, defaultScope } = useSettingsStore.getState().settings
    const scope = scopes.find(s => s.id === term.scopeId)
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
    const term = terminals.find(t => t.id === terminalId)
    if (!term?.cwd) {
      handleChangeScopeFromMenu(terminalId, null)
      return
    }
    const { scopes } = useSettingsStore.getState().settings
    const matched = matchScope(term.cwd, scopes)
    handleChangeScopeFromMenu(terminalId, matched?.id ?? null)
  }, [terminals, handleChangeScopeFromMenu])

  return (
    <div
      className="flex flex-col"
      style={{ background: '#0E0E0D', borderTop: '1px solid rgba(89,86,83,0.2)', height: panelHeight, flexShrink: 0 }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize transition-colors"
        style={{ background: 'transparent' }}
        onMouseOver={(e) => { (e.target as HTMLElement).style.background = 'rgba(84,140,90,0.3)' }}
        onMouseOut={(e) => { (e.target as HTMLElement).style.background = 'transparent' }}
        onMouseDown={handleDragStart}
      />

      {/* Tab bar */}
      <div className="flex items-center h-8 px-1 gap-0.5 shrink-0" style={{ background: 'rgba(14,14,13,0.8)', borderBottom: '1px solid rgba(89,86,83,0.2)' }}>
        {/* Chat tab */}
        <button
          onClick={() => setActiveView('chat')}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 28,
            borderRadius: '4px 4px 0 0', fontSize: 12, fontWeight: 600, border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', background: 'transparent',
            color: activeView === 'chat' ? '#548C5A' : '#595653',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#548C5A' }} />
          <span>Chat</span>
        </button>

        {/* Events tab */}
        <button
          onClick={() => setActiveView('events')}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 28,
            borderRadius: '4px 4px 0 0', fontSize: 12, fontWeight: 600, border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', background: 'transparent',
            color: activeView === 'events' ? '#d4a040' : '#595653',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#c87830' }} />
          <span>Events</span>
          {eventCount > 0 && (
            <span style={{ marginLeft: 4, fontSize: 10, background: 'rgba(200,120,48,0.2)', color: '#c87830', padding: '0 6px', borderRadius: 8 }}>
              {eventCount > 99 ? '99+' : eventCount}
            </span>
          )}
        </button>

        {/* Observability tab */}
        <button
          onClick={() => setActiveView('observability')}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 28,
            borderRadius: '4px 4px 0 0', fontSize: 12, fontWeight: 600, border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', background: 'transparent',
            color: activeView === 'observability' ? '#d4a040' : '#595653',
          }}
          title="Cmd+Shift+O"
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#d4a040' }} />
          <span>Tokens</span>
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: 'rgba(89,86,83,0.2)', margin: '0 2px' }} />

        {/* Terminal tabs */}
        {terminals.map((term) => {
          const scopeColor = getScopeColor(term.id)
          const isActiveTab = activeView === 'terminal' && activeTerminalId === term.id
          return (
            <button
              key={term.id}
              onClick={() => handleSelectTerminal(term.id)}
              onContextMenu={(e) => handleTabContextMenu(e, term.id)}
              className="nav-item"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 28,
                borderRadius: '4px 4px 0 0', fontSize: 12, fontWeight: 600, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', background: 'transparent',
                color: isActiveTab ? '#9A9692' : '#595653',
                borderLeft: `2px solid ${isActiveTab ? scopeColor : 'transparent'}`,
                backgroundColor: isActiveTab && scopeColor !== 'transparent'
                  ? `${scopeColor}15`
                  : undefined,
              }}
            >
              {/* Status dot */}
              <span
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: term.isClaudeRunning ? '#548C5A' : '#595653',
                  animation: term.isClaudeRunning ? 'pulse 2s ease-in-out infinite' : undefined,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{term.label}</span>
              <span
                onClick={(e) => handleCloseTerminal(term.id, e)}
                style={{ marginLeft: 4, color: '#595653', cursor: 'pointer', borderRadius: 2, padding: '0 2px' }}
              >
                ×
              </span>
            </button>
          )
        })}

        {/* New terminal button */}
        <button
          onClick={handleCreateTerminal}
          className="nav-item"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, color: '#595653', borderRadius: 4, fontSize: 16, lineHeight: 1, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          title="New Terminal (⌘⇧N)"
        >
          +
        </button>
      </div>

      {/* Context menu for scope switching */}
      {contextMenu && (
        <div
          className="glass-panel"
          style={{ position: 'fixed', zIndex: 50, borderRadius: 8, padding: '4px 0', minWidth: 160, left: contextMenu.x, top: contextMenu.y }}
        >
          <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 600, letterSpacing: 1, color: '#74747C' }}>
            Change Scope
          </div>
          <button
            onClick={() => handleAutoDetectScope(contextMenu.terminalId)}
            className="hover-row"
            style={{ width: '100%', padding: '6px 12px', fontSize: 12, textAlign: 'left', color: '#9A9692', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Auto-detect
          </button>
          <button
            onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, null)}
            className="hover-row"
            style={{ width: '100%', padding: '6px 12px', fontSize: 12, textAlign: 'left', color: '#9A9692', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#595653' }} />
            None
          </button>
          {useSettingsStore.getState().settings.scopes.map((scope) => (
            <button
              key={scope.id}
              onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, scope.id)}
              className="hover-row"
              style={{ width: '100%', padding: '6px 12px', fontSize: 12, textAlign: 'left', color: '#9A9692', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: scope.color }} />
              {scope.name}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">
        {activeView === 'chat' ? (
          <ChatPanel chatSessionId={LEGACY_CHAT_SESSION_ID} />
        ) : activeView === 'events' ? (
          <EventLog />
        ) : activeView === 'observability' ? (
          <ObservabilityPanel />
        ) : terminals.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#595653', fontSize: 'inherit' }}>
            Click <span style={{ color: '#548C5A', margin: '0 4px', fontWeight: 700 }}>+</span> to open a terminal
          </div>
        ) : (
          terminals.map((term) => (
            <TerminalTab
              key={term.id}
              terminalId={term.id}
              isActive={activeView === 'terminal' && activeTerminalId === term.id}
            />
          ))
        )}
      </div>
    </div>
  )
}
