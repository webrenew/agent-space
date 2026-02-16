import type {
  AppSettings,
  ClaudeEvent,
  ClaudeSessionOptions,
  WorkspaceContextSnapshot,
  SchedulerTask,
  SchedulerTaskInput,
  TodoRunnerJob,
  TodoRunnerJobInput,
} from '../renderer/types'
import type { PanelId } from './panel-registry'

export type Unsubscribe = () => void

export const IPC_CHANNELS = {
  terminal: {
    create: 'terminal:create',
    write: 'terminal:write',
    resize: 'terminal:resize',
    kill: 'terminal:kill',
    data: 'terminal:data',
    exit: 'terminal:exit',
    claudeStatus: 'terminal:claude-status',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    selectDirectory: 'settings:selectDirectory',
    openSettings: 'menu:openSettings',
    openHelp: 'menu:openHelp',
    newTerminal: 'menu:newTerminal',
    focusChat: 'menu:focusChat',
    resetLayout: 'menu:resetLayout',
  },
  fs: {
    readDir: 'fs:readDir',
    readFile: 'fs:readFile',
    readImageDataUrl: 'fs:readImageDataUrl',
    readDataUrl: 'fs:readDataUrl',
    search: 'fs:search',
    homeDir: 'fs:homeDir',
    stat: 'fs:stat',
    writeFile: 'fs:writeFile',
    writeDataUrl: 'fs:writeDataUrl',
    openFolderDialog: 'fs:openFolderDialog',
    openFolder: 'fs:openFolder',
    rename: 'fs:rename',
    delete: 'fs:delete',
    revealInFinder: 'fs:revealInFinder',
    openInTerminal: 'fs:openInTerminal',
  },
  lsp: {
    start: 'lsp:start',
    send: 'lsp:send',
    stop: 'lsp:stop',
    languages: 'lsp:languages',
    message: 'lsp:message',
  },
  claude: {
    start: 'claude:start',
    stop: 'claude:stop',
    observeSession: 'claude:observeSession',
    unobserveSession: 'claude:unobserveSession',
    isAvailable: 'claude:isAvailable',
    event: 'claude:event',
  },
  agent: {
    generateMeta: 'agent:generateMeta',
  },
  chat: {
    popout: 'chat:popout',
    returned: 'chat:returned',
  },
  memories: {
    addChatMessage: 'memories:addChatMessage',
    getChatHistory: 'memories:getChatHistory',
    isReady: 'memories:isReady',
  },
  diagnostics: {
    logRenderer: 'diagnostics:logRenderer',
    getLogPath: 'diagnostics:getLogPath',
  },
  context: {
    getWorkspaceSnapshot: 'context:getWorkspaceSnapshot',
  },
  updates: {
    getStatus: 'updates:getStatus',
  },
  scheduler: {
    list: 'scheduler:list',
    upsert: 'scheduler:upsert',
    delete: 'scheduler:delete',
    runNow: 'scheduler:runNow',
    debugRuntimeSize: 'scheduler:debugRuntimeSize',
    updated: 'scheduler:updated',
  },
  todoRunner: {
    list: 'todoRunner:list',
    upsert: 'todoRunner:upsert',
    delete: 'todoRunner:delete',
    start: 'todoRunner:start',
    pause: 'todoRunner:pause',
    reset: 'todoRunner:reset',
    updated: 'todoRunner:updated',
  },
} as const

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

export interface FsReadFileResult {
  content: string
  truncated: boolean
  size: number
}

export interface FsReadImageDataUrlResult {
  dataUrl: string
  size: number
  mimeType: string
}

export interface FsReadDataUrlResult {
  dataUrl: string
  size: number
  mimeType: string
}

export interface FsWriteDataUrlResult {
  size: number
  mimeType: string
}

export interface FsSearchResult {
  path: string
  name: string
  isDirectory: boolean
}

export interface FsStatResult {
  isDirectory: boolean
  isFile: boolean
  size: number
  modified: number
}

export interface LspServerInfo {
  serverId: string
  languages: string[]
}

export interface LspLanguageInfo {
  name: string
  languages: string[]
  active: boolean
}

export interface LspMessagePayload {
  serverId: string
  message: unknown
}

export interface ChatMemoryEntry {
  id: string
  content: string
  role: string
  timestamp: string
  category: string
}

export interface ChatMemoryWrite {
  content: string
  role: string
  scopeId: string
  scopeName: string
  workspacePath: string
}

export interface SchedulerDeleteResult {
  taskId: string
  wasRunning: boolean
  stopped: boolean
  forced: boolean
  timedOut: boolean
}

export interface TodoRunnerStopOutcome {
  jobId: string
  wasRunning: boolean
  stopped: boolean
  forced: boolean
  timedOut: boolean
}

export interface TodoRunnerDeleteResult extends TodoRunnerStopOutcome {
  deleted: boolean
}

export interface TodoRunnerPauseResult {
  job: TodoRunnerJob
  stopOutcome: TodoRunnerStopOutcome
}

