import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChatMessage, ClaudeEvent } from '../../types'
import { randomAppearance } from '../../types'
import { useAgentStore } from '../../store/agents'
import { useWorkspaceStore } from '../../store/workspace'
import { useSettingsStore } from '../../store/settings'
import { useChatHistoryStore } from '../../store/chatHistory'
import { matchScope } from '../../lib/scopeMatcher'
import { ChatMessageBubble } from './ChatMessage'
import { ChatInput } from './ChatInput'

interface ChatPanelProps {
  chatSessionId: string
}

type SessionStatus = 'idle' | 'running' | 'done' | 'error'

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tiff', 'psd',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'mkv', 'flac',
  'exe', 'dll', 'so', 'dylib', 'wasm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'dmg', 'iso', 'bin',
])

let chatMessageCounter = 0
let chatAgentCounter = 0

function nextMessageId(): string {
  return `msg-${++chatMessageCounter}`
}

/** Orchid-style typing indicator with cherry blossom */
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0 8px 8px' }}>
      <span style={{ fontSize: 14 }}>👾</span>
      <span className="glow-amber" style={{ color: '#d4a040', fontWeight: 600, fontSize: 'inherit' }}>
        claude
      </span>
      <div style={{ display: 'flex', gap: 3, marginLeft: 8 }}>
        <span
          className="typing-dot"
          style={{ width: 4, height: 4, borderRadius: '50%', background: '#74747C', display: 'block' }}
        />
        <span
          className="typing-dot"
          style={{ width: 4, height: 4, borderRadius: '50%', background: '#74747C', display: 'block' }}
        />
        <span
          className="typing-dot"
          style={{ width: 4, height: 4, borderRadius: '50%', background: '#74747C', display: 'block' }}
        />
      </div>
    </div>
  )
}

