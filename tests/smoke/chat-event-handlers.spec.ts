import { expect, test } from '@playwright/test'
import type {
  Agent,
  AgentEvent,
  ChatMessage,
  ClaudeEvent,
  PluginHookEvent,
  PluginHookEventPayloadMap,
} from '../../src/renderer/types'
import {
  createClaudeEventHandlerRegistry,
  routeClaudeEvent,
  type ClaudeEventHandlerContext,
  type SessionStatus,
} from '../../src/renderer/components/chat/claudeEventHandlers'

interface HarnessState {
  messages: ChatMessage[]
  status: SessionStatus
  agentId: string | null
  activeRunDirectory: string | null
  runToolCallCountRef: { current: number }
  runFileWriteCountRef: { current: number }
  subagentSeatCounterRef: { current: number }
  activeSubagents: Map<string, string>
  activeToolNames: Map<string, string>
  updateCalls: Array<{ id: string; updates: Partial<Agent> }>
  addEventCalls: Array<Omit<AgentEvent, 'id' | 'timestamp'>>
  addAgentCalls: Agent[]
  removeAgentCalls: string[]
  clearSubagentCalls: string[]
  emitHookCalls: Array<{ event: PluginHookEvent; payload: Record<string, unknown> }>
  persistCalls: Array<{ content: string; role: string; directory: string | null }>
  finalizeCalls: Array<'success' | 'error' | 'stopped'>
  resetRunStateCalls: number
  playCompletionDingCalls: number
  incrementAgentFileCountCalls: number
}

function createHarness(): {
  state: HarnessState
  dispatch: (event: ClaudeEvent) => void
} {
  let messageCounter = 0
  const state: HarnessState = {
    messages: [],
    status: 'idle',
    agentId: 'agent-1',
    activeRunDirectory: '/tmp/workspace',
    runToolCallCountRef: { current: 0 },
    runFileWriteCountRef: { current: 0 },
    subagentSeatCounterRef: { current: 0 },
    activeSubagents: new Map(),
    activeToolNames: new Map(),
    updateCalls: [],
    addEventCalls: [],
    addAgentCalls: [],
    removeAgentCalls: [],
    clearSubagentCalls: [],
    emitHookCalls: [],
    persistCalls: [],
    finalizeCalls: [],
    resetRunStateCalls: 0,
    playCompletionDingCalls: 0,
    incrementAgentFileCountCalls: 0,
  }

  const context: ClaudeEventHandlerContext = {
    chatSessionId: 'chat-smoke',
    workingDirectory: '/tmp/workspace',
    getAgentId: () => state.agentId,
    getActiveRunDirectory: () => state.activeRunDirectory,
    setMessages: (updater) => {
      state.messages = updater(state.messages)
    },
    setStatus: (status) => {
      state.status = status
    },
    updateAgent: (id, updates) => {
      state.updateCalls.push({ id, updates })
    },
    addEvent: (event) => {
      state.addEventCalls.push(event)
    },
    addAgent: (agent) => {
      state.addAgentCalls.push(agent)
    },
    removeAgent: (idOrTerminalId) => {
      state.removeAgentCalls.push(idOrTerminalId)
    },
    clearSubagentsForParent: (parentAgentId) => {
      state.clearSubagentCalls.push(parentAgentId)
    },
    emitPluginHook: <E extends PluginHookEvent>(event: E, payload: PluginHookEventPayloadMap[E]) => {
      state.emitHookCalls.push({ event, payload: payload as Record<string, unknown> })
    },
    persistMessage: (content, role, contextInfo) => {
      state.persistCalls.push({
        content,
        role,
        directory: contextInfo?.directory ?? null,
      })
    },
    finalizeRunReward: (status) => {
      state.finalizeCalls.push(status)
    },
    resetRunState: () => {
      state.resetRunStateCalls += 1
      state.activeRunDirectory = null
    },
    playCompletionDing: () => {
      state.playCompletionDingCalls += 1
    },
    nextMessageId: () => `msg-${++messageCounter}`,
    truncateForHook: (value, max = 500) => (value.length <= max ? value : `${value.slice(0, max)}…`),
    runToolCallCountRef: state.runToolCallCountRef,
    runFileWriteCountRef: state.runFileWriteCountRef,
    subagentSeatCounterRef: state.subagentSeatCounterRef,
    activeSubagents: state.activeSubagents,
    activeToolNames: state.activeToolNames,
    incrementAgentFileCount: () => {
      state.incrementAgentFileCountCalls += 1
    },
    getChatAgentName: () => 'Chat 1',
  }

  const registry = createClaudeEventHandlerRegistry(context)
  return {
    state,
    dispatch: (event: ClaudeEvent) => routeClaudeEvent(event, registry),
  }
}

