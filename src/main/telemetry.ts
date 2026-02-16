import fs from 'fs'
import os from 'os'
import path from 'path'
import { getSettings } from './settings'

interface TelemetryEntry {
  timestamp: string
  type: string
  payload?: Record<string, unknown>
}

const TELEMETRY_DIR = path.join(os.homedir(), '.agent-observer')
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'telemetry.ndjson')
const STARTUP_BREADCRUMB_LIMIT = 200

const pendingStartupBreadcrumbs: TelemetryEntry[] = []
const recentStartupBreadcrumbs: TelemetryEntry[] = []
let telemetryWriteQueue: Promise<void> = Promise.resolve()

function telemetryEnabled(): boolean {
  try {
    return Boolean(getSettings().telemetry?.enabled)
  } catch {
    return false
  }
}

function enqueueTelemetryWrite(task: () => Promise<void>): void {
  telemetryWriteQueue = telemetryWriteQueue
    .then(task)
    .catch((err) => {
      console.error('[telemetry] Failed to append telemetry entry:', err)
    })
}

function appendEntry(entry: TelemetryEntry): void {
  const line = `${JSON.stringify(entry)}\n`
  enqueueTelemetryWrite(async () => {
    await fs.promises.mkdir(TELEMETRY_DIR, { recursive: true })
    await fs.promises.appendFile(TELEMETRY_FILE, line, 'utf-8')
  })
}

function toErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    }
  }
  return {
    name: 'NonError',
    message: String(error),
    stack: null,
  }
}

function rememberStartupBreadcrumb(entry: TelemetryEntry): void {
  recentStartupBreadcrumbs.push(entry)
  if (recentStartupBreadcrumbs.length > STARTUP_BREADCRUMB_LIMIT) {
    recentStartupBreadcrumbs.shift()
  }
}

export function flushStartupBreadcrumbs(): void {
  if (!telemetryEnabled() || pendingStartupBreadcrumbs.length === 0) return
  for (const entry of pendingStartupBreadcrumbs) {
    appendEntry(entry)
  }
  pendingStartupBreadcrumbs.length = 0
}

export function addStartupBreadcrumb(step: string, payload?: Record<string, unknown>): void {
  const entry: TelemetryEntry = {
    timestamp: new Date().toISOString(),
    type: 'startup.breadcrumb',
    payload: {
      step,
      ...(payload ?? {}),
    },
  }

  rememberStartupBreadcrumb(entry)

  if (!telemetryEnabled()) {
    pendingStartupBreadcrumbs.push(entry)
    if (pendingStartupBreadcrumbs.length > STARTUP_BREADCRUMB_LIMIT) {
      pendingStartupBreadcrumbs.shift()
    }
    return
  }

  flushStartupBreadcrumbs()
  appendEntry(entry)
}

export function recordTelemetryEvent(type: string, payload?: Record<string, unknown>): void {
  if (!telemetryEnabled()) return
  flushStartupBreadcrumbs()
  appendEntry({
    timestamp: new Date().toISOString(),
    type,
    payload,
  })
}

export function recordException(
  source: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  recordTelemetryEvent('process.exception', {
    source,
    ...toErrorPayload(error),
    ...(extra ?? {}),
    startupBreadcrumbs: recentStartupBreadcrumbs.slice(-30).map((entry) => ({
      timestamp: entry.timestamp,
      step: entry.payload?.step ?? null,
    })),
  })
}

export function recordIpcRegistrationError(channel: string, error: unknown): void {
  recordTelemetryEvent('ipc.registration_error', {
    channel,
    ...toErrorPayload(error),
  })
}

export function recordIpcRuntimeError(channel: string, error: unknown): void {
  recordTelemetryEvent('ipc.runtime_error', {
    channel,
    ...toErrorPayload(error),
  })
}

export function getTelemetryLogPath(): string {
  return TELEMETRY_FILE
}
