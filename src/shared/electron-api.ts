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

export type Unsubscribe = () => void

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
    onFocusPanel: (callback: (panelId: string) => void) => Unsubscribe
  }
  fs: {
    readDir: (dirPath: string, showHidden?: boolean) => Promise<FsEntry[]>
    readFile: (filePath: string) => Promise<FsReadFileResult>
    readImageDataUrl: (filePath: string) => Promise<FsReadImageDataUrlResult>
    search: (rootDir: string, query: string, maxResults?: number) => Promise<FsSearchResult[]>
    homeDir: () => Promise<string>
    stat: (filePath: string) => Promise<FsStatResult>
    writeFile: (filePath: string, content: string) => Promise<void>
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
  scheduler: {
    list: () => Promise<SchedulerTask[]>
    upsert: (task: SchedulerTaskInput) => Promise<SchedulerTask>
    delete: (taskId: string) => Promise<void>
    runNow: (taskId: string) => Promise<SchedulerTask>
    onUpdated: (callback: () => void) => Unsubscribe
  }
  todoRunner: {
    list: () => Promise<TodoRunnerJob[]>
    upsert: (job: TodoRunnerJobInput) => Promise<TodoRunnerJob>
    delete: (jobId: string) => Promise<void>
    start: (jobId: string) => Promise<TodoRunnerJob>
    pause: (jobId: string) => Promise<TodoRunnerJob>
    reset: (jobId: string) => Promise<TodoRunnerJob>
    onUpdated: (callback: () => void) => Unsubscribe
  }
}
