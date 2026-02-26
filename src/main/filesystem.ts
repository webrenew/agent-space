import { ipcMain, dialog, BrowserWindow, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  invalidateSearchIndexForPath,
  searchFiles,
  shouldIgnoreFilesystemEntry,
} from './filesystem-search-service'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB limit for preview
const MAX_IMAGE_PREVIEW_SIZE = 25 * 1024 * 1024 // 25MB limit for in-app image preview
const MAX_DATA_URL_PREVIEW_SIZE = 25 * 1024 * 1024 // 25MB limit for in-app media preview

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
}

async function readDirectory(dirPath: string, showHidden: boolean): Promise<FileEntry[]> {
  const resolved = path.resolve(dirPath)
  const entries = await fs.promises.readdir(resolved, { withFileTypes: true })

  const visible = entries.filter(
    (entry) => showHidden || !shouldIgnoreFilesystemEntry(entry.name, entry.isDirectory())
  )

  const settled = await Promise.allSettled(
    visible.map(async (entry) => {
      const fullPath = path.join(resolved, entry.name)
      const stat = await fs.promises.stat(fullPath)
      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size: stat.size,
        modified: stat.mtimeMs,
      } satisfies FileEntry
    })
  )

  const results: FileEntry[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
    }
    // Skip files we can't stat (broken symlinks, permissions, etc.)
  }

  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return results
}

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

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function decodeDataUrlPayload(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match) {
    throw new Error('Invalid data URL payload')
  }

  const mimeType = match[1]
  const base64Payload = match[2]
  const bytes = Buffer.from(base64Payload, 'base64')
  if (bytes.length === 0 && base64Payload.length > 0) {
    throw new Error('Invalid base64 payload')
  }

  return { mimeType, bytes }
}

export function __testOnlyDecodeDataUrlPayload(dataUrl: string): { mimeType: string; size: number } {
  const decoded = decodeDataUrlPayload(dataUrl)
  return {
    mimeType: decoded.mimeType,
    size: decoded.bytes.length,
  }
}

async function readFileAsDataUrl(
  filePath: string,
  maxSize = MAX_DATA_URL_PREVIEW_SIZE
): Promise<{ dataUrl: string; size: number; mimeType: string }> {
  const resolved = path.resolve(filePath)
  const stat = await fs.promises.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('Path is not a file')
  }
  if (stat.size > maxSize) {
    throw new Error(`Preview exceeds ${(maxSize / (1024 * 1024)).toFixed(0)}MB limit`)
  }
  const buffer = await fs.promises.readFile(resolved)
  const mimeType = detectMimeType(resolved)
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    size: stat.size,
    mimeType,
  }
}

async function writeDataUrlContent(filePath: string, dataUrl: string): Promise<{ size: number; mimeType: string }> {
  const resolved = path.resolve(filePath)
  const { mimeType, bytes } = decodeDataUrlPayload(dataUrl)
  await fs.promises.writeFile(resolved, bytes)
  invalidateSearchIndexForPath(resolved)
  return {
    size: bytes.length,
    mimeType,
  }
}

async function readImageAsDataUrl(filePath: string): Promise<{ dataUrl: string; size: number; mimeType: string }> {
  const result = await readFileAsDataUrl(filePath, MAX_IMAGE_PREVIEW_SIZE)
  if (!result.mimeType.startsWith('image/')) {
    throw new Error('File is not an image')
  }
  return result
}

let handlersRegistered = false
let dialogParentWindow: BrowserWindow | null = null
let pendingOpenFolderDialog: Promise<string | null> | null = null

function getDialogParentWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  if (dialogParentWindow && !dialogParentWindow.isDestroyed()) return dialogParentWindow
  return undefined
}

function handleFilesystemIpc<TArgs extends unknown[], TResult>(
  channel: string,
  operation: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, ...rawArgs) => {
    try {
      return await handler(event, ...(rawArgs as TArgs))
    } catch (err) {
      console.error(`[filesystem] ${operation} error:`, err)
      throw err
    }
  })
}

