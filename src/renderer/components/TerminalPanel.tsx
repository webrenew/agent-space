import { useCallback, useRef, useState } from 'react'
import { useAgentStore } from '../store/agents'
import { TerminalTab } from './TerminalTab'

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 300
const MAX_HEIGHT_RATIO = 0.7

let terminalCounter = 0

export function TerminalPanel() {
  const terminals = useAgentStore((s) => s.terminals)
  const activeTerminalId = useAgentStore((s) => s.activeTerminalId)
  const setActiveTerminal = useAgentStore((s) => s.setActiveTerminal)
  const addTerminal = useAgentStore((s) => s.addTerminal)
  const removeTerminal = useAgentStore((s) => s.removeTerminal)
  const removeAgent = useAgentStore((s) => s.removeAgent)

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  const handleCreateTerminal = useCallback(async () => {
    try {
      const { id } = await window.electronAPI.terminal.create({ cols: 80, rows: 24 })
      terminalCounter++

      addTerminal({
        id,
        label: `Terminal ${terminalCounter}`,
        isClaudeRunning: false
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

  const handleCloseTerminal = useCallback(
    async (terminalId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await window.electronAPI.terminal.kill(terminalId)
      removeAgent(terminalId)
      removeTerminal(terminalId)
    },
    [removeTerminal, removeAgent]
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
        {terminals.map((term) => (
          <button
            key={term.id}
            onClick={() => setActiveTerminal(term.id)}
            className={`flex items-center gap-1.5 px-3 h-7 rounded-t text-xs font-medium transition-colors ${
              activeTerminalId === term.id
                ? 'bg-[#16162a] text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a3a]'
            }`}
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
        ))}

        {/* New terminal button */}
        <button
          onClick={handleCreateTerminal}
          className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-green-400 hover:bg-green-400/10 rounded transition-colors text-lg leading-none"
          title="New Terminal"
        >
          +
        </button>
      </div>

      {/* Terminal content area */}
      <div className="flex-1 relative overflow-hidden">
        {terminals.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Click <span className="text-green-400 mx-1 font-bold">+</span> to open a terminal
          </div>
        ) : (
          terminals.map((term) => (
            <TerminalTab
              key={term.id}
              terminalId={term.id}
              isActive={activeTerminalId === term.id}
            />
          ))
        )}
      </div>
    </div>
  )
}
