import { randomAppearance } from '../../types'
import type {
  Agent,
  AgentEvent,
  ChatMessage,
  ClaudeErrorInfo,
  ClaudeEvent,
  ClaudeEventType,
  ClaudeSessionResult,
  ClaudeThinkingContent,
  ClaudeToolResult,
  ClaudeToolUse,
  ClaudeTextContent,
  PluginHookEvent,
  PluginHookEventPayloadMap,
} from '../../types'

export type SessionStatus = 'idle' | 'running' | 'done' | 'error'

type MessageUpdater = (updater: (previous: ChatMessage[]) => ChatMessage[]) => void

export interface ClaudeEventHandlerContext {
  chatSessionId: string
  workingDirectory: string | null
  getAgentId: () => string | null
  getActiveRunDirectory: () => string | null
  setMessages: MessageUpdater
  setStatus: (status: SessionStatus) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  addEvent: (event: Omit<AgentEvent, 'id' | 'timestamp'>) => void
  addAgent: (agent: Agent) => void
  removeAgent: (idOrTerminalId: string) => void
  clearSubagentsForParent: (parentAgentId: string) => void
  emitPluginHook: <E extends PluginHookEvent>(
    event: E,
    payload: PluginHookEventPayloadMap[E]
  ) => Promise<void> | void
  persistMessage: (
    content: string,
    role: string,
    context?: { directory?: string | null; scopeId?: string; scopeName?: string }
  ) => void
  finalizeRunReward: (status: 'success' | 'error' | 'stopped') => void
  resetRunState: () => void
  playCompletionDing: () => void
  nextMessageId: () => string
  truncateForHook: (value: string, max?: number) => string
  runToolCallCountRef: { current: number }
  runFileWriteCountRef: { current: number }
  subagentSeatCounterRef: { current: number }
  activeSubagents: Map<string, string>
  activeToolNames: Map<string, string>
  incrementAgentFileCount: (agentId: string) => void
  getChatAgentName: () => string
}

export type ClaudeEventHandler = (event: ClaudeEvent) => void
export type ClaudeEventHandlerRegistry = Record<ClaudeEventType, ClaudeEventHandler>

function getHookWorkspaceDirectory(context: ClaudeEventHandlerContext): string | null {
  return context.getActiveRunDirectory() ?? context.workingDirectory ?? null
}

function appendMessage(context: ClaudeEventHandlerContext, message: ChatMessage): void {
  context.setMessages((previous) => [...previous, message])
}

function removeThinkingMessages(context: ClaudeEventHandlerContext): void {
  context.setMessages((previous) => previous.filter((message) => message.role !== 'thinking'))
}

function handleInit(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  void event
  const agentId = context.getAgentId()
  if (!agentId) return
  context.updateAgent(agentId, { status: 'thinking' })
}

function handleText(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeTextContent
  if (!data.text) return

  context.setMessages((previous) => {
    const last = previous[previous.length - 1]
    if (last && last.role === 'assistant' && !last.toolName) {
      return [
        ...previous.slice(0, -1),
        { ...last, content: last.content + data.text },
      ]
    }
    return [
      ...previous,
      {
        id: context.nextMessageId(),
        role: 'assistant',
        content: data.text,
        timestamp: Date.now(),
      },
    ]
  })

  const agentId = context.getAgentId()
  if (!agentId) return
  context.updateAgent(agentId, { status: 'streaming' })
}

function handleThinking(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeThinkingContent
  context.setMessages((previous) => {
    const withoutThinking = previous.filter((message) => message.role !== 'thinking')
    return [
      ...withoutThinking,
      {
        id: context.nextMessageId(),
        role: 'thinking',
        content: data.thinking?.slice(0, 200) ?? 'Thinking...',
        timestamp: Date.now(),
      },
    ]
  })

  const agentId = context.getAgentId()
  if (!agentId) return
  context.updateAgent(agentId, { status: 'thinking' })
}

function handleToolUse(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeToolUse
  const agentId = context.getAgentId()
  context.runToolCallCountRef.current += 1
  context.activeToolNames.set(data.id, data.name)

  void context.emitPluginHook('before_tool_call', {
    chatSessionId: context.chatSessionId,
    workspaceDirectory: getHookWorkspaceDirectory(context),
    agentId,
    timestamp: Date.now(),
    toolName: data.name,
    toolUseId: data.id,
    toolInput: data.input,
  })

  context.setMessages((previous) => [
    ...previous.filter((message) => message.role !== 'thinking'),
    {
      id: context.nextMessageId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolName: data.name,
      toolInput: data.input,
      toolUseId: data.id,
    },
  ])

  if (!agentId) return

  context.updateAgent(agentId, { status: 'tool_calling', currentTask: data.name })
  context.addEvent({
    agentId,
    agentName: context.getChatAgentName(),
    type: 'tool_call',
    description: data.name,
  })

  const fileTools = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
  if (fileTools.includes(data.name)) {
    context.runFileWriteCountRef.current += 1
    context.incrementAgentFileCount(agentId)
  }

  if (data.name !== 'Task') return

  const subId = `sub-${agentId}-${data.id}`
  const seat = context.subagentSeatCounterRef.current++
  const input = data.input as Record<string, unknown>
  const subDescription = (input.description as string)
    ?? (input.prompt as string)?.slice(0, 60)
    ?? 'Subtask'
  const subType = (input.subagent_type as string) ?? 'general'

  context.activeSubagents.set(data.id, subId)
  context.addAgent({
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
    sessionStats: {
      tokenHistory: [],
      peakInputRate: 0,
      peakOutputRate: 0,
      tokensByModel: {},
    },
    isSubagent: true,
    parentAgentId: agentId,
    meetingSeat: seat,
  })

  context.addEvent({
    agentId: subId,
    agentName: subType,
    type: 'spawn',
    description: `Subagent: ${subDescription.slice(0, 40)}`,
  })
}

