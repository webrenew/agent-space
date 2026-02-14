import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { setupTerminalHandlers, cleanupTerminals } from './terminal'
import { setupSettingsHandlers, createApplicationMenu } from './settings'
import { setupClaudeSessionHandlers, cleanupClaudeSessions } from './claude-session'
import { setupFilesystemHandlers } from './filesystem'
import { setupLspHandlers, cleanupLspServers } from './lsp-manager'
import { setupMemoriesHandlers, cleanupMemories } from './memories'
import { setupAgentNamerHandlers } from './agent-namer'

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  function createWindow(): void {
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

    setupTerminalHandlers(mainWindow)
    setupClaudeSessionHandlers(mainWindow)
    setupSettingsHandlers()
    setupFilesystemHandlers(mainWindow)
    setupLspHandlers(mainWindow)
    setupMemoriesHandlers()
    setupAgentNamerHandlers(mainWindow)
    createApplicationMenu(mainWindow)

    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  }

  app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('before-quit', () => {
    cleanupTerminals()
    cleanupClaudeSessions()
    cleanupLspServers()
    cleanupMemories().catch(() => {})
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