export function ChatPanel({ chatSessionId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [fallbackWorkingDir, setFallbackWorkingDir] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const agentIdRef = useRef<string | null>(null)
  const subagentSeatCounter = useRef(0)
  const activeSubagents = useRef<Map<string, string>>(new Map()) // toolUseId → subagentId

  const addAgent = useAgentStore((s) => s.addAgent)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const getNextDeskIndex = useAgentStore((s) => s.getNextDeskIndex)
  const addEvent = useAgentStore((s) => s.addEvent)
  const updateChatSession = useAgentStore((s) => s.updateChatSession)
  const chatSession = useAgentStore(
    (s) => s.chatSessions.find((session) => session.id === chatSessionId) ?? null
  )

  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const recentFolders = useWorkspaceStore((s) => s.recentFolders)
  const scopes = useSettingsStore((s) => s.settings.scopes)
  const yoloMode = useSettingsStore((s) => s.settings.yoloMode)
  const loadHistory = useChatHistoryStore((s) => s.loadHistory)
  const getHistory = useChatHistoryStore((s) => s.getHistory)
  const isHistoryLoaded = useChatHistoryStore((s) => s.isLoaded)
  const [showRecentMenu, setShowRecentMenu] = useState(false)
  const recentMenuRef = useRef<HTMLDivElement>(null)

  const workingDir = chatSession ? chatSession.workingDirectory : fallbackWorkingDir
  const isDirectoryCustom = chatSession ? chatSession.directoryMode === 'custom' : false
  const hasStartedConversation = Boolean(chatSession?.agentId)

  // Derive scope from working directory
  const currentScope = workingDir ? matchScope(workingDir, scopes) : null
  const scopeId = currentScope?.id ?? 'default'
  const scopeName = currentScope?.name ?? 'default'

  useEffect(() => {
    if (!showRecentMenu) return
    const onDocMouseDown = (event: MouseEvent) => {
      if (recentMenuRef.current && !recentMenuRef.current.contains(event.target as Node)) {
        setShowRecentMenu(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [showRecentMenu])

  // Load chat history from memories on mount / scope change
  useEffect(() => {
    if (isHistoryLoaded(scopeId)) {
      const history = getHistory(scopeId)
      if (hasStartedConversation) {
        setMessages((prev) => (prev.length === 0 ? history : prev))
      } else {
        setMessages(history)
      }
      return
    }

    loadHistory(scopeId).then(() => {
      const history = useChatHistoryStore.getState().getHistory(scopeId)
      if (hasStartedConversation) {
        setMessages((prev) => (prev.length === 0 ? history : prev))
      } else {
        setMessages(history)
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ChatPanel] Failed to load history: ${msg}`)
    })
  }, [scopeId, getHistory, hasStartedConversation, isHistoryLoaded, loadHistory])

  // Persist a message to memories (fire-and-forget)
  const persistMessage = useCallback((content: string, role: string) => {
    window.electronAPI.memories.addChatMessage({
      content,
      role,
      scopeId,
      scopeName,
      workspacePath: workingDir ?? '',
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ChatPanel] Failed to persist message: ${msg}`)
    })
  }, [scopeId, scopeName, workingDir])

  // Keep chat session directory synced to workspace until the first message.
  // User-picked custom dirs are never overwritten by sidebar folder changes.
  useEffect(() => {
    if (!chatSession) {
      if (!fallbackWorkingDir && workspaceRoot) {
        setFallbackWorkingDir(workspaceRoot)
      }
      return
    }
    if (chatSession.agentId) return
    if (chatSession.directoryMode === 'custom') return
    const nextDir = workspaceRoot ?? null
    if (chatSession.workingDirectory === nextDir) return
    updateChatSession(chatSessionId, {
      workingDirectory: nextDir,
      directoryMode: 'workspace',
    })
  }, [
    chatSession,
    chatSessionId,
    fallbackWorkingDir,
    updateChatSession,
    workspaceRoot,
  ])

  // Keep session scope metadata aligned with current working directory.
  useEffect(() => {
    if (!chatSession) return
    const nextScopeId = currentScope?.id ?? null
    if (chatSession.scopeId === nextScopeId) return
    updateChatSession(chatSessionId, { scopeId: nextScopeId })
  }, [chatSession, chatSessionId, currentScope?.id, updateChatSession])

  const handleChangeWorkingDir = useCallback(async () => {
    try {
      const selected = await window.electronAPI.fs.openFolderDialog()
      if (!selected) return
      if (chatSession) {
        updateChatSession(chatSessionId, {
          workingDirectory: selected,
          directoryMode: selected === workspaceRoot ? 'workspace' : 'custom',
        })
      } else {
        setFallbackWorkingDir(selected)
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to change working directory:', err)
    }
  }, [chatSession, chatSessionId, updateChatSession, workspaceRoot])

  const handleSyncToWorkspace = useCallback(() => {
    if (chatSession) {
      updateChatSession(chatSessionId, {
        workingDirectory: workspaceRoot ?? null,
        directoryMode: 'workspace',
      })
      return
    }
    setFallbackWorkingDir(workspaceRoot ?? null)
  }, [chatSession, chatSessionId, updateChatSession, workspaceRoot])

  const handleSelectRecentDirectory = useCallback(
    (path: string) => {
      if (path === workspaceRoot) {
        handleSyncToWorkspace()
      } else if (chatSession) {
        updateChatSession(chatSessionId, {
          workingDirectory: path,
          directoryMode: 'custom',
        })
      } else {
        setFallbackWorkingDir(path)
      }
      setShowRecentMenu(false)
    },
    [chatSession, chatSessionId, handleSyncToWorkspace, updateChatSession, workspaceRoot]
  )

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Handle incoming Claude events
  useEffect(() => {
    const unsub = window.electronAPI.claude.onEvent((event: ClaudeEvent) => {
      if (claudeSessionId && event.sessionId !== claudeSessionId) return

      const agentId = agentIdRef.current

      switch (event.type) {
        case 'init': {
          if (agentId) {
            updateAgent(agentId, { status: 'thinking' })
          }
          break
        }

        case 'text': {
          const data = event.data as { text: string }
          if (!data.text) break

          setMessages((prev) => {
            // Merge consecutive assistant text messages
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && !last.toolName) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + data.text },
              ]
            }
            return [
              ...prev,
              {
                id: nextMessageId(),
                role: 'assistant',
                content: data.text,
                timestamp: Date.now(),
              },
            ]
          })

          if (agentId) {
            updateAgent(agentId, { status: 'streaming' })
          }
          break
        }

        case 'thinking': {
          const data = event.data as { thinking: string }
          setMessages((prev) => {
            const withoutThinking = prev.filter((m) => m.role !== 'thinking')
            return [
              ...withoutThinking,
              {
                id: nextMessageId(),
                role: 'thinking',
                content: data.thinking?.slice(0, 200) ?? 'Thinking...',
                timestamp: Date.now(),
              },
            ]
          })

          if (agentId) {
            updateAgent(agentId, { status: 'thinking' })
          }
          break
        }

        case 'tool_use': {
          const data = event.data as { id: string; name: string; input: Record<string, unknown> }
          setMessages((prev) => [
            ...prev.filter((m) => m.role !== 'thinking'),
            {
              id: nextMessageId(),
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              toolName: data.name,
              toolInput: data.input,
              toolUseId: data.id,
            },
          ])

          if (agentId) {
            updateAgent(agentId, { status: 'tool_calling', currentTask: data.name })
            addEvent({
              agentId,
              agentName: `Chat ${chatAgentCounter}`,
              type: 'tool_call',
              description: `${data.name}`,
            })

            // Track file modifications
            const fileTools = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
            if (fileTools.includes(data.name)) {
              const current = useAgentStore.getState().agents.find((a) => a.id === agentId)
              if (current) {
                updateAgent(agentId, { files_modified: current.files_modified + 1 })
              }
            }

            // Detect subagent spawns (Task tool = Claude spawning a subagent)
            if (data.name === 'Task') {
              const subId = `sub-${agentId}-${data.id}`
              const seat = subagentSeatCounter.current++
              const subDescription = (data.input?.description as string) ?? (data.input?.prompt as string)?.slice(0, 60) ?? 'Subtask'
              const subType = (data.input?.subagent_type as string) ?? 'general'

              activeSubagents.current.set(data.id, subId)
              addAgent({
                id: subId,
                name: subType.charAt(0).toUpperCase() + subType.slice(1),
                agent_type: 'mcp',
                status: 'thinking',
                currentTask: subDescription.slice(0, 60),
                model: '',
                tokens_input: 0,
                tokens_output: 0,
                files_modified: 0,
                started_at: Date.now(),
                deskIndex: -1,
                terminalId: agentId,
                isClaudeRunning: true,
                appearance: randomAppearance(),
                commitCount: 0,
                activeCelebration: null,
                celebrationStartedAt: null,
                sessionStats: { tokenHistory: [], peakInputRate: 0, peakOutputRate: 0, tokensByModel: {} },
                isSubagent: true,
                parentAgentId: agentId,
                meetingSeat: seat,
              })

              addEvent({
                agentId: subId,
                agentName: subType,
                type: 'spawn',
                description: `Subagent: ${subDescription.slice(0, 40)}`,
              })
            }
          }
          break
        }

        case 'tool_result': {
          const data = event.data as { tool_use_id: string; content: string; is_error?: boolean }
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: 'tool',
              content: data.content,
              timestamp: Date.now(),
              toolUseId: data.tool_use_id,
              isError: data.is_error,
            },
          ])

          // Complete subagent if this result is for a Task tool
          const subId = activeSubagents.current.get(data.tool_use_id)
          if (subId) {
            updateAgent(subId, {
              status: data.is_error ? 'error' : 'done',
              isClaudeRunning: false,
            })
            activeSubagents.current.delete(data.tool_use_id)

            // Remove subagent after a brief delay to show completion
            setTimeout(() => {
              removeAgent(subId)
            }, 5000)
          }

          if (agentId) {
            updateAgent(agentId, { status: 'streaming' })
          }
          break
        }

        case 'result': {
          const data = event.data as { result: string; is_error?: boolean; error?: string; usage?: Record<string, unknown> }

          // Remove any lingering thinking messages
          setMessages((prev) => prev.filter((m) => m.role !== 'thinking'))

          // Persist the final assistant response to memories (outside setState)
          setMessages((prev) => {
            const assistantMessages = prev.filter((m) => m.role === 'assistant' && !m.toolName)
            const lastAssistant = assistantMessages[assistantMessages.length - 1]
            if (lastAssistant?.content) {
              // Schedule persist outside React's batch update
              queueMicrotask(() => persistMessage(lastAssistant.content, 'assistant'))
            }
            return prev
          })

          if (data.is_error && data.error) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextMessageId(),
                role: 'error',
                content: data.error ?? 'Unknown error',
                timestamp: Date.now(),
              },
            ])
            setStatus('error')
          } else {
            setStatus('done')
          }

          if (agentId) {
            // Extract token usage from the result event
            const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined
            const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
            const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0

            const current = useAgentStore.getState().agents.find((a) => a.id === agentId)
            updateAgent(agentId, {
              status: data.is_error ? 'error' : 'done',
              isClaudeRunning: false,
              tokens_input: (current?.tokens_input ?? 0) + inputTokens,
              tokens_output: (current?.tokens_output ?? 0) + outputTokens,
            })
          }

          setClaudeSessionId(null)
          break
        }

        case 'error': {
          const data = event.data as { message: string }
          setMessages((prev) => [
            ...prev.filter((m) => m.role !== 'thinking'),
            {
              id: nextMessageId(),
              role: 'error',
              content: data.message,
              timestamp: Date.now(),
            },
          ])
          setStatus('error')

          if (agentId) {
            updateAgent(agentId, { status: 'error', isClaudeRunning: false })
          }
          setClaudeSessionId(null)
          break
        }
      }
    })

    return unsub
  }, [claudeSessionId, updateAgent, addEvent, persistMessage])

  const handleSend = useCallback(
    async (message: string, files?: File[]) => {
      // Build the prompt with file context
      let prompt = message
      if (files && files.length > 0) {
        const fileContents: string[] = []
        const binaryFiles: string[] = []

        for (const file of files) {
          try {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
            if (BINARY_EXTENSIONS.has(ext)) {
              // Binary file — note it but don't inline content
              binaryFiles.push(file.name)
              continue
            }
            const text = await file.text()
            // Strip null bytes from text files (safety)
            const safeText = text.replace(/\0/g, '')
            fileContents.push(`\n--- File: ${file.name} ---\n${safeText}\n--- End: ${file.name} ---`)
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`Failed to read file ${file.name}: ${errMsg}`)
          }
        }
        if (fileContents.length > 0) {
          prompt = `${message}\n\nAttached files:${fileContents.join('\n')}`
        }
        if (binaryFiles.length > 0) {
          prompt = `${prompt}\n\n[Attached binary files: ${binaryFiles.join(', ')} — binary content cannot be sent via CLI]`
        }
      }

      // Add user message to chat
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: 'user',
          content: message,
          timestamp: Date.now(),
        },
      ])

      // Persist user message to memories
      persistMessage(message, 'user')

      setStatus('running')

      // Reuse existing agent for this chat, or spawn one on first message
      let agentId = agentIdRef.current
      if (agentId) {
        // Reuse — just update status back to active
        updateAgent(agentId, {
          status: 'thinking',
          currentTask: message.slice(0, 60),
          isClaudeRunning: true,
        })
      } else {
        // First message — spawn a 3D agent with placeholder name
        agentId = `chat-agent-${++chatAgentCounter}-${Date.now()}`
        agentIdRef.current = agentId
        const deskIndex = getNextDeskIndex()
        const agentNum = chatAgentCounter

        addAgent({
          id: agentId,
          name: `Agent ${agentNum}`,
          agent_type: 'chat',
          status: 'thinking',
          currentTask: message.slice(0, 60),
          model: '',
          tokens_input: 0,
          tokens_output: 0,
          files_modified: 0,
          started_at: Date.now(),
          deskIndex,
          terminalId: agentId,
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
          },
        })

        // Link agent to chat session
        updateChatSession(chatSessionId, { agentId })

        addEvent({
          agentId,
          agentName: `Agent ${agentNum}`,
          type: 'spawn',
          description: 'Chat session started',
        })

        // Background: generate creative name + task description
        const capturedAgentId = agentId
        window.electronAPI.agent.generateMeta(message).then((meta) => {
          updateAgent(capturedAgentId, {
            name: meta.name,
            currentTask: meta.taskDescription,
          })
          updateChatSession(chatSessionId, { label: meta.name })
        }).catch(() => { /* fallback name stays */ })
      }

      try {
        const result = await window.electronAPI.claude.start({
          prompt,
          workingDirectory: workingDir ?? undefined,
          dangerouslySkipPermissions: yoloMode,
        })
        setClaudeSessionId(result.sessionId)
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`Failed to start Claude session: ${errMsg}`)
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            role: 'error',
            content: `Failed to start Claude: ${errMsg}`,
            timestamp: Date.now(),
          },
        ])
        setStatus('error')
        updateAgent(agentId, { status: 'error', isClaudeRunning: false })
      }
    },
    [addAgent, updateAgent, removeAgent, getNextDeskIndex, addEvent, workingDir, persistMessage, yoloMode, chatSessionId, updateChatSession]
  )

  const handleStop = useCallback(async () => {
    if (!claudeSessionId) return
    try {
      await window.electronAPI.claude.stop(claudeSessionId)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`Failed to stop Claude session: ${errMsg}`)
    }
    setStatus('done')
    setClaudeSessionId(null)

    if (agentIdRef.current) {
      updateAgent(agentIdRef.current, { status: 'done', isClaudeRunning: false })
    }
  }, [claudeSessionId, updateAgent])

  const isRunning = status === 'running'

  // ── Resizable input area ─────────────────────────────────────────
  const [inputHeight, setInputHeight] = useState(100)
  const isDraggingDivider = useRef(false)
  const lastPointerY = useRef(0)

  const handleDividerPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingDivider.current = true
    lastPointerY.current = e.clientY
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }, [])

  const handleDividerPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingDivider.current) return
    const delta = lastPointerY.current - e.clientY
    lastPointerY.current = e.clientY
    setInputHeight((prev) => Math.max(60, Math.min(400, prev + delta)))
  }, [])

  const handleDividerPointerUp = useCallback(() => {
    isDraggingDivider.current = false
  }, [])

  const handleToggleYolo = useCallback(() => {
    const current = useSettingsStore.getState().settings
    const updated = { ...current, yoloMode: !current.yoloMode }
    useSettingsStore.getState().setSettings(updated)
    window.electronAPI.settings.set(updated).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ChatPanel] Failed to save yolo setting: ${msg}`)
    })
  }, [])

  // Derive display label for cwd
  const cwdLabel = workingDir
    ? workingDir.split('/').pop() ?? workingDir
    : 'No folder selected'
  const modeLabel = isDirectoryCustom ? 'custom' : 'workspace'
  const modeLetter = isDirectoryCustom ? 'C' : 'W'
  const recentDirectoryOptions = recentFolders.filter((path) => path !== workingDir).slice(0, 8)
  const showSyncToWorkspace = Boolean(
    workspaceRoot && (workingDir !== workspaceRoot || isDirectoryCustom)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Working directory header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
        borderBottom: '1px solid rgba(89,86,83,0.15)', fontSize: 11,
        flexShrink: 0, minHeight: 26,
      }}>
        <span style={{ color: '#595653' }}>$</span>
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
            border: `1px solid ${isDirectoryCustom ? 'rgba(200,120,48,0.5)' : 'rgba(84,140,90,0.5)'}`,
            color: isDirectoryCustom ? '#c87830' : '#548C5A',
            background: isDirectoryCustom ? 'rgba(200,120,48,0.1)' : 'rgba(84,140,90,0.1)',
          }}
        >
          {modeLetter}
        </span>
        <span
          title={`Scope: ${scopeName}`}
          style={{
            padding: '1px 6px',
            borderRadius: 999,
            border: '1px solid rgba(116,116,124,0.35)',
            color: '#9A9692',
            fontSize: 10,
            fontWeight: 600,
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {scopeName}
        </span>
        <span
          title={workingDir ?? 'No working directory selected'}
          style={{
            color: showSyncToWorkspace ? '#c87830' : '#74747C',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}
        >
          {cwdLabel}
        </span>
        {showSyncToWorkspace && (
          <button
            onClick={handleSyncToWorkspace}
            title={workspaceRoot ? `Sync to ${workspaceRoot}` : 'Clear workspace directory'}
            style={{
              background: 'transparent', border: 'none', color: '#548C5A',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, padding: '0 4px',
            }}
          >
            sync
          </button>
        )}
        <div ref={recentMenuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowRecentMenu((prev) => !prev)}
            title={recentDirectoryOptions.length > 0 ? 'Switch chat scope from recent folders' : 'No recent folders'}
            disabled={recentDirectoryOptions.length === 0 && !workspaceRoot}
            style={{
              background: 'transparent',
              border: 'none',
              color: recentDirectoryOptions.length > 0 || workspaceRoot ? '#595653' : '#3f3e3c',
              cursor: recentDirectoryOptions.length > 0 || workspaceRoot ? 'pointer' : 'default',
              fontFamily: 'inherit',
              fontSize: 11,
              padding: '0 4px',
            }}
          >
            recent
          </button>
          {showRecentMenu && (
            <div
              className="glass-panel"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                minWidth: 240,
                maxWidth: 360,
                borderRadius: 8,
                padding: '4px 0',
                zIndex: 30,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              {workspaceRoot && (
                <button
                  onClick={() => {
                    handleSyncToWorkspace()
                    setShowRecentMenu(false)
                  }}
                  className="hover-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: '#9A9692',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  title={workspaceRoot}
                >
                  <span style={{ color: '#548C5A', fontWeight: 700 }}>W</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {workspaceRoot}
                  </span>
                </button>
              )}
              {recentDirectoryOptions.map((path) => (
                <button
                  key={path}
                  onClick={() => handleSelectRecentDirectory(path)}
                  className="hover-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: '#9A9692',
                    fontFamily: 'inherit',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  title={path}
                >
                  <span style={{ color: '#c87830', fontWeight: 700 }}>C</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {path}
                  </span>
                </button>
              ))}
              {!workspaceRoot && recentDirectoryOptions.length === 0 && (
                <div style={{ padding: '6px 10px', color: '#595653', fontSize: 11 }}>
                  No recent folders yet
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => void handleChangeWorkingDir()}
          title="Pick folder for this chat"
          style={{
            background: 'transparent', border: 'none', color: '#595653',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: '0 4px',
          }}
        >
          pick
        </button>
        <button
          onClick={handleToggleYolo}
          title={yoloMode ? 'YOLO mode ON — bypassing permissions' : 'YOLO mode OFF — normal permissions'}
          style={{
            background: yoloMode ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
            border: yoloMode ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid transparent',
            borderRadius: 4,
            color: yoloMode ? '#ef4444' : '#595653',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 10,
            padding: '1px 6px', fontWeight: yoloMode ? 600 : 400,
            transition: 'all 0.15s ease',
          }}
        >
          YOLO
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', minHeight: 0 }}>
        {messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 24 }}>👾</span>
            <span style={{ color: '#74747C', fontSize: 'inherit' }}>Ask Claude anything</span>
            <span style={{ color: '#595653', fontSize: 11 }}>
              {workingDir ? `Working in ${cwdLabel}` : 'Pick a folder to scope this chat'}
            </span>
            {!workingDir && (
              <button
                onClick={() => void handleChangeWorkingDir()}
                style={{
                  marginTop: 6,
                  background: 'rgba(84,140,90,0.12)',
                  color: '#7fb887',
                  border: '1px solid rgba(84,140,90,0.35)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Choose folder
              </button>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            {isRunning && messages[messages.length - 1]?.role !== 'thinking' && (
              <TypingIndicator />
            )}
            <div ref={chatEndRef} />
          </>
        )}
      </div>

      {/* Draggable divider */}
      <div
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={handleDividerPointerUp}
        style={{
          height: 5,
          cursor: 'row-resize',
          flexShrink: 0,
          position: 'relative',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 0,
            right: 0,
            height: 1,
            background: 'rgba(89, 86, 83, 0.3)',
            transition: 'background 0.15s ease',
          }}
        />
      </div>

      {/* Input — resizable */}
      <div style={{ height: inputHeight, flexShrink: 0, overflow: 'hidden' }}>
        <ChatInput
          onSend={handleSend}
          isRunning={isRunning}
          onStop={handleStop}
        />
      </div>
    </div>
  )
}
