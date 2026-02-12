import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentStore } from '../store/agents'
import { useSettingsStore } from '../store/settings'
import { TerminalTab } from './TerminalTab'
import { EventLog } from './EventLog'
import { ObservabilityPanel } from './ObservabilityPanel'
import { matchScope } from '../lib/scopeMatcher'
import { preloadSounds } from '../lib/soundPlayer'

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 300
const MAX_HEIGHT_RATIO = 0.7

type PanelView = 'terminal' | 'events' | 'observability'

let terminalCounter = 0

// Preload sounds on first import
preloadSounds()

export function TerminalPanel() {
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
      className="flex flex-col bg-[#16162a] border-t border-[#2a2a4a]"
      style={{ height: panelHeight, flexShrink: 0 }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize hover:bg-[#4ade80]/30 transition-colors"
        onMouseDown={handleDragStart}
      />

      {/* Tab bar */}
      <div className="flex items-center h-8 bg-[#12122a] border-b border-[#2a2a4a] px-1 gap-0.5 shrink-0">
        {/* Events tab */}
        <button
          onClick={() => setActiveView('events')}
          className={`flex items-center gap-1.5 px-3 h-7 rounded-t text-xs font-medium transition-colors ${
            activeView === 'events'
              ? 'bg-[#16162a] text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a3a]'
          }`}
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-purple-400" />
          <span>Events</span>
          {eventCount > 0 && (
            <span className="ml-1 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 rounded-full">
              {eventCount > 99 ? '99+' : eventCount}
            </span>
          )}
        </button>

        {/* Observability tab */}
        <button
          onClick={() => setActiveView('observability')}
          className={`flex items-center gap-1.5 px-3 h-7 rounded-t text-xs font-medium transition-colors ${
            activeView === 'observability'
              ? 'bg-[#16162a] text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a3a]'
          }`}
          title="Cmd+Shift+O"
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
          <span>Tokens</span>
        </button>

        {/* Separator */}
        <div className="w-px h-4 bg-[#2a2a4a] mx-0.5" />

        {/* Terminal tabs */}
        {terminals.map((term) => {
          const scopeColor = getScopeColor(term.id)
          const isActiveTab = activeView === 'terminal' && activeTerminalId === term.id
          return (
            <button
              key={term.id}
              onClick={() => handleSelectTerminal(term.id)}
              onContextMenu={(e) => handleTabContextMenu(e, term.id)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-t text-xs font-medium transition-colors ${
                isActiveTab
                  ? 'bg-[#16162a] text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a3a]'
              }`}
              style={{
                borderLeft: `2px solid ${isActiveTab ? scopeColor : 'transparent'}`,
                backgroundColor: isActiveTab && scopeColor !== 'transparent'
                  ? `${scopeColor}15`
                  : undefined,
              }}
            >
              {/* Status dot */}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  term.isClaudeRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'
                }`}
              />
              <span className="truncate max-w-[100px]">{term.label}</span>
              <span
                onClick={(e) => handleCloseTerminal(term.id, e)}
                className="ml-1 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded px-0.5 transition-colors"
              >
                ×
              </span>
            </button>
          )
        })}

        {/* New terminal button */}
        <button
          onClick={handleCreateTerminal}
          className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-green-400 hover:bg-green-400/10 rounded transition-colors text-lg leading-none"
          title="New Terminal"
        >
          +
        </button>
      </div>

      {/* Context menu for scope switching */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a2e] border border-white/15 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Change Scope
          </div>
          <button
            onClick={() => handleAutoDetectScope(contextMenu.terminalId)}
            className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-white/10 transition-colors"
          >
            Auto-detect
          </button>
          <button
            onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, null)}
            className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            None
          </button>
          {useSettingsStore.getState().settings.scopes.map((scope) => (
            <button
              key={scope.id}
              onClick={() => handleChangeScopeFromMenu(contextMenu.terminalId, scope.id)}
              className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: scope.color }} />
              {scope.name}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">
        {activeView === 'events' ? (
          <EventLog />
        ) : activeView === 'observability' ? (
          <ObservabilityPanel />
        ) : terminals.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Click <span className="text-green-400 mx-1 font-bold">+</span> to open a terminal
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
