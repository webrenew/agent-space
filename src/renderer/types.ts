export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool_calling'
  | 'waiting'
  | 'error'
  | 'done'

export type AgentType = 'cursor' | 'cli' | 'chat' | 'mcp' | 'copilot'

export type CelebrationType =
  | 'confetti'
  | 'rocket'
  | 'sparkles'
  | 'explosion'
  | 'trophy'
  | 'pizza_party'
  | 'floppy_rain'
  | 'dialup_wave'
  | 'fax_blast'

export type AgentEventType =
  | 'spawn' | 'exit' | 'status_change' | 'file_write'
  | 'tool_call' | 'commit' | 'push'
  | 'test_pass' | 'test_fail' | 'build_pass' | 'build_fail' | 'error'

export type PluginHookEvent =
  | 'before_agent_start'
  | 'agent_end'
  | 'session_start'
  | 'session_end'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'

export interface PluginHookBase {
  chatSessionId: string
  workspaceDirectory: string | null
  agentId: string | null
  timestamp: number
}

export interface PluginBeforeAgentStartHook extends PluginHookBase {
  promptPreview: string
  promptLength: number
  yoloMode: boolean
  profileId: string
  profileSource: 'rule' | 'default' | 'fallback'
  transformed: boolean
}

export type PluginSessionStartHook = PluginBeforeAgentStartHook

export interface PluginAgentEndHook extends PluginHookBase {
  status: 'success' | 'error' | 'stopped'
  durationMs: number
  rewardScore: number | null
}

export type PluginSessionEndHook = PluginAgentEndHook

export interface PluginMessageReceivedHook extends PluginHookBase {
  message: string
  messageLength: number
  mentionCount: number
  attachmentCount: number
}

export interface PluginMessageSentHook extends PluginHookBase {
  role: 'assistant' | 'error'
  message: string
  messageLength: number
}

export interface PluginMessageSendingHook extends PluginHookBase {
  promptPreview: string
  promptLength: number
  mentionCount: number
  attachmentCount: number
  transformed: boolean
}

export interface PluginBeforeToolCallHook extends PluginHookBase {
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown>
}

export interface PluginAfterToolCallHook extends PluginHookBase {
  toolUseId: string
  isError: boolean
  contentPreview: string
}

export interface PluginToolResultPersistHook extends PluginHookBase {
  toolName: string | null
  toolUseId: string
  isError: boolean
  contentPreview: string
  contentLength: number
}

export interface PluginHookEventPayloadMap {
  before_agent_start: PluginBeforeAgentStartHook
  agent_end: PluginAgentEndHook
  session_start: PluginSessionStartHook
  session_end: PluginSessionEndHook
  message_received: PluginMessageReceivedHook
  message_sending: PluginMessageSendingHook
  message_sent: PluginMessageSentHook
  before_tool_call: PluginBeforeToolCallHook
  after_tool_call: PluginAfterToolCallHook
  tool_result_persist: PluginToolResultPersistHook
}

export type PluginHookHandler<E extends PluginHookEvent = PluginHookEvent> =
  (payload: PluginHookEventPayloadMap[E]) => void | Promise<void>

export type TerminalThemeName =
  | 'agent-space'
  | 'dracula'
  | 'solarized-dark'
  | 'solarized-light'
  | 'nord'
  | 'monokai'
  | 'gruvbox-dark'
  | 'tokyo-night'

export type SoundEventType =
  | 'commit'
  | 'push'
  | 'test_pass'
  | 'test_fail'
  | 'build_pass'
  | 'build_fail'
  | 'agent_done'
  | 'error'

export type SystemSound =
  | 'Basso' | 'Blow' | 'Bottle' | 'Frog' | 'Funk'
  | 'Glass' | 'Hero' | 'Morse' | 'Ping' | 'Pop'
  | 'Purr' | 'Sosumi' | 'Submarine' | 'Tink'

export type SchedulerRunStatus = 'idle' | 'running' | 'success' | 'error'
export type SchedulerRunTrigger = 'cron' | 'manual'

export type ClaudeSettingSource = 'user' | 'project' | 'local'
export type ClaudePermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'delegate'
  | 'dontAsk'
  | 'plan'

export interface ClaudeProfile {
  id: string
  name: string
  settingsPath: string
  mcpConfigPath: string
  pluginDirs: string[]
  settingSources: ClaudeSettingSource[]
  agent: string
  permissionMode: ClaudePermissionMode
  strictMcpConfig: boolean
}

export interface ClaudeWorkspaceProfileRule {
  id: string
  pathPrefix: string
  profileId: string
}

