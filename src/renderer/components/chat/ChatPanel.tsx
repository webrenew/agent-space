import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentEvent, ChatMessage, ClaudeEvent } from '../../types'
import { randomAppearance } from '../../types'
import { useAgentStore } from '../../store/agents'
import { useWorkspaceStore } from '../../store/workspace'
import { useWorkspaceIntelligenceStore } from '../../store/workspaceIntelligence'
import { useSettingsStore } from '../../store/settings'
import { useChatHistoryStore } from '../../store/chatHistory'
import { matchScope } from '../../lib/scopeMatcher'
import { playChatCompletionDing } from '../../lib/soundPlayer'
import { computeRunReward } from '../../lib/rewardEngine'
import { logRendererEvent } from '../../lib/diagnostics'
import { resolveClaudeProfile } from '../../lib/claudeProfile'
import {
  applyPluginPromptTransforms,
  emitPluginHook,
  getRegisteredPluginCommands,
  invokePluginCommand,
} from '../../plugins/runtime'
import { ChatMessageBubble } from './ChatMessage'
import { ChatInput } from './ChatInput'
import {
  type OfficePromptContext,
  parseSlashCommandInput,
  prepareChatPrompt,
  resolveMentionedFilesWithSearch,
  resolveMentionTokens,
} from './chatPromptPipeline'
import {
  createClaudeEventHandlerRegistry,
  routeClaudeEvent,
  type SessionStatus,
} from './claudeEventHandlers'

interface ChatPanelProps {
  chatSessionId: string
}

let chatMessageCounter = 0
let chatAgentCounter = 0