function handleToolResult(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeToolResult
  const agentId = context.getAgentId()
  const toolName = context.activeToolNames.get(data.tool_use_id) ?? null
  context.activeToolNames.delete(data.tool_use_id)

  void context.emitPluginHook('after_tool_call', {
    chatSessionId: context.chatSessionId,
    workspaceDirectory: getHookWorkspaceDirectory(context),
    agentId,
    timestamp: Date.now(),
    toolUseId: data.tool_use_id,
    isError: data.is_error === true,
    contentPreview: context.truncateForHook(data.content, 240),
  })
  void context.emitPluginHook('tool_result_persist', {
    chatSessionId: context.chatSessionId,
    workspaceDirectory: getHookWorkspaceDirectory(context),
    agentId,
    timestamp: Date.now(),
    toolName,
    toolUseId: data.tool_use_id,
    isError: data.is_error === true,
    contentPreview: context.truncateForHook(data.content, 240),
    contentLength: data.content.length,
  })

  appendMessage(context, {
    id: context.nextMessageId(),
    role: 'tool',
    content: data.content,
    timestamp: Date.now(),
    toolUseId: data.tool_use_id,
    isError: data.is_error,
  })

  const subId = context.activeSubagents.get(data.tool_use_id)
  if (subId) {
    context.updateAgent(subId, {
      status: data.is_error ? 'error' : 'done',
      isClaudeRunning: false,
    })
    context.activeSubagents.delete(data.tool_use_id)
    setTimeout(() => {
      context.removeAgent(subId)
    }, 5000)
  }

  if (!agentId) return
  context.updateAgent(agentId, { status: 'streaming' })
}

function handleResult(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeSessionResult
  const agentId = context.getAgentId()
  removeThinkingMessages(context)

  context.setMessages((previous) => {
    const assistantMessages = previous.filter((message) => message.role === 'assistant' && !message.toolName)
    const lastAssistant = assistantMessages[assistantMessages.length - 1]
    if (lastAssistant?.content) {
      const activeRunDirectory = context.getActiveRunDirectory()
      queueMicrotask(() => {
        context.persistMessage(lastAssistant.content, 'assistant', { directory: activeRunDirectory })
        void context.emitPluginHook('message_sent', {
          chatSessionId: context.chatSessionId,
          workspaceDirectory: activeRunDirectory ?? context.workingDirectory ?? null,
          agentId,
          timestamp: Date.now(),
          role: 'assistant',
          message: context.truncateForHook(lastAssistant.content),
          messageLength: lastAssistant.content.length,
        })
      })
    }
    return previous
  })

  if (data.is_error && data.error) {
    void context.emitPluginHook('message_sent', {
      chatSessionId: context.chatSessionId,
      workspaceDirectory: getHookWorkspaceDirectory(context),
      agentId,
      timestamp: Date.now(),
      role: 'error',
      message: context.truncateForHook(data.error),
      messageLength: data.error.length,
    })
    appendMessage(context, {
      id: context.nextMessageId(),
      role: 'error',
      content: data.error ?? 'Unknown error',
      timestamp: Date.now(),
    })
    context.setStatus('error')
  } else {
    context.setStatus('done')
    context.playCompletionDing()
  }

  if (agentId) {
    context.updateAgent(agentId, {
      status: data.is_error ? 'error' : 'done',
      isClaudeRunning: false,
    })
    context.clearSubagentsForParent(agentId)
  }

  context.finalizeRunReward(data.is_error ? 'error' : 'success')
  context.resetRunState()
}

function handleError(event: ClaudeEvent, context: ClaudeEventHandlerContext): void {
  const data = event.data as ClaudeErrorInfo
  const agentId = context.getAgentId()
  void context.emitPluginHook('message_sent', {
    chatSessionId: context.chatSessionId,
    workspaceDirectory: getHookWorkspaceDirectory(context),
    agentId,
    timestamp: Date.now(),
    role: 'error',
    message: context.truncateForHook(data.message),
    messageLength: data.message.length,
  })

  context.setMessages((previous) => [
    ...previous.filter((message) => message.role !== 'thinking'),
    {
      id: context.nextMessageId(),
      role: 'error',
      content: data.message,
      timestamp: Date.now(),
    },
  ])
  context.setStatus('error')

  if (agentId) {
    context.updateAgent(agentId, { status: 'error', isClaudeRunning: false })
    context.clearSubagentsForParent(agentId)
  }

  context.finalizeRunReward('error')
  context.resetRunState()
}

export function createClaudeEventHandlerRegistry(
  context: ClaudeEventHandlerContext
): ClaudeEventHandlerRegistry {
  return {
    init: (event) => handleInit(event, context),
    text: (event) => handleText(event, context),
    thinking: (event) => handleThinking(event, context),
    tool_use: (event) => handleToolUse(event, context),
    tool_result: (event) => handleToolResult(event, context),
    result: (event) => handleResult(event, context),
    error: (event) => handleError(event, context),
  }
}

export function routeClaudeEvent(
  event: ClaudeEvent,
  registry: ClaudeEventHandlerRegistry
): void {
  registry[event.type](event)
}
