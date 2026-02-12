import { app, ipcMain, dialog, Menu, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'

interface AppSettings {
  general: {
    startingDirectory: 'home' | 'custom'
    customDirectory: string
    shell: 'default' | 'custom'
    customShell: string
  }
  appearance: {
    fontFamily: string
    fontSize: number
    cursorStyle: 'block' | 'underline' | 'bar'
    cursorBlink: boolean
    terminalTheme: string
  }
  terminal: {
    scrollbackLines: number
    copyOnSelect: boolean
    optionAsMeta: boolean
    visualBell: boolean
    audibleBell: boolean
  }
  scopes: unknown[]
  defaultScope: {
    id: string
    name: string
    color: string
    directories: string[]
    soundEvents: Record<string, string>
  }
  soundsEnabled: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
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
  scopes: [],
  defaultScope: {
    id: 'default',
    name: 'Default',
    color: '#6b7280',
    directories: [],
    soundEvents: {},
  },
  soundsEnabled: true,
}

const SETTINGS_DIR = path.join(os.homedir(), '.agent-space')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

let cachedSettings: AppSettings = { ...DEFAULT_SETTINGS }

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>)
    } else {
      result[key] = source[key]
    }
  }
  return result
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      cachedSettings = deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        parsed as Record<string, unknown>
      ) as unknown as AppSettings
    }
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS }
  }
  return cachedSettings
}

function saveSettings(settings: AppSettings): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
    cachedSettings = settings
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

export function getSettings(): AppSettings {
  return cachedSettings
}

let handlersRegistered = false

export function setupSettingsHandlers(): void {
  loadSettings()

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('settings:get', () => {
    return cachedSettings
  })

  ipcMain.handle('settings:set', (_event, settings: AppSettings) => {
    saveSettings(settings)
  })

  ipcMain.handle('settings:selectDirectory', async () => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Starting Directory'
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}

export function isValidShell(shellPath: string): boolean {
  try {
    return fs.existsSync(shellPath) && fs.statSync(shellPath).isFile()
  } catch {
    return false
  }
}

export function isValidDirectory(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

export function createApplicationMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const openSettings = (): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('menu:openSettings')
    }
  }

  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Settings...',
              accelerator: 'Cmd+,',
              click: openSettings
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'File',
          submenu: [{ role: 'close' }]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        },
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' }
          ]
        }
      ]
    : [
        {
          label: 'File',
          submenu: [
            {
              label: 'Settings...',
              accelerator: 'Ctrl+,',
              click: openSettings
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        }
      ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