export function setupFilesystemHandlers(mainWindow?: BrowserWindow): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialogParentWindow = mainWindow
  }

  if (handlersRegistered) return
  handlersRegistered = true

  handleFilesystemIpc('fs:openFolderDialog', 'openFolderDialog', async () => {
    if (pendingOpenFolderDialog) {
      return pendingOpenFolderDialog
    }

    pendingOpenFolderDialog = (async () => {
      const win = getDialogParentWindow()
      const dialogOpts = {
        properties: ['openDirectory' as const],
        title: 'Open Folder',
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })().finally(() => {
      pendingOpenFolderDialog = null
    })

    return pendingOpenFolderDialog
  })

  handleFilesystemIpc('fs:readDir', 'readDir', async (_event, dirPath: string, showHidden?: boolean) => {
    return readDirectory(dirPath, showHidden ?? false)
  })

  handleFilesystemIpc('fs:readFile', 'readFile', async (_event, filePath: string) => {
    return readFileContent(filePath)
  })

  handleFilesystemIpc('fs:readImageDataUrl', 'readImageDataUrl', async (_event, filePath: string) => {
    return readImageAsDataUrl(filePath)
  })

  handleFilesystemIpc('fs:readDataUrl', 'readDataUrl', async (_event, filePath: string) => {
    return readFileAsDataUrl(filePath)
  })

  handleFilesystemIpc('fs:search', 'search', async (_event, rootDir: string, query: string, maxResults?: number) => {
    return searchFiles(rootDir, query, maxResults ?? 50)
  })

  handleFilesystemIpc('fs:homeDir', 'homeDir', () => {
    return os.homedir()
  })

  handleFilesystemIpc('fs:writeFile', 'writeFile', async (_event, filePath: string, content: string) => {
    const resolved = path.resolve(filePath)
    await fs.promises.writeFile(resolved, content, 'utf-8')
    invalidateSearchIndexForPath(resolved)
  })

  handleFilesystemIpc('fs:writeDataUrl', 'writeDataUrl', async (_event, filePath: string, dataUrl: string) => {
    return writeDataUrlContent(filePath, dataUrl)
  })

  handleFilesystemIpc('fs:stat', 'stat', async (_event, filePath: string) => {
    const resolved = path.resolve(filePath)
    const stat = await fs.promises.stat(resolved)
    return {
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      size: stat.size,
      modified: stat.mtimeMs,
    }
  })

  handleFilesystemIpc('fs:rename', 'rename', async (_event, oldPath: string, newName: string) => {
    if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
      throw new Error('Invalid filename: must not contain path separators')
    }
    const resolved = path.resolve(oldPath)
    const dir = path.dirname(resolved)
    const newPath = path.join(dir, newName)
    await fs.promises.rename(resolved, newPath)
    invalidateSearchIndexForPath(resolved)
    invalidateSearchIndexForPath(newPath)
    return { newPath }
  })

  handleFilesystemIpc('fs:delete', 'delete', async (_event, filePath: string) => {
    const resolved = path.resolve(filePath)
    const stat = await fs.promises.stat(resolved)
    if (stat.isDirectory()) {
      await fs.promises.rm(resolved, { recursive: true })
    } else {
      await fs.promises.unlink(resolved)
    }
    invalidateSearchIndexForPath(resolved)
  })

  handleFilesystemIpc('fs:revealInFinder', 'revealInFinder', async (_event, filePath: string) => {
    shell.showItemInFolder(path.resolve(filePath))
  })

  handleFilesystemIpc('fs:openInTerminal', 'openInTerminal', async (_event, dirPath: string) => {
    const resolved = path.resolve(dirPath)
    const stat = await fs.promises.stat(resolved)
    if (!stat.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const errMsg = await shell.openPath(resolved)
    if (errMsg) {
      throw new Error(errMsg)
    }
  })
}
