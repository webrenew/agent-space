import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  terminal: {
    create: (options?: { cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', options) as Promise<{ id: string }>,

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

    set: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),

    selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),

    onOpenSettings: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('menu:openSettings', handler)
      return () => { ipcRenderer.removeListener('menu:openSettings', handler) }
    }
  }
})
