import type { AppSettings, ClaudeEvent, ClaudeSessionOptions } from '../renderer/types'

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
    create: (options?: { cols?: number; rows?: number }) => Promise<{ id: string; cwd: string }>
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
    onNewTerminal: (callback: () => void) => Unsubscribe
    onFocusChat: (callback: () => void) => Unsubscribe
    onResetLayout: (callback: () => void) => Unsubscribe
    onFocusPanel: (callback: (panelId: string) => void) => Unsubscribe
  }
  fs: {
    readDir: (dirPath: string, showHidden?: boolean) => Promise<FsEntry[]>
    readFile: (filePath: string) => Promise<FsReadFileResult>
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
}
