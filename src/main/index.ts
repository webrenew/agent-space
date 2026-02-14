import { app, BrowserWindow, shell, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { setupTerminalHandlers, cleanupTerminals } from './terminal'
import { setupSettingsHandlers, createApplicationMenu, loadSettings } from './settings'
import { setupClaudeSessionHandlers, cleanupClaudeSessions } from './claude-session'
import { setupFilesystemHandlers } from './filesystem'
import { setupLspHandlers, cleanupLspServers } from './lsp-manager'
import { setupMemoriesHandlers, cleanupMemories } from './memories'
import { setupAgentNamerHandlers } from './agent-namer'
import { setupSchedulerHandlers, cleanupScheduler } from './scheduler'
import { setupTodoRunnerHandlers, cleanupTodoRunner } from './todo-runner'
import { setupWorkspaceContextHandlers } from './workspace-context'
import {
  addStartupBreadcrumb,
  flushStartupBreadcrumbs,
  getTelemetryLogPath,
  recordException,
  recordIpcRegistrationError,
  recordIpcRuntimeError,
  recordTelemetryEvent,
} from './telemetry'
import {
  getDiagnosticsLogPath,
  logMainError,
  logMainEvent,
  setupDiagnosticsHandlers,
} from './diagnostics'

// Strip Claude session env vars so embedded terminals can launch Claude Code
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE')) delete process.env[key]
}

const userDataOverride = process.env['AGENT_SPACE_USER_DATA_DIR']
if (typeof userDataOverride === 'string' && userDataOverride.trim().length > 0) {
  app.setPath('userData', userDataOverride)
}

addStartupBreadcrumb('main.bootstrap.start', {
  platform: process.platform,
  pid: process.pid,
  userDataPath: app.getPath('userData'),
})

try {
  loadSettings()
  addStartupBreadcrumb('settings.preload.success')
} catch (err) {
  recordException('settings.preload', err)
}

let processTelemetryAttached = false
function setupProcessTelemetryListeners(): void {
  if (processTelemetryAttached) return
  processTelemetryAttached = true

  process.on('uncaughtException', (error) => {
    recordException('uncaughtException', error)
    logMainError('uncaughtException', error)
  })

  process.on('unhandledRejection', (reason) => {
    recordException('unhandledRejection', reason)
    logMainError('unhandledRejection', reason)
  })
}

let ipcMainWrapped = false
function patchIpcMainWithTelemetry(): void {
  if (ipcMainWrapped) return
  ipcMainWrapped = true

  const originalHandle = ipcMain.handle.bind(ipcMain)
  const originalOn = ipcMain.on.bind(ipcMain)
  type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>
  type OnListener = (event: IpcMainEvent, ...args: unknown[]) => void
  const isDuplicateHandlerError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err)
    return message.includes('Attempted to register a second handler')
  }
  const onChannelListeners = new Map<string, OnListener>()

  ipcMain.handle = ((channel: string, listener: InvokeHandler) => {
    addStartupBreadcrumb('ipc.handle.register', { channel })
    const wrapped: InvokeHandler = async (event, ...args) => {
      try {
        return await listener(event, ...args)
      } catch (err) {
        recordIpcRuntimeError(channel, err)
        throw err
      }
    }

    try {
      return originalHandle(channel, wrapped)
    } catch (err) {
      if (isDuplicateHandlerError(err)) {
        addStartupBreadcrumb('ipc.handle.duplicate_recovered', { channel })
        recordTelemetryEvent('ipc.handle.duplicate_recovered', { channel })
        try {
          ipcMain.removeHandler(channel)
          return originalHandle(channel, wrapped)
        } catch (retryErr) {
          recordIpcRegistrationError(channel, retryErr)
          throw retryErr
        }
      }
      recordIpcRegistrationError(channel, err)
      throw err
    }
  }) as typeof ipcMain.handle

  ipcMain.on = ((channel: string, listener: OnListener) => {
    addStartupBreadcrumb('ipc.on.register', { channel })
    const wrapped: OnListener = (event, ...args) => {
      try {
        listener(event, ...args)
      } catch (err) {
        recordIpcRuntimeError(channel, err)
        throw err
      }
    }

    const existing = onChannelListeners.get(channel)
    if (existing) {
      ipcMain.removeListener(channel, existing)
      addStartupBreadcrumb('ipc.on.duplicate_replaced', { channel })
      recordTelemetryEvent('ipc.on.duplicate_replaced', { channel })
    }
    onChannelListeners.set(channel, wrapped)
    return originalOn(channel, wrapped)
  }) as typeof ipcMain.on
}

setupProcessTelemetryListeners()
patchIpcMainWithTelemetry()

// Track popped-out chat windows: sessionId → BrowserWindow
const chatWindows = new Map<string, BrowserWindow>()

function createChatWindow(sessionId: string, mainWindow: BrowserWindow): BrowserWindow {
  addStartupBreadcrumb('chat.popout.create', { sessionId })
  const chatWin = new BrowserWindow({
    width: 600,
    height: 700,
    minWidth: 400,
    minHeight: 400,
    title: 'Chat — Agent Office',
    backgroundColor: '#0E0E0D',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  chatWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev: Vite dev server — load chat-window.html with query param
    const baseUrl = process.env['ELECTRON_RENDERER_URL']
    chatWin.loadURL(`${baseUrl}/chat-window.html?sessionId=${encodeURIComponent(sessionId)}`)
  } else {
    // Production: load from built files
    chatWin.loadFile(
      path.join(__dirname, '../renderer/chat-window.html'),
      { search: `sessionId=${encodeURIComponent(sessionId)}` }
    )
  }

  chatWindows.set(sessionId, chatWin)

  chatWin.on('closed', () => {
    chatWindows.delete(sessionId)
    recordTelemetryEvent('chat.popout.closed', { sessionId })
    // Notify main window the session was returned
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:returned', sessionId)
    }
  })

  return chatWin
}

