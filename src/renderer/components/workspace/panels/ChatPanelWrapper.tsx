import { useCallback, useEffect, useRef } from 'react'
import { useAgentStore, type ChatSessionInfo } from '../../../store/agents'
import { useWorkspaceStore } from '../../../store/workspace'
import { ChatPanel } from '../../chat/ChatPanel'

let chatSessionCounter = 0

/**
 * Workspace wrapper for ChatPanel — manages multiple chat session tabs
 * following the same pattern as TerminalPanelWrapper.
 */
export function ChatPanelWrapper() {
  const chatSessions = useAgentStore((s) => s.chatSessions)
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId)
  const setActiveChatSession = useAgentStore((s) => s.setActiveChatSession)
  const addChatSession = useAgentStore((s) => s.addChatSession)
  const removeChatSession = useAgentStore((s) => s.removeChatSession)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const autoCreated = useRef(false)
  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId) ?? null

  const createSession = useCallback((workingDirectory: string | null, directoryMode: 'workspace' | 'custom') => {
    const id = `chat-session-${++chatSessionCounter}-${Date.now()}`
    const session: ChatSessionInfo = {
      id,
      label: `Chat ${chatSessionCounter}`,
      agentId: null,
      scopeId: null,
      workingDirectory,
      directoryMode,
    }
    addChatSession(session)
  }, [addChatSession])

  const handleCreateSession = useCallback(() => {
    const baseDirectory = activeSession?.workingDirectory ?? workspaceRoot ?? null
    const baseMode = activeSession?.directoryMode ?? 'workspace'
    createSession(baseDirectory, baseMode)
  }, [activeSession, createSession, workspaceRoot])

  const handleCreateWorkspaceSession = useCallback(() => {
    createSession(workspaceRoot ?? null, 'workspace')
  }, [createSession, workspaceRoot])

  // Auto-create a chat session on mount if none exist
  useEffect(() => {
    if (autoCreated.current) return
    if (useAgentStore.getState().chatSessions.length === 0) {
      autoCreated.current = true
      handleCreateSession()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCloseSession = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      const session = chatSessions.find((s) => s.id === sessionId)
      if (session?.agentId) {
        removeAgent(session.agentId)
      }
      removeChatSession(sessionId)
    },
    [chatSessions, removeChatSession, removeAgent]
  )

  const handlePopOut = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      window.electronAPI.chat?.popout?.(sessionId)
    },
    []
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 28, padding: '0 4px', gap: 2,
        flexShrink: 0, borderBottom: '1px solid rgba(89,86,83,0.15)',
      }}>
        {chatSessions.map((session) => {
          const isActiveTab = activeChatSessionId === session.id
          const isCustomDirectory = session.directoryMode === 'custom'
          const modeLabel = isCustomDirectory ? 'custom' : 'workspace'
          const sessionDirLabel = session.workingDirectory
            ? session.workingDirectory.split('/').pop() ?? session.workingDirectory
            : 'no-dir'
          return (
            <button
              key={session.id}
              onClick={() => setActiveChatSession(session.id)}
              className="nav-item"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 24,
                borderRadius: 4, fontSize: 12, fontWeight: 600, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                background: isActiveTab ? 'rgba(154,150,146,0.08)' : 'transparent',
                color: isActiveTab ? '#9A9692' : '#595653',
                transition: 'all 0.15s ease',
              }}
            >
              {/* Status dot */}
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: session.agentId ? '#22d3ee' : '#595653',
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                {session.label}
              </span>
              <span
                title={session.workingDirectory ?? 'No working directory selected'}
                style={{
                  maxWidth: 72,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 10,
                  color: '#74747C',
                }}
              >
                {sessionDirLabel}
              </span>
              <span
                title={`Directory mode: ${modeLabel}`}
                style={{
                  minWidth: 14,
                  height: 14,
                  borderRadius: 3,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  border: `1px solid ${isCustomDirectory ? 'rgba(200,120,48,0.5)' : 'rgba(84,140,90,0.5)'}`,
                  color: isCustomDirectory ? '#c87830' : '#548C5A',
                  background: isCustomDirectory ? 'rgba(200,120,48,0.1)' : 'rgba(84,140,90,0.1)',
                }}
              >
                {isCustomDirectory ? 'C' : 'W'}
              </span>
              {/* Pop-out button */}
              <span
                onClick={(e) => handlePopOut(session.id, e)}
                title="Pop out to separate window"
                style={{
                  color: '#595653', cursor: 'pointer', borderRadius: 2,
                  padding: '0 2px', fontSize: 10, transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => { (e.target as HTMLSpanElement).style.color = '#22d3ee' }}
                onMouseLeave={(e) => { (e.target as HTMLSpanElement).style.color = '#595653' }}
              >
                ↗
              </span>
              {/* Close button */}
              <span
                onClick={(e) => handleCloseSession(session.id, e)}
                style={{
                  color: '#595653', cursor: 'pointer', borderRadius: 2,
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

        <button
          onClick={handleCreateWorkspaceSession}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 24,
            color: workspaceRoot ? '#548C5A' : '#595653',
            borderRadius: 4,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
            background: workspaceRoot ? 'rgba(84,140,90,0.1)' : 'transparent',
            border: workspaceRoot ? '1px solid rgba(84,140,90,0.35)' : '1px solid transparent',
            cursor: 'pointer', fontFamily: 'inherit',
            transition: 'all 0.15s ease',
          }}
          title={workspaceRoot ? 'New Chat in current workspace' : 'New Chat in workspace mode'}
        >
          W+
        </button>

        {/* New chat session button */}
        <button
          onClick={handleCreateSession}
          className="nav-item"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, color: '#595653', borderRadius: 4,
            fontSize: 16, lineHeight: 1, background: 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'color 0.15s ease',
          }}
          title="New Chat (same scope as active tab)"
        >
          +
        </button>
      </div>

      {/* Chat content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {chatSessions.map((session) => (
          <div
            key={session.id}
            style={{
              position: 'absolute', inset: 0,
              display: activeChatSessionId === session.id ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <ChatPanel chatSessionId={session.id} />
          </div>
        ))}
      </div>
    </div>
  )
}
