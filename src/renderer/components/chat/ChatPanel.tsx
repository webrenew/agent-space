import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChatMessage, ClaudeEvent, WorkspaceContextSnapshot } from '../../types'
import { randomAppearance } from '../../types'
import { useAgentStore } from '../../store/agents'
import { useWorkspaceStore } from '../../store/workspace'
import { useWorkspaceIntelligenceStore } from '../../store/workspaceIntelligence'
import { useSettingsStore } from '../../store/settings'
import { useChatHistoryStore } from '../../store/chatHistory'
import { matchScope } from '../../lib/scopeMatcher'
import { playChatCompletionDing } from '../../lib/soundPlayer'
import { buildWorkspaceContextPrompt } from '../../lib/workspaceContext'
import { computeRunReward } from '../../lib/rewardEngine'
import { logRendererEvent } from '../../lib/diagnostics'
import { resolveClaudeProfile } from '../../lib/claudeProfile'
import {
  emitPluginHook,
  getRegisteredPluginCommands,
  invokePluginCommand,
} from '../../plugins/runtime'
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
const MENTION_PATTERN = /(?:^|\s)@{([^}\n]+)}|(?:^|\s)@([^\s@]+)/g
const MAX_REFERENCED_FILES = 12

let chatMessageCounter = 0
let chatAgentCounter = 0

function nextMessageId(): string {
  return `msg-${++chatMessageCounter}`
}

function normalizeMentionPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function toRelativePathIfInside(rootDir: string, absolutePath: string): string | null {
  const normalizedRoot = toForwardSlashes(rootDir).replace(/\/+$/, '')
  const normalizedPath = toForwardSlashes(absolutePath)
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return null
}

function extractMentionPaths(message: string): string[] {
  const mentions: string[] = []
  const seen = new Set<string>()
  for (const match of message.matchAll(MENTION_PATTERN)) {
    const raw = match[1] ?? match[2] ?? ''
    const normalized = normalizeMentionPath(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    mentions.push(normalized)
  }
  return mentions
}

function parseSlashCommandInput(message: string): {
  name: string
  argsRaw: string
  args: string[]
} | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  const firstSpace = trimmed.indexOf(' ')
  const token = firstSpace >= 0 ? trimmed.slice(1, firstSpace) : trimmed.slice(1)
  const name = token.trim()
  if (!name) return null
  const argsRaw = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : ''
  return {
    name,
    argsRaw,
    args: argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [],
  }
}

interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  tokensByModel: Record<string, { input: number; output: number }>
  hasAnyUsage: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readTokenValue(record: Record<string, unknown> | null, keys: string[]): { found: boolean; value: number } {
  if (!record) return { found: false, value: 0 }
  for (const key of keys) {
    if (key in record) {
      return { found: true, value: toFiniteNumber(record[key]) }
    }
  }
  return { found: false, value: 0 }
}

function cloneTokensByModel(
  tokensByModel: Record<string, { input: number; output: number }>
): Record<string, { input: number; output: number }> {
  const clone: Record<string, { input: number; output: number }> = {}
  for (const [model, tokens] of Object.entries(tokensByModel)) {
    clone[model] = {
      input: toFiniteNumber(tokens.input),
      output: toFiniteNumber(tokens.output),
    }
  }
  return clone
}