const gotTheLock = app.requestSingleInstanceLock()
addStartupBreadcrumb('app.single_instance_lock', { acquired: gotTheLock })

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let chatPopoutHandlerRegistered = false
  let rendererCrashStreak = 0
  let rendererCrashStreakWindowStart = 0

  app.on('second-instance', () => {
    recordTelemetryEvent('app.second_instance')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  function setupChatPopoutHandler(): void {
    if (chatPopoutHandlerRegistered) return
    chatPopoutHandlerRegistered = true

    ipcMain.handle('chat:popout', (_event, sessionId: unknown) => {
      if (typeof sessionId !== 'string' || !mainWindow) return
      // Don't create duplicate windows
      if (chatWindows.has(sessionId)) {
        chatWindows.get(sessionId)?.focus()
        return
      }
      createChatWindow(sessionId, mainWindow)
    })
  }

  function createWindow(): void {
    addStartupBreadcrumb('window.create.start')

    const runStartupStep = (step: string, fn: () => void): void => {
      addStartupBreadcrumb(`startup.${step}.start`)
      try {
        fn()
        addStartupBreadcrumb(`startup.${step}.ok`)
      } catch (err) {
        recordException('startup.step_failed', err, { step })
        throw err
      }
    }

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: 'Agent Office',
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      recordTelemetryEvent('renderer.process_gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      })
      logMainEvent('renderer.process_gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      }, 'error')

      const now = Date.now()
      if (now - rendererCrashStreakWindowStart > 60_000) {
        rendererCrashStreak = 0
        rendererCrashStreakWindowStart = now
      }
      rendererCrashStreak += 1
      const shouldAttemptRecovery = rendererCrashStreak <= 3
      if (!shouldAttemptRecovery) {
        logMainEvent('renderer.recovery.skipped', {
          reason: details.reason,
          crashStreak: rendererCrashStreak,
        }, 'warn')
        return
      }

      const target = mainWindow
      setTimeout(() => {
        if (!target || target.isDestroyed()) return
        try {
          logMainEvent('renderer.recovery.reload', {
            crashStreak: rendererCrashStreak,
            reason: details.reason,
          }, 'warn')
          target.webContents.reloadIgnoringCache()
        } catch (err) {
          logMainError('renderer.recovery.reload_failed', err, {
            reason: details.reason,
            crashStreak: rendererCrashStreak,
          })
        }
      }, 700)
    })

    runStartupStep('diagnostics_handlers', () => setupDiagnosticsHandlers())
    runStartupStep('terminal_handlers', () => setupTerminalHandlers(mainWindow!))
    runStartupStep('claude_handlers', () => setupClaudeSessionHandlers(mainWindow!))
    runStartupStep('settings_handlers', () => setupSettingsHandlers())
    flushStartupBreadcrumbs()
    runStartupStep('filesystem_handlers', () => setupFilesystemHandlers(mainWindow!))
    runStartupStep('workspace_context_handlers', () => setupWorkspaceContextHandlers())
    runStartupStep('lsp_handlers', () => setupLspHandlers(mainWindow!))
    runStartupStep('memories_handlers', () => setupMemoriesHandlers())
    runStartupStep('agent_namer_handlers', () => setupAgentNamerHandlers(mainWindow!))
    runStartupStep('scheduler_handlers', () => setupSchedulerHandlers())
    runStartupStep('todo_runner_handlers', () => setupTodoRunnerHandlers())
    runStartupStep('menu', () => createApplicationMenu(mainWindow!))
    runStartupStep('chat_popout_handler', () => setupChatPopoutHandler())

    const loadRendererPromise = process.env['ELECTRON_RENDERER_URL']
      ? mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
      : mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

    loadRendererPromise.catch((err) => {
      recordException('window.load_failed', err)
    })

    addStartupBreadcrumb('window.create.done')
    recordTelemetryEvent('window.created', { telemetryLogPath: getTelemetryLogPath() })
    logMainEvent('window.created', {
      telemetryLogPath: getTelemetryLogPath(),
      diagnosticsLogPath: getDiagnosticsLogPath(),
    })
  }

  app.whenReady().then(() => {
    addStartupBreadcrumb('app.ready')
    recordTelemetryEvent('app.ready')

    app.on('render-process-gone', (_event, webContents, details) => {
      recordTelemetryEvent('app.render_process_gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        webContentsId: webContents.id,
      })
      logMainEvent('app.render_process_gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        webContentsId: webContents.id,
      }, 'error')
    })

    app.on('child-process-gone', (_event, details) => {
      recordTelemetryEvent('app.child_process_gone', {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      })
      logMainEvent('app.child_process_gone', {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      }, details.reason === 'clean-exit' ? 'info' : 'warn')
    })

    createWindow()

    app.on('activate', () => {
      recordTelemetryEvent('app.activate', {
        windowCount: BrowserWindow.getAllWindows().length,
      })
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  }).catch((err) => {
    recordException('app.whenReady', err)
  })

  app.on('before-quit', () => {
    recordTelemetryEvent('app.before_quit')
    // Close all popped-out chat windows first
    for (const [, win] of chatWindows) {
      if (!win.isDestroyed()) win.close()
    }
    chatWindows.clear()

    cleanupTerminals()
    cleanupClaudeSessions()
    cleanupLspServers()
    cleanupMemories().catch(() => {})
    cleanupScheduler()
    cleanupTodoRunner()
  })

  app.on('window-all-closed', () => {
    recordTelemetryEvent('app.window_all_closed', { platform: process.platform })
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