export interface AppUpdateStatusResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string
  checkedAt: number
  error: string | null
}

export interface ElectronAPI {
  versions: {
    node: string
    chrome: string
    electron: string
  }
  terminal: {
    create: (options?: { cols?: number; rows?: number; cwd?: string }) => Promise<{ id: string; cwd: string }>
    write: (id: string, data: string) => void
    resize: (id: string, cols: number, rows: number) => void
    kill: (id: string) => Promise<void>
    onData: (callback: (id: string, data: string) => void) => Unsubscribe
    onExit: (callback: (id: string, exitCode: number, signal?: number) => void) => Unsubscribe
    onClaudeStatus: (callback: (id: string, isRunning: boolean) => void) => Unsubscribe
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: AppSettings) => Promise<void>
    selectDirectory: () => Promise<string | null>
    onOpenSettings: (callback: () => void) => Unsubscribe
    onOpenHelp: (callback: () => void) => Unsubscribe
    onNewTerminal: (callback: () => void) => Unsubscribe
    onFocusChat: (callback: () => void) => Unsubscribe
    onResetLayout: (callback: () => void) => Unsubscribe
    onFocusPanel: (callback: (panelId: PanelId) => void) => Unsubscribe
  }
  fs: {
    readDir: (dirPath: string, showHidden?: boolean) => Promise<FsEntry[]>
    readFile: (filePath: string) => Promise<FsReadFileResult>
    readImageDataUrl: (filePath: string) => Promise<FsReadImageDataUrlResult>
    readDataUrl: (filePath: string) => Promise<FsReadDataUrlResult>
    search: (rootDir: string, query: string, maxResults?: number) => Promise<FsSearchResult[]>
    homeDir: () => Promise<string>
    stat: (filePath: string) => Promise<FsStatResult>
    writeFile: (filePath: string, content: string) => Promise<void>
    writeDataUrl: (filePath: string, dataUrl: string) => Promise<FsWriteDataUrlResult>
    openFolderDialog: () => Promise<string | null>
    onOpenFolder: (callback: (folderPath: string) => void) => Unsubscribe
    rename: (oldPath: string, newName: string) => Promise<{ newPath: string }>
    delete: (filePath: string) => Promise<void>
    revealInFinder: (filePath: string) => Promise<void>
    openInTerminal: (dirPath: string) => Promise<void>
  }
  lsp: {
    start: (languageId: string) => Promise<LspServerInfo | null>
    send: (serverId: string, message: unknown) => Promise<boolean>
    stop: (serverId: string) => Promise<boolean>
    languages: () => Promise<LspLanguageInfo[]>
    onMessage: (callback: (payload: LspMessagePayload) => void) => Unsubscribe
  }
  claude: {
    start: (options: ClaudeSessionOptions) => Promise<{ sessionId: string }>
    stop: (sessionId: string) => Promise<void>
    observeSession: (sessionId: string) => Promise<void>
    unobserveSession: (sessionId: string) => Promise<void>
    isAvailable: () => Promise<{ available: boolean; binaryPath: string | null; version: string | null; error?: string }>
    onEvent: (callback: (event: ClaudeEvent) => void) => Unsubscribe
  }
  agent: {
    generateMeta: (prompt: string) => Promise<{ name: string; taskDescription: string }>
  }
  chat: {
    popout: (sessionId: string) => Promise<void>
    onReturned: (callback: (sessionId: string) => void) => Unsubscribe
  }
  memories: {
    addChatMessage: (opts: ChatMemoryWrite) => Promise<void>
    getChatHistory: (scopeId: string, limit?: number) => Promise<ChatMemoryEntry[]>
    isReady: () => Promise<boolean>
  }
  diagnostics: {
    logRenderer: (
      level: 'info' | 'warn' | 'error',
      event: string,
      payload?: Record<string, unknown>
    ) => Promise<void>
    getLogPath: () => Promise<string>
  }
  context: {
    getWorkspaceSnapshot: (directory: string) => Promise<WorkspaceContextSnapshot>
  }
  updates: {
    getStatus: () => Promise<AppUpdateStatusResult>
  }
  scheduler: {
    list: () => Promise<SchedulerTask[]>
    upsert: (task: SchedulerTaskInput) => Promise<SchedulerTask>
    delete: (taskId: string) => Promise<SchedulerDeleteResult>
    runNow: (taskId: string) => Promise<SchedulerTask>
    debugRuntimeSize: () => Promise<number>
    onUpdated: (callback: () => void) => Unsubscribe
  }
  todoRunner: {
    list: () => Promise<TodoRunnerJob[]>
    upsert: (job: TodoRunnerJobInput) => Promise<TodoRunnerJob>
    delete: (jobId: string) => Promise<TodoRunnerDeleteResult>
    start: (jobId: string) => Promise<TodoRunnerJob>
    pause: (jobId: string) => Promise<TodoRunnerPauseResult>
    reset: (jobId: string) => Promise<TodoRunnerJob>
    onUpdated: (callback: () => void) => Unsubscribe
  }
}
