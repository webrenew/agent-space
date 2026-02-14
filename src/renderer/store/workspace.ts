/**
 * Workspace store — tracks the currently opened folder and recent folders.
 *
 * All file-related panels (Explorer, Search, Editor) read from this store
 * to know which directory to operate in.
 */

import { create } from 'zustand'
import { useAgentStore } from './agents'

const MAX_RECENT = 10
const RECENT_KEY = 'agent-space:recentFolders'
const LAST_WORKSPACE_KEY = 'agent-space:lastWorkspaceRoot'
const TEMP_SMOKE_PATTERN = /(?:^|\/)agent-space-smoke-[^/]+(?:\/|$)/

interface WorkspaceStore {
  /** Currently open folder path, or null if none */
  rootPath: string | null

  /** Recently opened folders (most recent first) */
  recentFolders: string[]

  /** Open a folder — sets rootPath and adds to recent list */
  openFolder: (path: string) => void

  /** Close the current folder */
  closeFolder: () => void

  /** Remove a path from the recent list */
  removeRecent: (path: string) => void

  /** Clear all recent folders */
  clearRecent: () => void

  /** Validate persisted startup path and apply defaults when needed */
  initializeStartupWorkspace: () => Promise<void>
}

function normalizePath(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isEphemeralSmokeWorkspace(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (!TEMP_SMOKE_PATTERN.test(normalized)) return false
  return normalized.startsWith('/var/folders/') || normalized.startsWith('/tmp/')
}

async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    const stat = await window.electronAPI.fs.stat(path)
    return stat.isDirectory
  } catch {
    return false
  }
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map((item) => normalizePath(item))
      .filter((item): item is string => Boolean(item))
      .filter((item) => !isEphemeralSmokeWorkspace(item))
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function saveRecent(folders: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(folders.slice(0, MAX_RECENT)))
  } catch (err) {
    console.error('[workspace] Failed to save recent folders:', err)
  }
}

function loadLastWorkspace(): string | null {
  try {
    const value = normalizePath(localStorage.getItem(LAST_WORKSPACE_KEY))
    if (!value) return null
    if (isEphemeralSmokeWorkspace(value)) {
      localStorage.removeItem(LAST_WORKSPACE_KEY)
      return null
    }
    return value
  } catch {
    return null
  }
}

function saveLastWorkspace(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(LAST_WORKSPACE_KEY, path)
    } else {
      localStorage.removeItem(LAST_WORKSPACE_KEY)
    }
  } catch (err) {
    console.error('[workspace] Failed to save last workspace:', err)
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  rootPath: loadLastWorkspace(),
  recentFolders: loadRecent(),

  openFolder: (path: string) => {
    const { recentFolders } = get()
    const updated = [path, ...recentFolders.filter((f) => f !== path)].slice(0, MAX_RECENT)
    saveRecent(updated)
    saveLastWorkspace(path)
    set({ rootPath: path, recentFolders: updated })

    // Keep chat sessions scoped to workspace before the first message,
    // unless the user explicitly chose a custom directory for that chat.
    const { chatSessions, updateChatSession } = useAgentStore.getState()
    for (const session of chatSessions) {
      if (session.agentId) continue
      if (session.directoryMode === 'custom') continue
      if (session.workingDirectory === path && session.directoryMode === 'workspace') continue
      updateChatSession(session.id, {
        workingDirectory: path,
        directoryMode: 'workspace',
      })
    }
  },

  closeFolder: () => {
    saveLastWorkspace(null)
    set({ rootPath: null })

    const { chatSessions, updateChatSession } = useAgentStore.getState()
    for (const session of chatSessions) {
      if (session.agentId) continue
      if (session.directoryMode === 'custom') continue
      if (session.workingDirectory === null) continue
      updateChatSession(session.id, { workingDirectory: null })
    }
  },

  removeRecent: (path: string) => {
    const { recentFolders } = get()
    const updated = recentFolders.filter((f) => f !== path)
    saveRecent(updated)
    set({ recentFolders: updated })
  },

  clearRecent: () => {
    saveRecent([])
    set({ recentFolders: [] })
  },

  initializeStartupWorkspace: async () => {
    const { rootPath, recentFolders, openFolder } = get()
    let needsRecentCleanup = false
    const cleanedRecent = recentFolders.filter((item) => {
      const keep = !isEphemeralSmokeWorkspace(item)
      if (!keep) needsRecentCleanup = true
      return keep
    })
    if (needsRecentCleanup) {
      const trimmed = cleanedRecent.slice(0, MAX_RECENT)
      saveRecent(trimmed)
      set({ recentFolders: trimmed })
    }

    const current = normalizePath(rootPath)
    if (current && !isEphemeralSmokeWorkspace(current) && await isDirectoryPath(current)) {
      return
    }

    if (current) {
      saveLastWorkspace(null)
      set({ rootPath: null })
    }

    try {
      const settings = await window.electronAPI.settings.get()
      const customDefault = normalizePath(settings.general.customDirectory)
      const preferred =
        settings.general.startingDirectory === 'custom' && customDefault
          ? customDefault
          : await window.electronAPI.fs.homeDir()

      const normalizedPreferred = normalizePath(preferred)
      if (!normalizedPreferred || isEphemeralSmokeWorkspace(normalizedPreferred)) return
      if (!await isDirectoryPath(normalizedPreferred)) return
      openFolder(normalizedPreferred)
    } catch (err) {
      console.error('[workspace] Failed to initialize startup workspace:', err)
    }
  },
}))
