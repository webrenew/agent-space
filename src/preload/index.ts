import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/electron-api'

const electronAPI: ElectronAPI = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  terminal: {
    create: (options?: { cols?: number; rows?: number; cwd?: string }) =>
      ipcRenderer.invoke('terminal:create', options) as Promise<{ id: string; cwd: string }>,

    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', id, data),

    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', id, cols, rows),

    kill: (id: string) =>
      ipcRenderer.invoke('terminal:kill', id) as Promise<void>,

    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) =>
        callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => { ipcRenderer.removeListener('terminal:data', handler) }
    },

    onExit: (callback: (id: string, exitCode: number, signal?: number) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        id: string,
        exitCode: number,
        signal?: number
      ) => callback(id, exitCode, signal)
      ipcRenderer.on('terminal:exit', handler)
      return () => { ipcRenderer.removeListener('terminal:exit', handler) }
    },

    onClaudeStatus: (callback: (id: string, isRunning: boolean) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        id: string,
        isRunning: boolean
      ) => callback(id, isRunning)
      ipcRenderer.on('terminal:claude-status', handler)
      return () => { ipcRenderer.removeListener('terminal:claude-status', handler) }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),

    set: (settings) => ipcRenderer.invoke('settings:set', settings),

    selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),

    onOpenSettings: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:openSettings', handler)
      return () => { ipcRenderer.removeListener('menu:openSettings', handler) }
    },

    onOpenHelp: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:openHelp', handler)
      return () => { ipcRenderer.removeListener('menu:openHelp', handler) }
    },

    onNewTerminal: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:newTerminal', handler)
      return () => { ipcRenderer.removeListener('menu:newTerminal', handler) }
    },

    onFocusChat: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:focusChat', handler)
      return () => { ipcRenderer.removeListener('menu:focusChat', handler) }
    },

    onResetLayout: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:resetLayout', handler)
      return () => { ipcRenderer.removeListener('menu:resetLayout', handler) }
    },

    onFocusPanel: (callback: (panelId: string) => void) => {
      const channels = [
        'menu:focusPanel:chat', 'menu:focusPanel:terminal', 'menu:focusPanel:tokens',
        'menu:focusPanel:scene3d', 'menu:focusPanel:activity', 'menu:focusPanel:memoryGraph',
        'menu:focusPanel:agents', 'menu:focusPanel:recentMemories',
        'menu:focusPanel:fileExplorer', 'menu:focusPanel:fileSearch', 'menu:focusPanel:filePreview',
      ]
      const handlers = channels.map((ch) => {
        const panelId = ch.split(':').pop()!
        const handler = () => callback(panelId)
        ipcRenderer.on(ch, handler)
        return { ch, handler }
      })
      return () => {
        for (const { ch, handler } of handlers) {
          ipcRenderer.removeListener(ch, handler)
        }
      }
    },
  },
  fs: {
    readDir: (dirPath: string, showHidden?: boolean) =>
      ipcRenderer.invoke('fs:readDir', dirPath, showHidden) as Promise<Array<{
        name: string; path: string; isDirectory: boolean; isSymlink: boolean; size: number; modified: number
      }>>,

    readFile: (filePath: string) =>
      ipcRenderer.invoke('fs:readFile', filePath) as Promise<{
        content: string; truncated: boolean; size: number
      }>,

    readImageDataUrl: (filePath: string) =>
      ipcRenderer.invoke('fs:readImageDataUrl', filePath) as Promise<{
        dataUrl: string; size: number; mimeType: string
      }>,

    search: (rootDir: string, query: string, maxResults?: number) =>
      ipcRenderer.invoke('fs:search', rootDir, query, maxResults) as Promise<Array<{
        path: string; name: string; isDirectory: boolean
      }>>,

    homeDir: () =>
      ipcRenderer.invoke('fs:homeDir') as Promise<string>,

    stat: (filePath: string) =>
      ipcRenderer.invoke('fs:stat', filePath) as Promise<{
        isDirectory: boolean; isFile: boolean; size: number; modified: number
      }>,

    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content) as Promise<void>,

    openFolderDialog: () =>
      ipcRenderer.invoke('fs:openFolderDialog') as Promise<string | null>,

    onOpenFolder: (callback: (folderPath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, folderPath: string) =>
        callback(folderPath)
      ipcRenderer.on('fs:openFolder', handler)
      return () => { ipcRenderer.removeListener('fs:openFolder', handler) }
    },

    rename: (oldPath: string, newName: string) =>
      ipcRenderer.invoke('fs:rename', oldPath, newName) as Promise<{ newPath: string }>,

    delete: (filePath: string) =>
      ipcRenderer.invoke('fs:delete', filePath) as Promise<void>,

    revealInFinder: (filePath: string) =>
      ipcRenderer.invoke('fs:revealInFinder', filePath) as Promise<void>,

    openInTerminal: (dirPath: string) =>
      ipcRenderer.invoke('fs:openInTerminal', dirPath) as Promise<void>,
  },
  lsp: {
    start: (languageId: string) =>
      ipcRenderer.invoke('lsp:start', languageId) as Promise<{
        serverId: string; languages: string[]
      } | null>,

    send: (serverId: string, message: unknown) =>
      ipcRenderer.invoke('lsp:send', serverId, message) as Promise<boolean>,

    stop: (serverId: string) =>
      ipcRenderer.invoke('lsp:stop', serverId) as Promise<boolean>,

    languages: () =>
      ipcRenderer.invoke('lsp:languages') as Promise<Array<{
        name: string; languages: string[]; active: boolean
      }>>,

    onMessage: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { serverId: string; message: unknown }
      ): void => {
        callback(data)
      }
      ipcRenderer.on('lsp:message', handler)
      return () => { ipcRenderer.removeListener('lsp:message', handler) }
    },
  },
  claude: {
    start: (options) =>
      ipcRenderer.invoke('claude:start', options) as Promise<{ sessionId: string }>,

    stop: (sessionId: string) =>
      ipcRenderer.invoke('claude:stop', sessionId) as Promise<void>,

    isAvailable: () =>
      ipcRenderer.invoke('claude:isAvailable') as Promise<{
        available: boolean
        binaryPath: string | null
        version: string | null
        error?: string
      }>,

    onEvent: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        claudeEvent: unknown
      ) => callback(claudeEvent as Parameters<typeof callback>[0])
      ipcRenderer.on('claude:event', handler)
      return () => { ipcRenderer.removeListener('claude:event', handler) }
    }
  },
  agent: {
    generateMeta: (prompt: string) =>
      ipcRenderer.invoke('agent:generateMeta', prompt) as Promise<{ name: string; taskDescription: string }>,
  },
  chat: {
    popout: (sessionId: string) =>
      ipcRenderer.invoke('chat:popout', sessionId) as Promise<void>,

    onReturned: (callback: (sessionId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId)
      ipcRenderer.on('chat:returned', handler)
      return () => { ipcRenderer.removeListener('chat:returned', handler) }
    },
  },
  memories: {
    addChatMessage: (opts) => ipcRenderer.invoke('memories:addChatMessage', opts) as Promise<void>,

    getChatHistory: (scopeId: string, limit?: number) =>
      ipcRenderer.invoke('memories:getChatHistory', scopeId, limit) as Promise<Array<{
        id: string; content: string; role: string; timestamp: string; category: string
      }>>,

    isReady: () =>
      ipcRenderer.invoke('memories:isReady') as Promise<boolean>,
  },
  diagnostics: {
    logRenderer: (level, event, payload) =>
      ipcRenderer.invoke('diagnostics:logRenderer', { level, event, payload }) as Promise<void>,

    getLogPath: () =>
      ipcRenderer.invoke('diagnostics:getLogPath') as Promise<string>,
  },
  context: {
    getWorkspaceSnapshot: (directory: string) =>
      ipcRenderer.invoke('context:getWorkspaceSnapshot', directory),
  },
  scheduler: {
    list: () =>
      ipcRenderer.invoke('scheduler:list'),

    upsert: (task) =>
      ipcRenderer.invoke('scheduler:upsert', task),

    delete: (taskId: string) =>
      ipcRenderer.invoke('scheduler:delete', taskId) as Promise<void>,

    runNow: (taskId: string) =>
      ipcRenderer.invoke('scheduler:runNow', taskId),

    onUpdated: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('scheduler:updated', handler)
      return () => { ipcRenderer.removeListener('scheduler:updated', handler) }
    },
  },
  todoRunner: {
    list: () =>
      ipcRenderer.invoke('todoRunner:list'),

    upsert: (job) =>
      ipcRenderer.invoke('todoRunner:upsert', job),

    delete: (jobId: string) =>
      ipcRenderer.invoke('todoRunner:delete', jobId) as Promise<void>,

    start: (jobId: string) =>
      ipcRenderer.invoke('todoRunner:start', jobId),

    pause: (jobId: string) =>
      ipcRenderer.invoke('todoRunner:pause', jobId),

    reset: (jobId: string) =>
      ipcRenderer.invoke('todoRunner:reset', jobId),

    onUpdated: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('todoRunner:updated', handler)
      return () => { ipcRenderer.removeListener('todoRunner:updated', handler) }
    },
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
