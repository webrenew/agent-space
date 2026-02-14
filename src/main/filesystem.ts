import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import os from 'os'

// ── Types ────────────────────────────────────────────────────────────

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

interface SearchResult {
  path: string
  name: string
  isDirectory: boolean
}

// ── Ignored patterns ─────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.turbo', '__pycache__', '.venv', 'venv', '.tox',
  'target', '.gradle', '.idea', '.vscode', '.DS_Store',
  'coverage', '.nyc_output', '.parcel-cache', '.svelte-kit',
  'release', '.electron',
])

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

function shouldIgnore(name: string, isDir: boolean): boolean {
  if (isDir) return IGNORED_DIRS.has(name)
  return IGNORED_FILES.has(name) || name.startsWith('.')
}

// ── Read directory ───────────────────────────────────────────────────

async function readDirectory(dirPath: string, showHidden: boolean): Promise<FileEntry[]> {
  const resolved = path.resolve(dirPath)
  const entries = await fs.promises.readdir(resolved, { withFileTypes: true })

  const results: FileEntry[] = []
  for (const entry of entries) {
    if (!showHidden && shouldIgnore(entry.name, entry.isDirectory())) continue

    const fullPath = path.join(resolved, entry.name)
    try {
      const stat = await fs.promises.stat(fullPath)
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size: stat.size,
        modified: stat.mtimeMs,
      })
    } catch {
      // Skip files we can't stat (broken symlinks, permissions, etc.)
      continue
    }
  }

  // Sort: directories first, then alphabetical (case-insensitive)
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return results
}

// ── Read file content ────────────────────────────────────────────────

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB limit for preview

async function readFileContent(filePath: string): Promise<{ content: string; truncated: boolean; size: number }> {
  const resolved = path.resolve(filePath)
  const stat = await fs.promises.stat(resolved)

  if (stat.size > MAX_FILE_SIZE) {
    const buffer = Buffer.alloc(MAX_FILE_SIZE)
    const fd = await fs.promises.open(resolved, 'r')
    try {
      await fd.read(buffer, 0, MAX_FILE_SIZE, 0)
      return { content: buffer.toString('utf-8'), truncated: true, size: stat.size }
    } finally {
      await fd.close()
    }
  }

  const content = await fs.promises.readFile(resolved, 'utf-8')
  return { content, truncated: false, size: stat.size }
}

// ── Fuzzy file search ────────────────────────────────────────────────

async function searchFiles(rootDir: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const resolved = path.resolve(rootDir)

  // Try using `find` for speed, fall back to manual walk
  return new Promise((resolve) => {
    const args = [resolved, '-type', 'f', '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*', '-not', '-path', '*/dist/*',
      '-not', '-path', '*/.next/*', '-not', '-path', '*/out/*',
      '-not', '-path', '*/build/*', '-not', '-path', '*/release/*',
      '-not', '-path', '*/.cache/*',
    ]

    execFile('find', args, { maxBuffer: 5 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err) {
        // Fallback: return empty on error
        console.error('[filesystem] find command failed:', err.message)
        resolve([])
        return
      }

      const lowerQuery = query.toLowerCase()
      const lines = stdout.split('\n').filter(Boolean)
      const matches: Array<{ path: string; name: string; isDirectory: boolean; score: number }> = []

      for (const line of lines) {
        const name = path.basename(line)
        const relPath = path.relative(resolved, line)
        const score = fuzzyScore(name.toLowerCase(), relPath.toLowerCase(), lowerQuery)
        if (score > 0) {
          matches.push({ path: line, name, isDirectory: false, score })
        }
      }

      matches.sort((a, b) => b.score - a.score)
      resolve(matches.slice(0, maxResults).map(({ path: p, name, isDirectory }) => ({
        path: p, name, isDirectory,
      })))
    })
  })
}

