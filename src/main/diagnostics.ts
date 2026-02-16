import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

type DiagnosticsLevel = 'info' | 'warn' | 'error'

interface DiagnosticsEntry {
  timestamp: string
  level: DiagnosticsLevel
  event: string
  process: 'main' | 'renderer'
  pid: number
  payload?: Record<string, unknown>
}

interface RendererLogRequest {
  level?: DiagnosticsLevel
  event?: string
  payload?: Record<string, unknown>
}

const LOG_DIR_NAME = 'logs'
const LOG_FILE_NAME = 'app.ndjson'
const ROTATED_FILE_NAME = 'app.previous.ndjson'
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024
let diagnosticsWriteQueue: Promise<void> = Promise.resolve()

function getLogsDirPath(): string {
  try {
    return path.join(app.getPath('userData'), LOG_DIR_NAME)
  } catch {
    return path.join(os.homedir(), '.agent-observer', LOG_DIR_NAME)
  }
}

async function ensureLogDirectory(): Promise<void> {
  const dir = getLogsDirPath()
  await fs.promises.mkdir(dir, { recursive: true })
}

function serializePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined
  try {
    const encoded = JSON.stringify(payload, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack ?? null,
        }
      }
      return value
    })
    return JSON.parse(encoded) as Record<string, unknown>
  } catch (err) {
    return {
      payloadSerializationError: err instanceof Error ? err.message : String(err),
    }
  }
}

function enqueueDiagnosticsWrite(task: () => Promise<void>): void {
  diagnosticsWriteQueue = diagnosticsWriteQueue
    .then(task)
    .catch((err) => {
      console.error('[diagnostics] Failed to append diagnostics log:', err)
    })
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(
    err
    && typeof err === 'object'
    && 'code' in err
    && (err as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function rotateLogsIfNeeded(logPath: string): Promise<void> {
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(logPath)
  } catch (err) {
    if (isMissingFileError(err)) return
    throw err
  }

  if (stat.size <= MAX_LOG_FILE_BYTES) return

  const rotatedPath = path.join(getLogsDirPath(), ROTATED_FILE_NAME)
  try {
    await fs.promises.rm(rotatedPath, { force: true })
  } catch {
    // ignore rotate cleanup failures
  }
  await fs.promises.rename(logPath, rotatedPath)
}

function appendDiagnostics(entry: DiagnosticsEntry): void {
  const line = `${JSON.stringify(entry)}\n`
  enqueueDiagnosticsWrite(async () => {
    await ensureLogDirectory()
    const logPath = getDiagnosticsLogPath()
    await rotateLogsIfNeeded(logPath)
    await fs.promises.appendFile(logPath, line, 'utf-8')
  })
}

function normalizeRendererRequest(
  event: IpcMainInvokeEvent,
  request: RendererLogRequest
): DiagnosticsEntry {
  const level = request.level === 'warn' || request.level === 'error' ? request.level : 'info'
  const eventName = typeof request.event === 'string' && request.event.trim().length > 0
    ? request.event
    : 'renderer.unknown'
  const payload = serializePayload(request.payload)

  return {
    timestamp: new Date().toISOString(),
    level,
    event: eventName,
    process: 'renderer',
    pid: process.pid,
    payload: {
      ...(payload ?? {}),
      webContentsId: event.sender.id,
      frameUrl: event.senderFrame?.url ?? null,
    },
  }
}

export function getDiagnosticsLogPath(): string {
  return path.join(getLogsDirPath(), LOG_FILE_NAME)
}

export function logMainEvent(
  event: string,
  payload?: Record<string, unknown>,
  level: DiagnosticsLevel = 'info'
): void {
  appendDiagnostics({
    timestamp: new Date().toISOString(),
    level,
    event,
    process: 'main',
    pid: process.pid,
    payload: serializePayload(payload),
  })
}

export function logMainError(source: string, error: unknown, extra?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    source,
    ...(extra ?? {}),
  }
  if (error instanceof Error) {
    payload.errorName = error.name
    payload.errorMessage = error.message
    payload.errorStack = error.stack ?? null
  } else {
    payload.errorName = 'NonError'
    payload.errorMessage = String(error)
    payload.errorStack = null
  }
  logMainEvent('main.exception', payload, 'error')
}

let diagnosticsHandlersRegistered = false
export function setupDiagnosticsHandlers(): void {
  if (diagnosticsHandlersRegistered) return
  diagnosticsHandlersRegistered = true

  ipcMain.handle('diagnostics:logRenderer', (event, request: RendererLogRequest | undefined) => {
    appendDiagnostics(normalizeRendererRequest(event, request ?? {}))
  })

  ipcMain.handle('diagnostics:getLogPath', () => getDiagnosticsLogPath())
}