function nextMessageId(): string {
  return `msg-${++chatMessageCounter}`
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

function selectRecentOfficeFeedback(events: readonly AgentEvent[], targetAgentId: string | null): string[] {
  const recentFeedback: string[] = []
  for (let index = events.length - 1; index >= 0 && recentFeedback.length < 6; index -= 1) {
    const event = events[index]
    if (event.type !== 'status_change') continue
    if (targetAgentId && event.agentId !== targetAgentId) continue
    if (
      !event.description.startsWith('Manual celebration:')
      && !event.description.startsWith('Rewarded +')
      && !event.description.startsWith('Reward ')
    ) {
      continue
    }
    recentFeedback.push(event.description)
  }
  return recentFeedback
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
  const activeToolNames = useRef<Map<string, string>>(new Map()) // toolUseId → toolName

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
  const targetAgentId = chatSession?.agentId ?? null
  const recentFeedback = useAgentStore(
    useShallow(useCallback((state) => selectRecentOfficeFeedback(state.events, targetAgentId), [targetAgentId]))
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

  const officePromptContext = useMemo<OfficePromptContext>(() => {
    return {
      recentFeedback,
      latestReward: latestRewardForChat
        ? {
          rewardScore: latestRewardForChat.rewardScore,
          status: latestRewardForChat.status,
          notes: latestRewardForChat.notes,
        }
        : null,
    }
  }, [latestRewardForChat, recentFeedback])

  const setActiveClaudeSession = useCallback((sessionId: string | null) => {
    activeClaudeSessionIdRef.current = sessionId
    setClaudeSessionId(sessionId)
  }, [])

  useEffect(() => {
    if (!claudeSessionId) return
    void window.electronAPI.claude.observeSession(claudeSessionId).catch((error) => {
      console.warn('[ChatPanel] Failed to observe Claude session:', error)
    })
    return () => {
      void window.electronAPI.claude.unobserveSession(claudeSessionId).catch((error) => {
        console.warn('[ChatPanel] Failed to unobserve Claude session:', error)
      })
    }
  }, [claudeSessionId])

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
    activeToolNames.current.clear()
    for (const subId of subagentIds) {
      removeAgent(subId)
    }
  }, [removeAgent])

  const incrementAgentFileCount = useCallback((agentId: string) => {
    const current = useAgentStore.getState().agents.find((agent) => agent.id === agentId)
    if (!current) return
    updateAgent(agentId, { files_modified: current.files_modified + 1 })
  }, [updateAgent])

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

    const agentEndPayload = {
      chatSessionId,
      workspaceDirectory: workspaceDirectory ?? workingDir ?? null,
      agentId,
      timestamp: Date.now(),
      status,
      durationMs,
      rewardScore,
    }
    void emitPluginHook('session_end', agentEndPayload)
    void emitPluginHook('agent_end', agentEndPayload)
  }, [addEvent, addReward, chatSession?.label, chatSessionId, workingDir])

  const resetRunState = useCallback(() => {
    setActiveClaudeSession(null)
    activeRunDirectoryRef.current = null
    runTokenBaselineRef.current = null
    runModelBaselineRef.current = null
    runStartedAtRef.current = null
  }, [setActiveClaudeSession])

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
    const eventHandlers = createClaudeEventHandlerRegistry({
      chatSessionId,
      workingDirectory: workingDir ?? null,
      getAgentId: () => agentIdRef.current,
      getActiveRunDirectory: () => activeRunDirectoryRef.current,
      setMessages,
      setStatus,
      updateAgent,
      addEvent,
      addAgent,
      removeAgent,
      clearSubagentsForParent,
      emitPluginHook,
      persistMessage,
      finalizeRunReward,
      resetRunState,
      playCompletionDing: () => playChatCompletionDing(soundsEnabled),
      nextMessageId,
      truncateForHook,
      runToolCallCountRef,
      runFileWriteCountRef,
      subagentSeatCounterRef: subagentSeatCounter,
      activeSubagents: activeSubagents.current,
      activeToolNames: activeToolNames.current,
      incrementAgentFileCount,
      getChatAgentName: () => `Chat ${chatAgentCounter}`,
    })

    const unsub = window.electronAPI.claude.onEvent((event: ClaudeEvent) => {
      const activeSessionId = activeClaudeSessionIdRef.current
      if (!activeSessionId || event.sessionId !== activeSessionId) return

      const agentId = agentIdRef.current
      if (agentId) {
        const usagePayload = event.data as { usage?: unknown; modelUsage?: unknown }
        applyUsageSnapshot(agentId, usagePayload.usage, usagePayload.modelUsage)
      }
      routeClaudeEvent(event, eventHandlers)
    })

    return unsub
  }, [
    addAgent,
    addEvent,
    applyUsageSnapshot,
    chatSessionId,
    clearSubagentsForParent,
    finalizeRunReward,
    incrementAgentFileCount,
    persistMessage,
    removeAgent,
    resetRunState,
    soundsEnabled,
    updateAgent,
    workingDir,
  ])

  const resolveMentionedFiles = useCallback(async (rootDir: string, mentions: string[]) => {
    return resolveMentionedFilesWithSearch(
      rootDir,
      mentions,
      async (searchRoot, query, limit) => window.electronAPI.fs.search(searchRoot, query, limit),
      (mention, error) => {
        console.error(`[ChatPanel] Failed to resolve @${mention}:`, error)
      }
    )
  }, [])

  const resolveEffectiveWorkingDir = useCallback(async (): Promise<string | null> => {
    if (workingDir) return workingDir

    try {
      const selected = await window.electronAPI.fs.openFolderDialog()
      if (!selected) {
        addToast({
          type: 'error',
          message: 'Select a folder before starting this chat.',
        })
        return null
      }
      applyDirectorySelection(selected)
      return selected
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      addToast({
        type: 'error',
        message: `Failed to choose folder: ${errMsg}`,
      })
      return null
    }
  }, [addToast, applyDirectorySelection, workingDir])

  const appendUserMessageAndEmitHook = useCallback((
    message: string,
    workingDirectory: string,
    mentionCount: number,
    attachmentCount: number
  ) => {
    const timestamp = Date.now()
    void emitPluginHook('message_received', {
      chatSessionId,
      workspaceDirectory: workingDirectory,
      agentId: agentIdRef.current,
      timestamp,
      message: truncateForHook(message),
      messageLength: message.length,
      mentionCount,
      attachmentCount,
    })

    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        role: 'user',
        content: message,
        timestamp,
      },
    ])
    persistMessage(message, 'user', { directory: workingDirectory })
  }, [chatSessionId, persistMessage])

  const handleSlashCommandSend = useCallback(async (input: {
    message: string
    slashCommand: { name: string; argsRaw: string; args: string[] }
    workingDirectory: string
    files?: File[]
    mentions?: string[]
  }) => {
    const mentionTokens = resolveMentionTokens(input.message, input.mentions)
    appendUserMessageAndEmitHook(
      input.message,
      input.workingDirectory,
      mentionTokens.length,
      input.files?.length ?? 0
    )

    const commandResult = await invokePluginCommand(input.slashCommand.name, {
      chatSessionId,
      workspaceDirectory: input.workingDirectory,
      agentId: agentIdRef.current,
      rawMessage: input.message,
      argsRaw: input.slashCommand.argsRaw,
      args: input.slashCommand.args,
      attachmentNames: input.files?.map((file) => file.name) ?? [],
      mentionPaths: mentionTokens,
    })

    if (!commandResult.handled) {
      const knownCommands = getRegisteredPluginCommands()
      const commandsPreview = knownCommands.slice(0, 6).map((entry) => `/${entry.name}`)
      const hint = knownCommands.length > 0
        ? `Available commands: ${commandsPreview.join(', ')}${knownCommands.length > 6 ? ', ...' : ''}`
        : 'No plugin commands are currently loaded.'
      const messageText = `Unknown command "/${input.slashCommand.name}". ${hint}`
      void emitPluginHook('message_sent', {
        chatSessionId,
        workspaceDirectory: input.workingDirectory,
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
    if (!responseText) return

    const responseRole: 'assistant' | 'error' = commandResult.isError ? 'error' : 'assistant'
    void emitPluginHook('message_sent', {
      chatSessionId,
      workspaceDirectory: input.workingDirectory,
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
      persistMessage(responseText, 'assistant', { directory: input.workingDirectory })
    }
  }, [appendUserMessageAndEmitHook, chatSessionId, persistMessage])

  const ensureChatAgentForRun = useCallback((message: string): string => {
    let agentId = agentIdRef.current
    if (agentId) {
      updateAgent(agentId, {
        status: 'thinking',
        currentTask: message.slice(0, 60),
        isClaudeRunning: true,
      })
      return agentId
    }

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

    updateChatSession(chatSessionId, { agentId })
    addEvent({
      agentId,
      agentName: `Agent ${agentNum}`,
      type: 'spawn',
      description: 'Chat session started',
    })

    const capturedAgentId = agentId
    window.electronAPI.agent.generateMeta(message).then((meta) => {
      updateAgent(capturedAgentId, {
        name: meta.name,
        currentTask: meta.taskDescription,
      })
      updateChatSession(chatSessionId, { label: meta.name })
    }).catch(() => { /* fallback name stays */ })

    return agentId
  }, [addAgent, addEvent, chatSessionId, getNextDeskIndex, updateAgent, updateChatSession])

  const handleClaudePromptSend = useCallback(
    async (message: string, workingDirectory: string, files?: File[], mentions?: string[]) => {
      const promptPreparation = await prepareChatPrompt(
        {
          message,
          workingDirectory,
          files,
          mentions,
          historyMessages: messages,
          officeContext: officePromptContext,
        },
        {
          getWorkspaceSnapshot: (directory) => window.electronAPI.context.getWorkspaceSnapshot(directory),
          upsertWorkspaceSnapshot,
          onWorkspaceSnapshotError: (error) => {
            logRendererEvent('warn', 'chat.workspace_snapshot_failed', {
              chatSessionId,
              workingDirectory,
              error: error instanceof Error ? error.message : String(error),
            })
          },
          resolveMentionedFiles,
          readReferencedFile: (path) => window.electronAPI.fs.readFile(path),
        }
      )

      appendUserMessageAndEmitHook(
        message,
        workingDirectory,
        promptPreparation.mentionTokens.length,
        files?.length ?? 0
      )

      const promptTransformResult = await applyPluginPromptTransforms({
        chatSessionId,
        workspaceDirectory: workingDirectory,
        agentId: agentIdRef.current,
        rawMessage: message,
        prompt: promptPreparation.prompt,
        mentionCount: promptPreparation.mentionTokens.length,
        attachmentCount: files?.length ?? 0,
      })
      if (promptTransformResult.canceled) {
        const cancellationMessage = promptTransformResult.errorMessage
          ?? 'Request canceled by a plugin prompt transformer.'
        void emitPluginHook('message_sent', {
          chatSessionId,
          workspaceDirectory: workingDirectory,
          agentId: agentIdRef.current,
          timestamp: Date.now(),
          role: 'error',
          message: truncateForHook(cancellationMessage),
          messageLength: cancellationMessage.length,
        })
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            role: 'error',
            content: cancellationMessage,
            timestamp: Date.now(),
          },
        ])
        return
      }

      const promptForSend = promptTransformResult.prompt
      setStatus('running')
      activeRunDirectoryRef.current = workingDirectory
      runStartedAtRef.current = Date.now()
      runContextFilesRef.current =
        promptPreparation.resolvedMentionCount
        + (files?.length ?? 0)
        + Math.min(promptPreparation.workspaceSnapshot?.keyFiles.length ?? 0, 6)
      runUnresolvedMentionsRef.current = promptPreparation.unresolvedMentionCount
      runToolCallCountRef.current = 0
      runFileWriteCountRef.current = 0
      runYoloModeRef.current = yoloMode
      runRewardRecordedRef.current = false
      activeToolNames.current.clear()

      setChatContextSnapshot({
        chatSessionId,
        workspaceDirectory: workingDirectory,
        contextFiles: runContextFilesRef.current,
        unresolvedMentions: promptPreparation.unresolvedMentionCount,
        generatedAt: promptPreparation.workspaceSnapshot?.generatedAt ?? Date.now(),
        gitBranch: promptPreparation.workspaceSnapshot?.gitBranch ?? null,
        gitDirtyFiles: promptPreparation.workspaceSnapshot?.gitDirtyFiles ?? 0,
      })
      const profileForRun = resolveClaudeProfile(claudeProfilesConfig, workingDirectory)
      const agentId = ensureChatAgentForRun(message)

      const currentAgent = useAgentStore.getState().agents.find((agent) => agent.id === agentId)
      runTokenBaselineRef.current = {
        input: currentAgent?.tokens_input ?? 0,
        output: currentAgent?.tokens_output ?? 0,
      }
      runModelBaselineRef.current = cloneTokensByModel(currentAgent?.sessionStats.tokensByModel ?? {})
      const beforeAgentStartPayload = {
        chatSessionId,
        workspaceDirectory: workingDirectory,
        agentId,
        timestamp: Date.now(),
        promptPreview: truncateForHook(promptForSend, 240),
        promptLength: promptForSend.length,
        yoloMode,
        profileId: profileForRun.profile.id,
        profileSource: profileForRun.source,
        transformed: promptTransformResult.transformed,
      }
      void emitPluginHook('session_start', beforeAgentStartPayload)
      void emitPluginHook('before_agent_start', beforeAgentStartPayload)
      void emitPluginHook('message_sending', {
        chatSessionId,
        workspaceDirectory: workingDirectory,
        agentId,
        timestamp: Date.now(),
        promptPreview: truncateForHook(promptForSend, 240),
        promptLength: promptForSend.length,
        mentionCount: promptPreparation.mentionTokens.length,
        attachmentCount: files?.length ?? 0,
        transformed: promptTransformResult.transformed,
      })

      try {
        const result = await window.electronAPI.claude.start({
          prompt: promptForSend,
          workingDirectory,
          dangerouslySkipPermissions: yoloMode,
        })
        setActiveClaudeSession(result.sessionId)
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error)
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
      appendUserMessageAndEmitHook,
      chatSessionId,
      claudeProfilesConfig,
      ensureChatAgentForRun,
      finalizeRunReward,
      resolveMentionedFiles,
      setChatContextSnapshot,
      updateAgent,
      upsertWorkspaceSnapshot,
      officePromptContext,
      yoloMode,
    ]
  )

  const handleSend = useCallback(async (message: string, files?: File[], mentions?: string[]) => {
    const effectiveWorkingDir = await resolveEffectiveWorkingDir()
    if (!effectiveWorkingDir) return

    const slashCommand = parseSlashCommandInput(message)
    if (slashCommand) {
      await handleSlashCommandSend({
        message,
        slashCommand,
        workingDirectory: effectiveWorkingDir,
        files,
        mentions,
      })
      return
    }

    await handleClaudePromptSend(message, effectiveWorkingDir, files, mentions)
  }, [handleClaudePromptSend, handleSlashCommandSend, resolveEffectiveWorkingDir])

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