/** Simple fuzzy scoring: exact filename match > filename contains > path contains */
function fuzzyScore(nameLower: string, relPathLower: string, queryLower: string): number {
  if (nameLower === queryLower) return 100
  if (nameLower.startsWith(queryLower)) return 80
  if (nameLower.includes(queryLower)) return 60

  // Check if all chars appear in order (fuzzy match on filename)
  let qi = 0
  for (let i = 0; i < nameLower.length && qi < queryLower.length; i++) {
    if (nameLower[i] === queryLower[qi]) qi++
  }
  if (qi === queryLower.length) return 40

  // Check path
  if (relPathLower.includes(queryLower)) return 20

  // Fuzzy on full path
  qi = 0
  for (let i = 0; i < relPathLower.length && qi < queryLower.length; i++) {
    if (relPathLower[i] === queryLower[qi]) qi++
  }
  if (qi === queryLower.length) return 10

  return 0
}

// ── Setup IPC handlers ───────────────────────────────────────────────

let handlersRegistered = false
let dialogParentWindow: BrowserWindow | null = null

function getDialogParentWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  if (dialogParentWindow && !dialogParentWindow.isDestroyed()) return dialogParentWindow
  return undefined
}

export function setupFilesystemHandlers(mainWindow?: BrowserWindow): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialogParentWindow = mainWindow
  }

  if (handlersRegistered) return
  handlersRegistered = true

  // Native "Open Folder" dialog — returns selected path or null
  ipcMain.handle('fs:openFolderDialog', async () => {
    const win = getDialogParentWindow()
    try {
      const dialogOpts = {
        properties: ['openDirectory' as const],
        title: 'Open Folder',
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (err) {
      console.error('[filesystem] openFolderDialog error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:readDir', async (_event, dirPath: string, showHidden?: boolean) => {
    try {
      return await readDirectory(dirPath, showHidden ?? false)
    } catch (err) {
      console.error('[filesystem] readDir error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return await readFileContent(filePath)
    } catch (err) {
      console.error('[filesystem] readFile error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:search', async (_event, rootDir: string, query: string, maxResults?: number) => {
    try {
      return await searchFiles(rootDir, query, maxResults ?? 50)
    } catch (err) {
      console.error('[filesystem] search error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:homeDir', () => {
    return os.homedir()
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const resolved = path.resolve(filePath)
      await fs.promises.writeFile(resolved, content, 'utf-8')
    } catch (err) {
      console.error('[filesystem] writeFile error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    try {
      const stat = await fs.promises.stat(filePath)
      return {
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        size: stat.size,
        modified: stat.mtimeMs,
      }
    } catch (err) {
      console.error('[filesystem] stat error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newName: string) => {
    try {
      // Validate newName — no path separators or null bytes
      if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
        throw new Error('Invalid filename: must not contain path separators')
      }
      const resolved = path.resolve(oldPath)
      const dir = path.dirname(resolved)
      const newPath = path.join(dir, newName)
      await fs.promises.rename(resolved, newPath)
      return { newPath }
    } catch (err) {
      console.error('[filesystem] rename error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:delete', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath)
      const stat = await fs.promises.stat(resolved)
      if (stat.isDirectory()) {
        await fs.promises.rm(resolved, { recursive: true })
      } else {
        await fs.promises.unlink(resolved)
      }
    } catch (err) {
      console.error('[filesystem] delete error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:revealInFinder', async (_event, filePath: string) => {
    try {
      shell.showItemInFolder(path.resolve(filePath))
    } catch (err) {
      console.error('[filesystem] revealInFinder error:', err)
      throw err
    }
  })

  ipcMain.handle('fs:openInTerminal', async (_event, dirPath: string) => {
    try {
      const resolved = path.resolve(dirPath)
      const stat = await fs.promises.stat(resolved)
      if (!stat.isDirectory()) {
        throw new Error('Path is not a directory')
      }
      if (process.platform === 'darwin') {
        const child = spawn('open', ['-a', 'Terminal', resolved], { detached: true, stdio: 'ignore' })
        child.unref()
      }
    } catch (err) {
      console.error('[filesystem] openInTerminal error:', err)
      throw err
    }
  })
}