function parseUsageSnapshot(usageValue: unknown, modelUsageValue: unknown): UsageSnapshot {
  const usage = asRecord(usageValue)
  const modelUsage = asRecord(modelUsageValue)
  const inputRead = readTokenValue(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input'])
  const outputRead = readTokenValue(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output'])

  const tokensByModel: Record<string, { input: number; output: number }> = {}
  if (modelUsage) {
    for (const [model, raw] of Object.entries(modelUsage)) {
      const entry = asRecord(raw)
      if (!entry) continue
      const modelInput = readTokenValue(entry, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens', 'input']).value
      const modelOutput = readTokenValue(entry, ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens', 'output']).value
      if (modelInput === 0 && modelOutput === 0) continue
      tokensByModel[model] = { input: modelInput, output: modelOutput }
    }
  }

  const modelInputSum = Object.values(tokensByModel).reduce((sum, t) => sum + t.input, 0)
  const modelOutputSum = Object.values(tokensByModel).reduce((sum, t) => sum + t.output, 0)
  const hasUsageFields = inputRead.found || outputRead.found
  const hasModelUsage = Object.keys(tokensByModel).length > 0

  return {
    inputTokens: hasUsageFields ? inputRead.value : modelInputSum,
    outputTokens: hasUsageFields ? outputRead.value : modelOutputSum,
    tokensByModel,
    hasAnyUsage: hasUsageFields || hasModelUsage,
  }
}

function truncateForHook(value: string, max = 500): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
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
  const activeClaudeSessionIdRef = useRef<string | null>(null)
  const agentIdRef = useRef<string | null>(null)
  const activeRunDirectoryRef = useRef<string | null>(null)
  const runTokenBaselineRef = useRef<{ input: number; output: number } | null>(null)
  const runModelBaselineRef = useRef<Record<string, { input: number; output: number }> | null>(null)
  const runStartedAtRef = useRef<number | null>(null)
  const runContextFilesRef = useRef(0)
  const runUnresolvedMentionsRef = useRef(0)
  const runToolCallCountRef = useRef(0)
  const runFileWriteCountRef = useRef(0)
  const runYoloModeRef = useRef(false)
  const runRewardRecordedRef = useRef(false)
  const subagentSeatCounter = useRef(0)
  const activeSubagents = useRef<Map<string, string>>(new Map()) // toolUseId → subagentId

  const addAgent = useAgentStore((s) => s.addAgent)
  const removeAgent = useAgentStore((s) => s.removeAgent)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const getNextDeskIndex = useAgentStore((s) => s.getNextDeskIndex)
  const addEvent = useAgentStore((s) => s.addEvent)
  const addToast = useAgentStore((s) => s.addToast)
  const updateChatSession = useAgentStore((s) => s.updateChatSession)
  const chatSession = useAgentStore(
    (s) => s.chatSessions.find((session) => session.id === chatSessionId) ?? null
  )

  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const recentFolders = useWorkspaceStore((s) => s.recentFolders)
  const scopes = useSettingsStore((s) => s.settings.scopes)
  const claudeProfilesConfig = useSettingsStore((s) => s.settings.claudeProfiles)
  const soundsEnabled = useSettingsStore((s) => s.settings.soundsEnabled)
  const yoloMode = useSettingsStore((s) => s.settings.yoloMode)
  const loadHistory = useChatHistoryStore((s) => s.loadHistory)
  const getHistory = useChatHistoryStore((s) => s.getHistory)
  const isHistoryLoaded = useChatHistoryStore((s) => s.isLoaded)
  const upsertWorkspaceSnapshot = useWorkspaceIntelligenceStore((s) => s.upsertSnapshot)
  const setChatContextSnapshot = useWorkspaceIntelligenceStore((s) => s.setChatContextSnapshot)
  const addReward = useWorkspaceIntelligenceStore((s) => s.addReward)
  const rewards = useWorkspaceIntelligenceStore((s) => s.rewards)
  const latestContextForChat = useWorkspaceIntelligenceStore((s) => s.latestContextByChat[chatSessionId] ?? null)
  const [showRecentMenu, setShowRecentMenu] = useState(false)
  const recentMenuRef = useRef<HTMLDivElement>(null)

  const latestRewardForChat = useMemo(() => {
    for (let index = rewards.length - 1; index >= 0; index -= 1) {
      const candidate = rewards[index]
      if (candidate.chatSessionId === chatSessionId) {
        return candidate
      }
    }
    return null
  }, [chatSessionId, rewards])

  const setActiveClaudeSession = useCallback((sessionId: string | null) => {
    activeClaudeSessionIdRef.current = sessionId
    setClaudeSessionId(sessionId)
  }, [])

  const workingDir = chatSession ? chatSession.workingDirectory : fallbackWorkingDir
  const isDirectoryCustom = chatSession ? chatSession.directoryMode === 'custom' : false
  const hasStartedConversation = Boolean(chatSession?.agentId)
  const isRunActive = status === 'running' || Boolean(claudeSessionId)
  const activeClaudeProfile = useMemo(() => {
    return resolveClaudeProfile(claudeProfilesConfig, workingDir ?? null)
  }, [claudeProfilesConfig, workingDir])

  useEffect(() => {
    agentIdRef.current = chatSession?.agentId ?? null
  }, [chatSession?.agentId])

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

  useEffect(() => {
    if (isRunActive) {
      setShowRecentMenu(false)
    }
  }, [isRunActive])

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
  const persistMessage = useCallback((
    content: string,
    role: string,
    context?: { directory?: string | null; scopeId?: string; scopeName?: string }
  ) => {
    const directory = context?.directory ?? workingDir
    const derivedScope = directory ? matchScope(directory, scopes) : null
    const nextScopeId = context?.scopeId ?? derivedScope?.id ?? scopeId
    const nextScopeName = context?.scopeName ?? derivedScope?.name ?? scopeName

    window.electronAPI.memories.addChatMessage({
      content,
      role,
      scopeId: nextScopeId,
      scopeName: nextScopeName,
      workspacePath: directory ?? '',
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ChatPanel] Failed to persist message: ${msg}`)
    })
  }, [scopeId, scopeName, scopes, workingDir])

  const clearSubagentsForParent = useCallback((parentAgentId: string) => {
    const subagentIds = new Set(activeSubagents.current.values())
    for (const agent of useAgentStore.getState().agents) {
      if (agent.isSubagent && agent.parentAgentId === parentAgentId) {
        subagentIds.add(agent.id)
      }
    }
    activeSubagents.current.clear()
    for (const subId of subagentIds) {
      removeAgent(subId)
    }
  }, [removeAgent])

  const applyUsageSnapshot = useCallback(
    (agentId: string, usageValue: unknown, modelUsageValue: unknown) => {
      const snapshot = parseUsageSnapshot(usageValue, modelUsageValue)
      if (!snapshot.hasAnyUsage) return

      const current = useAgentStore.getState().agents.find((a) => a.id === agentId)
      if (!current) return

      if (!runTokenBaselineRef.current) {
        runTokenBaselineRef.current = {
          input: current.tokens_input,
          output: current.tokens_output,
        }
      }
      if (!runModelBaselineRef.current) {
        runModelBaselineRef.current = cloneTokensByModel(current.sessionStats.tokensByModel)
      }

      const baseline = runTokenBaselineRef.current ?? {
        input: current.tokens_input,
        output: current.tokens_output,
      }
      const updates = {
        tokens_input: baseline.input + snapshot.inputTokens,
        tokens_output: baseline.output + snapshot.outputTokens,
      } as {
        tokens_input: number
        tokens_output: number
        sessionStats?: typeof current.sessionStats
      }

      if (Object.keys(snapshot.tokensByModel).length > 0) {
        const modelBaseline = runModelBaselineRef.current ?? {}
        const nextTokensByModel = cloneTokensByModel(modelBaseline)
        for (const [model, tokens] of Object.entries(snapshot.tokensByModel)) {
          const base = nextTokensByModel[model] ?? { input: 0, output: 0 }
          nextTokensByModel[model] = {
            input: base.input + tokens.input,
            output: base.output + tokens.output,
          }
        }
        updates.sessionStats = {
          ...current.sessionStats,
          tokensByModel: nextTokensByModel,
        }
      }

      updateAgent(agentId, updates)
    },
    [updateAgent]
  )

  const finalizeRunReward = useCallback((status: 'success' | 'error' | 'stopped') => {
    if (runRewardRecordedRef.current) return
    runRewardRecordedRef.current = true

    const workspaceDirectory = activeRunDirectoryRef.current
    const agentId = agentIdRef.current
    const durationMs = runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0
    let rewardScore: number | null = null

    if (workspaceDirectory && agentId) {
      const baseline = runTokenBaselineRef.current
      const agent = useAgentStore.getState().agents.find((entry) => entry.id === agentId)
      const tokenDeltaInput = Math.max(
        0,
        (agent?.tokens_input ?? baseline?.input ?? 0) - (baseline?.input ?? 0)
      )
      const tokenDeltaOutput = Math.max(
        0,
        (agent?.tokens_output ?? baseline?.output ?? 0) - (baseline?.output ?? 0)
      )

      const reward = addReward(computeRunReward({
        chatSessionId,
        workspaceDirectory,
        status,
        durationMs,
        tokenDeltaInput,
        tokenDeltaOutput,
        contextFiles: runContextFilesRef.current,
        toolCalls: runToolCallCountRef.current,
        fileWrites: runFileWriteCountRef.current,
        unresolvedMentions: runUnresolvedMentionsRef.current,
        yoloMode: runYoloModeRef.current,
      }))
      rewardScore = reward.rewardScore

      addEvent({
        agentId,
        agentName: chatSession?.label ?? 'Chat',
        type: 'status_change',
        description: `Reward ${reward.rewardScore} (${status})`,
      })
      logRendererEvent('info', 'chat.reward.recorded', {
        chatSessionId,
        workspaceDirectory,
        status,
        rewardScore: reward.rewardScore,
        tokenDeltaInput,
        tokenDeltaOutput,
        contextFiles: runContextFilesRef.current,
        toolCalls: runToolCallCountRef.current,
        fileWrites: runFileWriteCountRef.current,
        unresolvedMentions: runUnresolvedMentionsRef.current,
        yoloMode: runYoloModeRef.current,
      })
    }

    void emitPluginHook('session_end', {
      chatSessionId,
      workspaceDirectory: workspaceDirectory ?? workingDir ?? null,
      agentId,
      timestamp: Date.now(),
      status,
      durationMs,
      rewardScore,
    })
  }, [addEvent, addReward, chatSession?.label, chatSessionId, workingDir])

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

  const applyDirectorySelection = useCallback((selected: string) => {
    if (chatSession) {
      updateChatSession(chatSessionId, {
        workingDirectory: selected,
        directoryMode: selected === workspaceRoot ? 'workspace' : 'custom',
      })
    } else {
      setFallbackWorkingDir(selected)
    }
  }, [chatSession, chatSessionId, updateChatSession, workspaceRoot])

  const handleChangeWorkingDir = useCallback(async () => {
    if (isRunActive) {
      addToast({
        type: 'info',
        message: 'Stop the current run before changing chat folder scope.',
      })
      return
    }
    try {
      const selected = await window.electronAPI.fs.openFolderDialog()
      if (!selected) return
      applyDirectorySelection(selected)
    } catch (err) {
      console.error('[ChatPanel] Failed to change working directory:', err)
    }
  }, [addToast, applyDirectorySelection, isRunActive])

  const handleSyncToWorkspace = useCallback(() => {
    if (isRunActive) {
      addToast({
        type: 'info',
        message: 'Stop the current run before changing chat folder scope.',
      })
      return
    }
    if (chatSession) {
      updateChatSession(chatSessionId, {
        workingDirectory: workspaceRoot ?? null,
        directoryMode: 'workspace',
      })
      return
    }
    setFallbackWorkingDir(workspaceRoot ?? null)
  }, [addToast, chatSession, chatSessionId, isRunActive, updateChatSession, workspaceRoot])

  const handleSelectRecentDirectory = useCallback(
    (path: string) => {
      if (isRunActive) {
        addToast({
          type: 'info',
          message: 'Stop the current run before changing chat folder scope.',
        })
        setShowRecentMenu(false)
        return
      }
      if (path === workspaceRoot) {
        handleSyncToWorkspace()
      } else {
        applyDirectorySelection(path)
      }
      setShowRecentMenu(false)
    },
    [addToast, applyDirectorySelection, handleSyncToWorkspace, isRunActive, workspaceRoot]
  )

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Handle incoming Claude events
  useEffect(() => {
    const unsub = window.electronAPI.claude.onEvent((event: ClaudeEvent) => {
      const activeSessionId = activeClaudeSessionIdRef.current
      if (!activeSessionId || event.sessionId !== activeSessionId) return

      const agentId = agentIdRef.current
      if (agentId) {
        const usagePayload = event.data as { usage?: unknown; modelUsage?: unknown }
        applyUsageSnapshot(agentId, usagePayload.usage, usagePayload.modelUsage)
      }

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
          runToolCallCountRef.current += 1
          void emitPluginHook('before_tool_call', {
            chatSessionId,
            workspaceDirectory: activeRunDirectoryRef.current ?? workingDir ?? null,
            agentId,
            timestamp: Date.now(),
            toolName: data.name,
            toolUseId: data.id,
            toolInput: data.input,
          })
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
              runFileWriteCountRef.current += 1
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
                terminalId: subId,
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
          void emitPluginHook('after_tool_call', {
            chatSessionId,
            workspaceDirectory: activeRunDirectoryRef.current ?? workingDir ?? null,
            agentId,
            timestamp: Date.now(),
            toolUseId: data.tool_use_id,
            isError: data.is_error === true,
            contentPreview: truncateForHook(data.content, 240),
          })
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
          const data = event.data as { result: string; is_error?: boolean; error?: string }

          // Remove any lingering thinking messages
          setMessages((prev) => prev.filter((m) => m.role !== 'thinking'))

          // Persist the final assistant response to memories (outside setState)
          setMessages((prev) => {
            const assistantMessages = prev.filter((m) => m.role === 'assistant' && !m.toolName)
            const lastAssistant = assistantMessages[assistantMessages.length - 1]
            if (lastAssistant?.content) {
              // Schedule persist outside React's batch update
              const activeRunDir = activeRunDirectoryRef.current
              queueMicrotask(() => {
                persistMessage(lastAssistant.content, 'assistant', { directory: activeRunDir })
                void emitPluginHook('message_sent', {
                  chatSessionId,
                  workspaceDirectory: activeRunDir ?? workingDir ?? null,
                  agentId,
                  timestamp: Date.now(),
                  role: 'assistant',
                  message: truncateForHook(lastAssistant.content),
                  messageLength: lastAssistant.content.length,
                })
              })
            }
            return prev
          })

          if (data.is_error && data.error) {
            void emitPluginHook('message_sent', {
              chatSessionId,
              workspaceDirectory: activeRunDirectoryRef.current ?? workingDir ?? null,
              agentId,
              timestamp: Date.now(),
              role: 'error',
              message: truncateForHook(data.error),
              messageLength: data.error.length,
            })
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
            playChatCompletionDing(soundsEnabled)
          }

          if (agentId) {
            updateAgent(agentId, {
              status: data.is_error ? 'error' : 'done',
              isClaudeRunning: false,
            })
            clearSubagentsForParent(agentId)
          }
          finalizeRunReward(data.is_error ? 'error' : 'success')

          setActiveClaudeSession(null)
          activeRunDirectoryRef.current = null
          runTokenBaselineRef.current = null
          runModelBaselineRef.current = null
          runStartedAtRef.current = null
          break
        }

        case 'error': {
          const data = event.data as { message: string }
          void emitPluginHook('message_sent', {
            chatSessionId,
            workspaceDirectory: activeRunDirectoryRef.current ?? workingDir ?? null,
            agentId,
            timestamp: Date.now(),
            role: 'error',
            message: truncateForHook(data.message),
            messageLength: data.message.length,
          })
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
            clearSubagentsForParent(agentId)
          }
          finalizeRunReward('error')
          setActiveClaudeSession(null)
          activeRunDirectoryRef.current = null
          runTokenBaselineRef.current = null
          runModelBaselineRef.current = null
          runStartedAtRef.current = null
          break
        }
      }
    })

    return unsub
  }, [addEvent, applyUsageSnapshot, clearSubagentsForParent, finalizeRunReward, persistMessage, setActiveClaudeSession, soundsEnabled, updateAgent])

  const resolveMentionedFiles = useCallback(async (rootDir: string, mentions: string[]) => {
    const normalizedMentions = Array.from(
      new Set(mentions.map((mention) => normalizeMentionPath(mention).toLowerCase()))
    )
      .filter(Boolean)
      .slice(0, MAX_REFERENCED_FILES)

    if (normalizedMentions.length === 0) {
      return {
        resolved: [] as Array<{ mention: string; path: string; relPath: string }>,
        unresolved: [] as string[],
      }
    }

    const lookups = await Promise.all(
      normalizedMentions.map(async (mention) => {
        try {
          const hits = await window.electronAPI.fs.search(rootDir, mention, 25)
          return { mention, hits }
        } catch (err) {
          console.error(`[ChatPanel] Failed to resolve @${mention}:`, err)
          return {
            mention,
            hits: [] as Array<{ path: string; name: string; isDirectory: boolean }>,
          }
        }
      })
    )

    const resolved: Array<{ mention: string; path: string; relPath: string }> = []
    const unresolved: string[] = []
    const seenPaths = new Set<string>()

    for (const { mention, hits } of lookups) {
      let bestMatch: { path: string; relPath: string; score: number } | null = null

      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i]
        if (hit.isDirectory) continue

        const relPathRaw = toRelativePathIfInside(rootDir, hit.path) ?? hit.name
        const relPath = normalizeMentionPath(relPathRaw)
        if (!relPath) continue

        const relLower = relPath.toLowerCase()
        const nameLower = hit.name.toLowerCase()
        let score = 0

        if (relLower === mention) score += 500
        if (relLower.endsWith(`/${mention}`)) score += 320
        if (nameLower === mention) score += 220
        if (relLower.includes(mention)) score += 100
        score += Math.max(0, 30 - i)

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { path: hit.path, relPath, score }
        }
      }

      if (!bestMatch) {
        unresolved.push(mention)
        continue
      }
      if (seenPaths.has(bestMatch.path)) continue
      seenPaths.add(bestMatch.path)
      resolved.push({
        mention,
        path: bestMatch.path,
        relPath: bestMatch.relPath,
      })
    }

    return { resolved, unresolved }
  }, [])

  const handleSend = useCallback(
    async (message: string, files?: File[], mentions?: string[]) => {
      let effectiveWorkingDir = workingDir
      if (!effectiveWorkingDir) {
        try {
          const selected = await window.electronAPI.fs.openFolderDialog()
          if (!selected) {
            addToast({
              type: 'error',
              message: 'Select a folder before starting this chat.',
            })
            return
          }
          applyDirectorySelection(selected)
          effectiveWorkingDir = selected
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          addToast({
            type: 'error',
            message: `Failed to choose folder: ${errMsg}`,
          })
          return
        }
      }

      const slashCommand = parseSlashCommandInput(message)
      if (slashCommand) {
        const mentionTokens = mentions && mentions.length > 0
          ? mentions
          : extractMentionPaths(message)
        const now = Date.now()
        void emitPluginHook('message_received', {
          chatSessionId,
          workspaceDirectory: effectiveWorkingDir,
          agentId: agentIdRef.current,
          timestamp: now,
          message: truncateForHook(message),
          messageLength: message.length,
          mentionCount: mentionTokens.length,
          attachmentCount: files?.length ?? 0,
        })

        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            role: 'user',
            content: message,
            timestamp: now,
          },
        ])
        persistMessage(message, 'user', { directory: effectiveWorkingDir })

        const commandResult = await invokePluginCommand(slashCommand.name, {
          chatSessionId,
          workspaceDirectory: effectiveWorkingDir,
          agentId: agentIdRef.current,
          rawMessage: message,
          argsRaw: slashCommand.argsRaw,
          args: slashCommand.args,
          attachmentNames: files?.map((file) => file.name) ?? [],
          mentionPaths: mentionTokens,
        })

        if (!commandResult.handled) {
          const knownCommands = getRegisteredPluginCommands()
          const commandsPreview = knownCommands.slice(0, 6).map((entry) => `/${entry.name}`)
          const hint = knownCommands.length > 0
            ? `Available commands: ${commandsPreview.join(', ')}${knownCommands.length > 6 ? ', ...' : ''}`
            : 'No plugin commands are currently loaded.'
          const messageText = `Unknown command "/${slashCommand.name}". ${hint}`
          void emitPluginHook('message_sent', {
            chatSessionId,
            workspaceDirectory: effectiveWorkingDir,
            agentId: agentIdRef.current,
            timestamp: Date.now(),
            role: 'error',
            message: truncateForHook(messageText),
            messageLength: messageText.length,
          })
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: 'error',
              content: messageText,
              timestamp: Date.now(),
            },
          ])
          return
        }

        const responseText = commandResult.message
        if (responseText) {
          const responseRole: 'assistant' | 'error' = commandResult.isError ? 'error' : 'assistant'
          void emitPluginHook('message_sent', {
            chatSessionId,
            workspaceDirectory: effectiveWorkingDir,
            agentId: agentIdRef.current,
            timestamp: Date.now(),
            role: responseRole,
            message: truncateForHook(responseText),
            messageLength: responseText.length,
          })
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: responseRole,
              content: responseText,
              timestamp: Date.now(),
            },
          ])
          if (!commandResult.isError) {
            persistMessage(responseText, 'assistant', { directory: effectiveWorkingDir })
          }
        }
        return
      }

      // Build the prompt with file + workspace context
      let prompt = message
      const mentionTokens = mentions && mentions.length > 0
        ? mentions
        : extractMentionPaths(message)
      const referenceNotes: string[] = []
      let resolvedMentionCount = 0
      let unresolvedMentionCount = 0

      let workspaceSnapshot: WorkspaceContextSnapshot | null = null
      try {
        workspaceSnapshot = await window.electronAPI.context.getWorkspaceSnapshot(effectiveWorkingDir)
        upsertWorkspaceSnapshot(workspaceSnapshot)
      } catch (err) {
        logRendererEvent('warn', 'chat.workspace_snapshot_failed', {
          chatSessionId,
          workingDirectory: effectiveWorkingDir,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      if (mentionTokens.length > 0 && effectiveWorkingDir) {
        const { resolved, unresolved } = await resolveMentionedFiles(effectiveWorkingDir, mentionTokens)
        resolvedMentionCount = resolved.length
        unresolvedMentionCount = unresolved.length
        const referencedContents: string[] = []

        for (const ref of resolved) {
          try {
            const fileData = await window.electronAPI.fs.readFile(ref.path)
            const safeText = fileData.content.replace(/\0/g, '')
            referencedContents.push(`\n--- Referenced file: ${ref.relPath} ---\n${safeText}\n--- End: ${ref.relPath} ---`)
            if (fileData.truncated) {
              referenceNotes.push(`${ref.relPath} (truncated to 2MB preview)`)
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            referenceNotes.push(`${ref.relPath} (failed to read: ${errMsg})`)
          }
        }

        if (referencedContents.length > 0) {
          prompt = `${prompt}\n\nReferenced files via @:${referencedContents.join('\n')}`
        }
        if (unresolved.length > 0) {
          referenceNotes.push(`Unresolved @ references: ${unresolved.map((entry) => `@${entry}`).join(', ')}`)
        }
      }

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
          prompt = `${prompt}\n\nAttached files:${fileContents.join('\n')}`
        }
        if (binaryFiles.length > 0) {
          prompt = `${prompt}\n\n[Attached binary files: ${binaryFiles.join(', ')} — binary content cannot be sent via CLI]`
        }
      }
      if (referenceNotes.length > 0) {
        prompt = `${prompt}\n\n[Reference notes: ${referenceNotes.join(' | ')}]`
      }

      if (workspaceSnapshot) {
        prompt = `${prompt}\n\n${buildWorkspaceContextPrompt(workspaceSnapshot)}`
      }

      void emitPluginHook('message_received', {
        chatSessionId,
        workspaceDirectory: effectiveWorkingDir,
        agentId: agentIdRef.current,
        timestamp: Date.now(),
        message: truncateForHook(message),
        messageLength: message.length,
        mentionCount: mentionTokens.length,
        attachmentCount: files?.length ?? 0,
      })

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
      persistMessage(message, 'user', { directory: effectiveWorkingDir })

      setStatus('running')
      activeRunDirectoryRef.current = effectiveWorkingDir
      runStartedAtRef.current = Date.now()
      runContextFilesRef.current =
        resolvedMentionCount
        + (files?.length ?? 0)
        + Math.min(workspaceSnapshot?.keyFiles.length ?? 0, 6)
      runUnresolvedMentionsRef.current = unresolvedMentionCount
      runToolCallCountRef.current = 0
      runFileWriteCountRef.current = 0
      runYoloModeRef.current = yoloMode
      runRewardRecordedRef.current = false

      setChatContextSnapshot({
        chatSessionId,
        workspaceDirectory: effectiveWorkingDir,
        contextFiles: runContextFilesRef.current,
        unresolvedMentions: unresolvedMentionCount,
        generatedAt: workspaceSnapshot?.generatedAt ?? Date.now(),
        gitBranch: workspaceSnapshot?.gitBranch ?? null,
        gitDirtyFiles: workspaceSnapshot?.gitDirtyFiles ?? 0,
      })
      const profileForRun = resolveClaudeProfile(claudeProfilesConfig, effectiveWorkingDir)

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

      const currentAgent = useAgentStore.getState().agents.find((a) => a.id === agentId)
      runTokenBaselineRef.current = {
        input: currentAgent?.tokens_input ?? 0,
        output: currentAgent?.tokens_output ?? 0,
      }
      runModelBaselineRef.current = cloneTokensByModel(currentAgent?.sessionStats.tokensByModel ?? {})
      void emitPluginHook('session_start', {
        chatSessionId,
        workspaceDirectory: effectiveWorkingDir,
        agentId,
        timestamp: Date.now(),
        promptPreview: truncateForHook(message, 240),
        yoloMode,
        profileId: profileForRun.profile.id,
        profileSource: profileForRun.source,
      })

      try {
        const result = await window.electronAPI.claude.start({
          prompt,
          workingDirectory: effectiveWorkingDir ?? undefined,
          dangerouslySkipPermissions: yoloMode,
        })
        setActiveClaudeSession(result.sessionId)
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
        finalizeRunReward('error')
        activeRunDirectoryRef.current = null
        runTokenBaselineRef.current = null
        runModelBaselineRef.current = null
        runStartedAtRef.current = null
      }
    },
    [
      addAgent,
      addEvent,
      addToast,
      applyDirectorySelection,
      chatSessionId,
      finalizeRunReward,
      getNextDeskIndex,
      persistMessage,
      removeAgent,
      setChatContextSnapshot,
      upsertWorkspaceSnapshot,
      updateAgent,
      updateChatSession,
      resolveMentionedFiles,
      workingDir,
      yoloMode,
    ]
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
    setActiveClaudeSession(null)

    if (agentIdRef.current) {
      updateAgent(agentIdRef.current, { status: 'done', isClaudeRunning: false })
      clearSubagentsForParent(agentIdRef.current)
    }
    finalizeRunReward('stopped')
    activeRunDirectoryRef.current = null
    runTokenBaselineRef.current = null
    runModelBaselineRef.current = null
    runStartedAtRef.current = null
  }, [claudeSessionId, clearSubagentsForParent, finalizeRunReward, setActiveClaudeSession, updateAgent])

  const isRunning = isRunActive

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
        {latestContextForChat && (
          <span
            title={`Context files: ${latestContextForChat.contextFiles} • Dirty files: ${latestContextForChat.gitDirtyFiles} • Branch: ${latestContextForChat.gitBranch ?? 'none'}`}
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              border: '1px solid rgba(76,137,217,0.45)',
              color: '#4C89D9',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            ctx {latestContextForChat.contextFiles}
          </span>
        )}
        {latestRewardForChat && (
          <span
            title={`Reward ${latestRewardForChat.rewardScore} • outcome ${Math.round(latestRewardForChat.outcomeScore * 100)} • efficiency ${Math.round(latestRewardForChat.efficiencyScore * 100)}`}
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              border: '1px solid rgba(84,140,90,0.45)',
              color:
                latestRewardForChat.rewardScore >= 75
                  ? '#548C5A'
                  : latestRewardForChat.rewardScore >= 45
                    ? '#d4a040'
                    : '#c45050',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            r {latestRewardForChat.rewardScore}
          </span>
        )}
        <span
          title={
            activeClaudeProfile.matchedRule
              ? `Claude profile: ${activeClaudeProfile.profile.name} (rule: ${activeClaudeProfile.matchedRule.pathPrefix})`
              : `Claude profile: ${activeClaudeProfile.profile.name}`
          }
          style={{
            padding: '1px 6px',
            borderRadius: 999,
            border:
              activeClaudeProfile.source === 'rule'
                ? '1px solid rgba(84,140,90,0.45)'
                : '1px solid rgba(116,116,124,0.45)',
            color:
              activeClaudeProfile.source === 'rule'
                ? '#548C5A'
                : activeClaudeProfile.source === 'default'
                  ? '#9A9692'
                  : '#74747C',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            maxWidth: 96,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          p {activeClaudeProfile.profile.id}
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
            disabled={isRunActive}
            style={{
              background: 'transparent', border: 'none', color: '#548C5A',
              cursor: isRunActive ? 'default' : 'pointer',
              opacity: isRunActive ? 0.45 : 1,
              fontFamily: 'inherit', fontSize: 10, padding: '0 4px',
            }}
          >
            sync
          </button>
        )}
        <div ref={recentMenuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowRecentMenu((prev) => !prev)}
            title={recentDirectoryOptions.length > 0 ? 'Switch chat scope from recent folders' : 'No recent folders'}
            disabled={isRunActive || (recentDirectoryOptions.length === 0 && !workspaceRoot)}
            style={{
              background: 'transparent',
              border: 'none',
              color: isRunActive
                ? '#3f3e3c'
                : recentDirectoryOptions.length > 0 || workspaceRoot
                  ? '#595653'
                  : '#3f3e3c',
              cursor: isRunActive
                ? 'default'
                : recentDirectoryOptions.length > 0 || workspaceRoot
                  ? 'pointer'
                  : 'default',
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
          disabled={isRunActive}
          style={{
            background: 'transparent', border: 'none', color: '#595653',
            cursor: isRunActive ? 'default' : 'pointer',
            opacity: isRunActive ? 0.45 : 1,
            fontFamily: 'inherit', fontSize: 11, padding: '0 4px',
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
          workingDirectory={workingDir ?? null}
        />
      </div>
    </div>
  )
}