export interface ClaudeProfilesConfig {
  defaultProfileId: string
  profiles: ClaudeProfile[]
  workspaceRules: ClaudeWorkspaceProfileRule[]
}

export interface WorkspaceContextSnapshot {
  directory: string
  generatedAt: number
  gitBranch: string | null
  gitDirtyFiles: number
  topLevelDirectories: string[]
  topLevelFiles: string[]
  keyFiles: string[]
  npmScripts: string[]
  techHints: string[]
  readmeSnippet: string | null
}

export interface ChatRunReward {
  id: string
  chatSessionId: string
  workspaceDirectory: string
  status: 'success' | 'error' | 'stopped'
  timestamp: number
  durationMs: number
  rewardScore: number
  outcomeScore: number
  efficiencyScore: number
  safetyScore: number
  contextScore: number
  tokenDeltaInput: number
  tokenDeltaOutput: number
  contextFiles: number
  toolCalls: number
  fileWrites: number
  unresolvedMentions: number
  yoloMode: boolean
  notes: string[]
}

export interface SchedulerTaskInput {
  id?: string
  name: string
  cron: string
  prompt: string
  workingDirectory: string
  enabled: boolean
  yoloMode: boolean
}

export interface SchedulerTask {
  id: string
  name: string
  cron: string
  prompt: string
  workingDirectory: string
  enabled: boolean
  yoloMode: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  isRunning: boolean
  lastRunAt: number | null
  lastStatus: SchedulerRunStatus
  lastError: string | null
  lastDurationMs: number | null
  lastRunTrigger: SchedulerRunTrigger | null
}

export interface Scope {
  id: string
  name: string
  color: string
  directories: string[]
  soundEvents: Partial<Record<SoundEventType, SystemSound | 'none'>>
}

export const DEFAULT_SOUND_EVENTS: Record<SoundEventType, SystemSound> = {
  commit: 'Pop',
  push: 'Hero',
  test_pass: 'Glass',
  test_fail: 'Basso',
  build_pass: 'Ping',
  build_fail: 'Sosumi',
  agent_done: 'Blow',
  error: 'Funk',
}

export interface AgentEvent {
  id: string
  timestamp: number
  agentId: string
  agentName: string
  type: AgentEventType
  description: string
}

export interface TokenSnapshot {
  timestamp: number
  tokens_input: number
  tokens_output: number
}

export interface SessionStats {
  tokenHistory: TokenSnapshot[]
  peakInputRate: number
  peakOutputRate: number
  tokensByModel: Record<string, { input: number; output: number }>
}

export type SubscriptionType = 'api' | 'max_5x' | 'max_20x'

export interface SubscriptionConfig {
  type: SubscriptionType
  monthlyCost: number
}

export const SUBSCRIPTION_OPTIONS: Record<SubscriptionType, { label: string; monthlyCost: number }> = {
  api: { label: 'API (Pay per token)', monthlyCost: 0 },
  max_5x: { label: 'Claude Max 5x ($100/mo)', monthlyCost: 100 },
  max_20x: { label: 'Claude Max 20x ($200/mo)', monthlyCost: 200 },
}

export type HairStyle = 'short' | 'long' | 'ponytail' | 'buzz' | 'mohawk'

export type CursorStyle = 'block' | 'underline' | 'bar'

export interface AppSettings {
  general: {
    startingDirectory: 'home' | 'custom'
    customDirectory: string
    shell: 'default' | 'custom'
    customShell: string
  }
  appearance: {
    fontFamily: string
    fontSize: number
    cursorStyle: CursorStyle
    cursorBlink: boolean
    terminalTheme: TerminalThemeName
  }
  terminal: {
    scrollbackLines: number
    copyOnSelect: boolean
    optionAsMeta: boolean
    visualBell: boolean
    audibleBell: boolean
  }
  subscription: SubscriptionConfig
  scopes: Scope[]
  defaultScope: Scope
  soundsEnabled: boolean
  yoloMode: boolean
  telemetry: {
    enabled: boolean
  }
  claudeProfiles: ClaudeProfilesConfig
}

// ── Claude Chat Session Types ──────────────────────────────────────────

export interface ClaudeSystemInit {
  session_id: string
}

export interface ClaudeTextContent {
  text: string
  usage?: Record<string, unknown>
}

export interface ClaudeToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  usage?: Record<string, unknown>
}

export interface ClaudeToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
  usage?: Record<string, unknown>
}

export interface ClaudeThinkingContent {
  thinking: string
  usage?: Record<string, unknown>
}

