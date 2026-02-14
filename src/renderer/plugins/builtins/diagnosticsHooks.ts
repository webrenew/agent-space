import type {
  PluginHookEvent,
  PluginHookEventPayloadMap,
  PluginHookHandler,
} from '../../types'
import { logRendererEvent } from '../../lib/diagnostics'

type RegisterHookFn = <E extends PluginHookEvent>(
  event: E,
  handler: PluginHookHandler<E>,
  options?: { pluginId?: string; order?: number }
) => () => void

function register<E extends PluginHookEvent>(
  registerHook: RegisterHookFn,
  event: E,
  handler: PluginHookHandler<E>
): void {
  registerHook(event, handler, { pluginId: 'builtin.diagnostics', order: 50 })
}

function sanitizePayload<E extends PluginHookEvent>(
  payload: PluginHookEventPayloadMap[E]
): Record<string, unknown> {
  const entry = payload as unknown as Record<string, unknown>
  const copy: Record<string, unknown> = { ...entry }
  if (typeof copy.message === 'string') {
    copy.message = (copy.message as string).slice(0, 500)
  }
  if (typeof copy.promptPreview === 'string') {
    copy.promptPreview = (copy.promptPreview as string).slice(0, 240)
  }
  if (typeof copy.contentPreview === 'string') {
    copy.contentPreview = (copy.contentPreview as string).slice(0, 240)
  }
  return copy
}

export function registerDiagnosticsHooks(registerHook: RegisterHookFn): void {
  register(registerHook, 'before_agent_start', (payload) => {
    logRendererEvent('info', 'plugin.hook.before_agent_start', sanitizePayload(payload))
  })
  register(registerHook, 'agent_end', (payload) => {
    logRendererEvent('info', 'plugin.hook.agent_end', sanitizePayload(payload))
  })
  register(registerHook, 'session_start', (payload) => {
    logRendererEvent('info', 'plugin.hook.session_start', sanitizePayload(payload))
  })
  register(registerHook, 'session_end', (payload) => {
    logRendererEvent('info', 'plugin.hook.session_end', sanitizePayload(payload))
  })
  register(registerHook, 'before_tool_call', (payload) => {
    logRendererEvent('info', 'plugin.hook.before_tool_call', sanitizePayload(payload))
  })
  register(registerHook, 'after_tool_call', (payload) => {
    logRendererEvent('info', 'plugin.hook.after_tool_call', sanitizePayload(payload))
  })
  register(registerHook, 'tool_result_persist', (payload) => {
    logRendererEvent('info', 'plugin.hook.tool_result_persist', sanitizePayload(payload))
  })
  register(registerHook, 'message_received', (payload) => {
    logRendererEvent('info', 'plugin.hook.message_received', sanitizePayload(payload))
  })
  register(registerHook, 'message_sending', (payload) => {
    logRendererEvent('info', 'plugin.hook.message_sending', sanitizePayload(payload))
  })
  register(registerHook, 'message_sent', (payload) => {
    logRendererEvent('info', 'plugin.hook.message_sent', sanitizePayload(payload))
  })
}
