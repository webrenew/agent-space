import { app, ipcMain, dialog, Menu, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AppSettings } from '../renderer/types'

const DEFAULT_LOCAL_DEV_DIRECTORY = path.join(os.homedir(), 'dev')

const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startingDirectory: 'custom',
    customDirectory: DEFAULT_LOCAL_DEV_DIRECTORY,
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
  subscription: {
    type: 'api',
    monthlyCost: 0,
  },
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

const SETTINGS_DIR = path.join(os.homedir(), '.agent-space')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

let cachedSettings: AppSettings = { ...DEFAULT_SETTINGS }

function normalizeStartingDirectory(settings: AppSettings): { settings: AppSettings; changed: boolean } {
  const customDirectory = settings.general.customDirectory?.trim() ?? ''
  const shouldUseDevDefault =
    settings.general.startingDirectory === 'home' &&
    customDirectory.length === 0

  if (!shouldUseDevDefault) {
    return { settings, changed: false }
  }

  return {
    changed: true,
    settings: {
      ...settings,
      general: {
        ...settings.general,
        startingDirectory: 'custom',
        customDirectory: DEFAULT_LOCAL_DEV_DIRECTORY,
      },
    },
  }
}

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

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      const merged = deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        parsed as Record<string, unknown>
      ) as unknown as AppSettings

      const normalized = normalizeStartingDirectory(merged)
      cachedSettings = normalized.settings
      if (normalized.changed) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cachedSettings, null, 2), 'utf-8')
      }
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS }
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
  const mod = isMac ? 'Cmd' : 'Ctrl'

  const send = (channel: string): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel)
    }
  }

  const sendWithData = (channel: string, data: string): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  const openSettings = (): void => send('menu:openSettings')
  const openHelp = (): void => send('menu:openHelp')
  const newTerminal = (): void => send('menu:newTerminal')
  const focusChat = (): void => send('menu:focusChat')
  const resetLayout = (): void => send('menu:resetLayout')

  const openFolderDialog = async (): Promise<void> => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Open Folder',
      })
      if (!result.canceled && result.filePaths.length > 0) {
        sendWithData('fs:openFolder', result.filePaths[0])
      }
    } catch (err) {
      console.error('[settings] openFolderDialog error:', err)
    }
  }

  /** Panel focus items (Cmd/Ctrl+1 through 8) */
  const panelItems: Electron.MenuItemConstructorOptions[] = [
    { label: 'Chat', accelerator: `${mod}+1`, click: () => send('menu:focusPanel:chat') },
    { label: 'Terminal', accelerator: `${mod}+2`, click: () => send('menu:focusPanel:terminal') },
    { label: 'Tokens', accelerator: `${mod}+3`, click: () => send('menu:focusPanel:tokens') },
    { label: 'Office', accelerator: `${mod}+4`, click: () => send('menu:focusPanel:scene3d') },
    { label: 'Activity', accelerator: `${mod}+5`, click: () => send('menu:focusPanel:activity') },
    { label: 'Memory Graph', accelerator: `${mod}+6`, click: () => send('menu:focusPanel:memoryGraph') },
    { label: 'Agents', accelerator: `${mod}+7`, click: () => send('menu:focusPanel:agents') },
    { label: 'Recent', accelerator: `${mod}+8`, click: () => send('menu:focusPanel:recentMemories') },
    { type: 'separator' },
    { label: 'Search Files', accelerator: `${mod}+P`, click: () => send('menu:focusPanel:fileSearch') },
    { label: 'File Explorer', accelerator: `${mod}+Shift+E`, click: () => send('menu:focusPanel:fileExplorer') },
  ]

  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Settings...', accelerator: 'Cmd+,', click: openSettings },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: 'File',
          submenu: [
            { label: 'Open Folder...', accelerator: 'Cmd+O', click: () => void openFolderDialog() },
            { type: 'separator' },
            { label: 'New Terminal', accelerator: 'Cmd+Shift+N', click: newTerminal },
            { type: 'separator' },
            { role: 'close' },
          ],
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
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { label: 'Focus Chat Input', accelerator: 'Cmd+/', click: focusChat },
            { type: 'separator' },
            ...panelItems,
            { type: 'separator' },
            { label: 'Reset Layout', accelerator: 'Cmd+Shift+R', click: resetLayout },
            { type: 'separator' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' },
          ],
        },
        {
          label: 'Help',
          submenu: [
            { label: 'Keyboard Shortcuts & Legend', accelerator: 'F1', click: openHelp },
          ],
        },
      ]
    : [
        {
          label: 'File',
          submenu: [
            { label: 'Open Folder...', accelerator: 'Ctrl+O', click: () => void openFolderDialog() },
            { type: 'separator' },
            { label: 'New Terminal', accelerator: 'Ctrl+Shift+N', click: newTerminal },
            { label: 'Settings...', accelerator: 'Ctrl+,', click: openSettings },
            { type: 'separator' },
            { role: 'quit' },
          ],
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
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { label: 'Focus Chat Input', accelerator: 'Ctrl+/', click: focusChat },
            { type: 'separator' },
            ...panelItems,
            { type: 'separator' },
            { label: 'Reset Layout', accelerator: 'Ctrl+Shift+R', click: resetLayout },
            { type: 'separator' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        {
          label: 'Help',
          submenu: [
            { label: 'Keyboard Shortcuts & Legend', accelerator: 'F1', click: openHelp },
          ],
        },
      ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
