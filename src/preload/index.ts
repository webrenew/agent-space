import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type ElectronAPI,
  type Unsubscribe,
} from '../shared/electron-api'
import {
  PANEL_FOCUS_CHANNELS,
  panelIdFromFocusChannel,
  type PanelId,
} from '../shared/panel-registry'

type SubscriptionCallback<T> = T extends (callback: infer C) => Unsubscribe ? C : never

function invokeFor<T extends (...args: never[]) => Promise<unknown>>(channel: string): T {
  return ((...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  }) as unknown as T
}

function sendFor<T extends (...args: never[]) => void>(channel: string): T {
  return ((...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  }) as unknown as T
}

function subscribeFor<T extends (...args: never[]) => void>(
  channel: string
): (callback: T) => Unsubscribe {
  return (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...(args as Parameters<T>))
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

const electronAPI: ElectronAPI = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  terminal: {
    create: invokeFor<ElectronAPI['terminal']['create']>(IPC_CHANNELS.terminal.create),
    write: sendFor<ElectronAPI['terminal']['write']>(IPC_CHANNELS.terminal.write),
    resize: sendFor<ElectronAPI['terminal']['resize']>(IPC_CHANNELS.terminal.resize),
    kill: invokeFor<ElectronAPI['terminal']['kill']>(IPC_CHANNELS.terminal.kill),
    onData: subscribeFor<SubscriptionCallback<ElectronAPI['terminal']['onData']>>(IPC_CHANNELS.terminal.data),
    onExit: subscribeFor<SubscriptionCallback<ElectronAPI['terminal']['onExit']>>(IPC_CHANNELS.terminal.exit),
    onClaudeStatus: subscribeFor<SubscriptionCallback<ElectronAPI['terminal']['onClaudeStatus']>>(
      IPC_CHANNELS.terminal.claudeStatus
    ),
  },
  settings: {
    get: invokeFor<ElectronAPI['settings']['get']>(IPC_CHANNELS.settings.get),
    set: invokeFor<ElectronAPI['settings']['set']>(IPC_CHANNELS.settings.set),
    selectDirectory: invokeFor<ElectronAPI['settings']['selectDirectory']>(IPC_CHANNELS.settings.selectDirectory),
    onOpenSettings: subscribeFor<SubscriptionCallback<ElectronAPI['settings']['onOpenSettings']>>(
      IPC_CHANNELS.settings.openSettings
    ),
    onOpenHelp: subscribeFor<SubscriptionCallback<ElectronAPI['settings']['onOpenHelp']>>(
      IPC_CHANNELS.settings.openHelp
    ),
    onNewTerminal: subscribeFor<SubscriptionCallback<ElectronAPI['settings']['onNewTerminal']>>(
      IPC_CHANNELS.settings.newTerminal
    ),
    onFocusChat: subscribeFor<SubscriptionCallback<ElectronAPI['settings']['onFocusChat']>>(
      IPC_CHANNELS.settings.focusChat
    ),
    onResetLayout: subscribeFor<SubscriptionCallback<ElectronAPI['settings']['onResetLayout']>>(
      IPC_CHANNELS.settings.resetLayout
    ),
    onFocusPanel: (callback: (panelId: PanelId) => void) => {
      const handlers: Array<{ ch: (typeof PANEL_FOCUS_CHANNELS)[number]; handler: () => void }> = []
      for (const ch of PANEL_FOCUS_CHANNELS) {
        const panelId = panelIdFromFocusChannel(ch)
        if (!panelId) continue
        const handler = () => callback(panelId)
        ipcRenderer.on(ch, handler)
        handlers.push({ ch, handler })
      }
      return () => {
        for (const { ch, handler } of handlers) {
          ipcRenderer.removeListener(ch, handler)
        }
      }
    },
  },
  fs: {
    readDir: invokeFor<ElectronAPI['fs']['readDir']>(IPC_CHANNELS.fs.readDir),
    readFile: invokeFor<ElectronAPI['fs']['readFile']>(IPC_CHANNELS.fs.readFile),
    readImageDataUrl: invokeFor<ElectronAPI['fs']['readImageDataUrl']>(IPC_CHANNELS.fs.readImageDataUrl),
    readDataUrl: invokeFor<ElectronAPI['fs']['readDataUrl']>(IPC_CHANNELS.fs.readDataUrl),
    search: invokeFor<ElectronAPI['fs']['search']>(IPC_CHANNELS.fs.search),
    homeDir: invokeFor<ElectronAPI['fs']['homeDir']>(IPC_CHANNELS.fs.homeDir),
    stat: invokeFor<ElectronAPI['fs']['stat']>(IPC_CHANNELS.fs.stat),
    writeFile: invokeFor<ElectronAPI['fs']['writeFile']>(IPC_CHANNELS.fs.writeFile),
    writeDataUrl: invokeFor<ElectronAPI['fs']['writeDataUrl']>(IPC_CHANNELS.fs.writeDataUrl),
    openFolderDialog: invokeFor<ElectronAPI['fs']['openFolderDialog']>(IPC_CHANNELS.fs.openFolderDialog),
    onOpenFolder: subscribeFor<SubscriptionCallback<ElectronAPI['fs']['onOpenFolder']>>(IPC_CHANNELS.fs.openFolder),
    rename: invokeFor<ElectronAPI['fs']['rename']>(IPC_CHANNELS.fs.rename),
    delete: invokeFor<ElectronAPI['fs']['delete']>(IPC_CHANNELS.fs.delete),
    revealInFinder: invokeFor<ElectronAPI['fs']['revealInFinder']>(IPC_CHANNELS.fs.revealInFinder),
    openInTerminal: invokeFor<ElectronAPI['fs']['openInTerminal']>(IPC_CHANNELS.fs.openInTerminal),
  },
  lsp: {
    start: invokeFor<ElectronAPI['lsp']['start']>(IPC_CHANNELS.lsp.start),
    send: invokeFor<ElectronAPI['lsp']['send']>(IPC_CHANNELS.lsp.send),
    stop: invokeFor<ElectronAPI['lsp']['stop']>(IPC_CHANNELS.lsp.stop),
    languages: invokeFor<ElectronAPI['lsp']['languages']>(IPC_CHANNELS.lsp.languages),
    onMessage: subscribeFor<SubscriptionCallback<ElectronAPI['lsp']['onMessage']>>(IPC_CHANNELS.lsp.message),
  },
  claude: {
    start: invokeFor<ElectronAPI['claude']['start']>(IPC_CHANNELS.claude.start),
    stop: invokeFor<ElectronAPI['claude']['stop']>(IPC_CHANNELS.claude.stop),
    observeSession: invokeFor<ElectronAPI['claude']['observeSession']>(IPC_CHANNELS.claude.observeSession),
    unobserveSession: invokeFor<ElectronAPI['claude']['unobserveSession']>(IPC_CHANNELS.claude.unobserveSession),
    isAvailable: invokeFor<ElectronAPI['claude']['isAvailable']>(IPC_CHANNELS.claude.isAvailable),
    onEvent: subscribeFor<SubscriptionCallback<ElectronAPI['claude']['onEvent']>>(IPC_CHANNELS.claude.event),
  },
  agent: {
    generateMeta: invokeFor<ElectronAPI['agent']['generateMeta']>(IPC_CHANNELS.agent.generateMeta),
  },
  chat: {
    popout: invokeFor<ElectronAPI['chat']['popout']>(IPC_CHANNELS.chat.popout),
    onReturned: subscribeFor<SubscriptionCallback<ElectronAPI['chat']['onReturned']>>(IPC_CHANNELS.chat.returned),
  },
  memories: {
    addChatMessage: invokeFor<ElectronAPI['memories']['addChatMessage']>(IPC_CHANNELS.memories.addChatMessage),
    getChatHistory: invokeFor<ElectronAPI['memories']['getChatHistory']>(IPC_CHANNELS.memories.getChatHistory),
    isReady: invokeFor<ElectronAPI['memories']['isReady']>(IPC_CHANNELS.memories.isReady),
  },
  diagnostics: {
    logRenderer: invokeFor<ElectronAPI['diagnostics']['logRenderer']>(IPC_CHANNELS.diagnostics.logRenderer),
    getLogPath: invokeFor<ElectronAPI['diagnostics']['getLogPath']>(IPC_CHANNELS.diagnostics.getLogPath),
  },
  context: {
    getWorkspaceSnapshot: invokeFor<ElectronAPI['context']['getWorkspaceSnapshot']>(
      IPC_CHANNELS.context.getWorkspaceSnapshot
    ),
  },
  updates: {
    getStatus: invokeFor<ElectronAPI['updates']['getStatus']>(IPC_CHANNELS.updates.getStatus),
  },
  scheduler: {
    list: invokeFor<ElectronAPI['scheduler']['list']>(IPC_CHANNELS.scheduler.list),
    upsert: invokeFor<ElectronAPI['scheduler']['upsert']>(IPC_CHANNELS.scheduler.upsert),
    delete: invokeFor<ElectronAPI['scheduler']['delete']>(IPC_CHANNELS.scheduler.delete),
    runNow: invokeFor<ElectronAPI['scheduler']['runNow']>(IPC_CHANNELS.scheduler.runNow),
    debugRuntimeSize: invokeFor<ElectronAPI['scheduler']['debugRuntimeSize']>(IPC_CHANNELS.scheduler.debugRuntimeSize),
    onUpdated: subscribeFor<SubscriptionCallback<ElectronAPI['scheduler']['onUpdated']>>(IPC_CHANNELS.scheduler.updated),
  },
  todoRunner: {
    list: invokeFor<ElectronAPI['todoRunner']['list']>(IPC_CHANNELS.todoRunner.list),
    upsert: invokeFor<ElectronAPI['todoRunner']['upsert']>(IPC_CHANNELS.todoRunner.upsert),
    delete: invokeFor<ElectronAPI['todoRunner']['delete']>(IPC_CHANNELS.todoRunner.delete),
    start: invokeFor<ElectronAPI['todoRunner']['start']>(IPC_CHANNELS.todoRunner.start),
    pause: invokeFor<ElectronAPI['todoRunner']['pause']>(IPC_CHANNELS.todoRunner.pause),
    reset: invokeFor<ElectronAPI['todoRunner']['reset']>(IPC_CHANNELS.todoRunner.reset),
    onUpdated: subscribeFor<SubscriptionCallback<ElectronAPI['todoRunner']['onUpdated']>>(IPC_CHANNELS.todoRunner.updated),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