test('tool_use transition appends tool call message and updates runtime counters', () => {
  const harness = createHarness()
  harness.dispatch({
    sessionId: 'session-1',
    type: 'tool_use',
    data: {
      id: 'tool-1',
      name: 'Write',
      input: { file_path: 'README.md' },
    },
  })

  expect(harness.state.runToolCallCountRef.current).toBe(1)
  expect(harness.state.runFileWriteCountRef.current).toBe(1)
  expect(harness.state.incrementAgentFileCountCalls).toBe(1)
  expect(harness.state.activeToolNames.get('tool-1')).toBe('Write')
  expect(harness.state.messages.at(-1)).toMatchObject({
    role: 'assistant',
    toolName: 'Write',
    toolUseId: 'tool-1',
  })
})

test('tool_result transition appends tool output and clears active tool tracking', () => {
  const harness = createHarness()
  harness.dispatch({
    sessionId: 'session-1',
    type: 'tool_use',
    data: {
      id: 'tool-1',
      name: 'Edit',
      input: { file_path: 'README.md' },
    },
  })
  harness.dispatch({
    sessionId: 'session-1',
    type: 'tool_result',
    data: {
      tool_use_id: 'tool-1',
      content: 'done',
    },
  })

  expect(harness.state.activeToolNames.has('tool-1')).toBe(false)
  expect(harness.state.messages.at(-1)).toMatchObject({
    role: 'tool',
    content: 'done',
    toolUseId: 'tool-1',
  })
  expect(
    harness.state.updateCalls.some((entry) => entry.updates.status === 'streaming')
  ).toBe(true)
})

test('result transition finalizes successful run and persists final assistant content', async () => {
  const harness = createHarness()
  harness.state.messages = [
    { id: 'msg-a', role: 'assistant', content: 'Final response', timestamp: Date.now() - 2 },
    { id: 'msg-b', role: 'thinking', content: 'Thinking...', timestamp: Date.now() - 1 },
  ]

  harness.dispatch({
    sessionId: 'session-1',
    type: 'result',
    data: {
      result: 'ok',
      is_error: false,
    },
  })
  await Promise.resolve()

  expect(harness.state.status).toBe('done')
  expect(harness.state.playCompletionDingCalls).toBe(1)
  expect(harness.state.finalizeCalls).toEqual(['success'])
  expect(harness.state.resetRunStateCalls).toBe(1)
  expect(harness.state.messages.some((message) => message.role === 'thinking')).toBe(false)
  expect(harness.state.persistCalls[0]).toMatchObject({
    content: 'Final response',
    role: 'assistant',
  })
})

test('error transition appends error message and finalizes run as failed', () => {
  const harness = createHarness()
  harness.state.messages = [
    { id: 'msg-a', role: 'thinking', content: 'Thinking...', timestamp: Date.now() - 1 },
  ]

  harness.dispatch({
    sessionId: 'session-1',
    type: 'error',
    data: {
      message: 'boom',
    },
  })

  expect(harness.state.status).toBe('error')
  expect(harness.state.finalizeCalls).toEqual(['error'])
  expect(harness.state.resetRunStateCalls).toBe(1)
  expect(harness.state.messages.at(-1)).toMatchObject({
    role: 'error',
    content: 'boom',
  })
})