export interface ClaudeSessionResult {
  result: string
  usage?: Record<string, unknown>
  modelUsage?: Record<string, unknown>
  is_error?: boolean
  error?: string
  session_id?: string
}

export interface ClaudeErrorInfo {
  message: string
  code?: string
}

export type ClaudeEventType =
  | 'init'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'result'
  | 'error'

export interface ClaudeEvent {
  sessionId: string
  type: ClaudeEventType
  data:
    | ClaudeSystemInit
    | ClaudeTextContent
    | ClaudeToolUse
    | ClaudeToolResult
    | ClaudeThinkingContent
    | ClaudeSessionResult
    | ClaudeErrorInfo
}

/** A single message in the chat UI timeline */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'error'
  content: string
  timestamp: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
  isError?: boolean
  isCollapsed?: boolean
}

export interface ClaudeSessionOptions {
  prompt: string
  model?: string
  systemPrompt?: string
  allowedTools?: string[]
  workingDirectory?: string
  dangerouslySkipPermissions?: boolean
}

export const DEFAULT_SCOPE: Scope = {
  id: 'default',
  name: 'Default',
  color: '#6b7280',
  directories: [],
  soundEvents: {},
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startingDirectory: 'home',
    customDirectory: '',
    shell: 'default',
    customShell: ''
  },
  appearance: {
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    cursorStyle: 'bar',
    cursorBlink: true,
    terminalTheme: 'agent-space',
  },
  terminal: {
    scrollbackLines: 5000,
    copyOnSelect: false,
    optionAsMeta: false,
    visualBell: false,
    audibleBell: false
  },
  subscription: {
    type: 'api',
    monthlyCost: 0
  },
  scopes: [],
  defaultScope: DEFAULT_SCOPE,
  soundsEnabled: true,
  yoloMode: false,
  telemetry: {
    enabled: false,
  },
  claudeProfiles: {
    defaultProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        settingsPath: '',
        mcpConfigPath: '',
        pluginDirs: [],
        settingSources: ['user', 'project', 'local'],
        agent: '',
        permissionMode: 'default',
        strictMcpConfig: false,
      },
    ],
    workspaceRules: [],
  },
}

export interface AgentAppearance {
  shirtColor: string
  hairColor: string
  hairStyle: HairStyle
  skinTone: string
  pantsColor: string
  gender: 'masculine' | 'feminine'
}

export interface Agent {
  id: string
  name: string
  agent_type: AgentType
  status: AgentStatus
  currentTask: string
  model: string
  tokens_input: number
  tokens_output: number
  files_modified: number
  started_at: number
  deskIndex: number
  terminalId: string
  isClaudeRunning: boolean
  appearance: AgentAppearance
  commitCount: number
  activeCelebration: CelebrationType | null
  celebrationStartedAt: number | null
  sessionStats: SessionStats
  isSubagent?: boolean
  parentAgentId?: string
  meetingSeat?: number
}

const SHIRT_COLORS = ['#4fa3f7', '#4ade80', '#a78bfa', '#fb923c', '#f87171', '#22d3ee', '#e879f9', '#facc15', '#34d399', '#f472b6']
const HAIR_COLORS = ['#1a1a2e', '#3b2f1e', '#8b4513', '#d4a574', '#c0392b', '#e8e0d4', '#6b4c9a', '#2563eb']
const SKIN_TONES = ['#ffdbb4', '#f5c6a0', '#d4a373', '#a67b5b', '#8d5524', '#6b3e26']
const PANTS_COLORS = ['#4a5568', '#1e293b', '#3f3f46', '#1e3a5f', '#4a3728', '#2d2d44']
const HAIR_STYLES: HairStyle[] = ['short', 'long', 'ponytail', 'buzz', 'mohawk']

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomAppearance(): AgentAppearance {
  return {
    shirtColor: randomFrom(SHIRT_COLORS),
    hairColor: randomFrom(HAIR_COLORS),
    hairStyle: randomFrom(HAIR_STYLES),
    skinTone: randomFrom(SKIN_TONES),
    pantsColor: randomFrom(PANTS_COLORS),
    gender: Math.random() > 0.5 ? 'feminine' : 'masculine'
  }
}

export const AGENT_COLORS: Record<AgentType, string> = {
  cursor: '#4fa3f7',
  cli: '#4ade80',
  chat: '#22d3ee',
  mcp: '#a78bfa',
  copilot: '#fb923c'
}

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking...',
  streaming: 'Streaming',
  tool_calling: 'Tool Call',
  waiting: 'Waiting',
  error: 'Error!',
  done: 'Done'
}
