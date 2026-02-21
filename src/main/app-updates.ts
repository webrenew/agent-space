import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC_CHANNELS, type AppUpdateStatusResult } from '../shared/electron-api'

const RELEASE_API_URL = 'https://api.github.com/repos/webrenew/agent-observer/releases/latest'
const RELEASE_FALLBACK_URL = 'https://github.com/webrenew/agent-observer/releases/latest'
const GITHUB_OWNER = 'webrenew'
const GITHUB_REPO = 'agent-observer'
const UPDATE_CHECK_TIMEOUT_MS = 7_000
const UPDATE_CHECK_CACHE_MS = 30 * 60 * 1_000
const PACKAGED_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000

let handlersRegistered = false
let cachedStatus: AppUpdateStatusResult | null = null
let cacheTimestampMs = 0
let pendingStatusPromise: Promise<AppUpdateStatusResult> | null = null
let liveStatus: AppUpdateStatusResult = baseStatus(getAppVersion())
let updaterInitialized = false
let updaterCheckPromise: Promise<void> | null = null
let lastPackagedUpdateCheckStartedAtMs = 0
let periodicPackagedUpdateCheckTimer: ReturnType<typeof setInterval> | null = null

function getAppVersion(): string {
  try {
    return typeof app?.getVersion === 'function' ? app.getVersion() : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function parseSemverTriplet(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(version.trim())
  if (!match) return null

  const major = Number.parseInt(match[1] ?? '', 10)
  const minor = Number.parseInt(match[2] ?? '', 10)
  const patch = Number.parseInt(match[3] ?? '', 10)
  if (![major, minor, patch].every((value) => Number.isFinite(value))) return null
  return [major, minor, patch]
}

export function __testOnlyCompareSemver(left: string, right: string): number {
  const leftParts = parseSemverTriplet(left)
  const rightParts = parseSemverTriplet(right)
  if (!leftParts || !rightParts) return 0

  if (leftParts[0] !== rightParts[0]) return leftParts[0] - rightParts[0]
  if (leftParts[1] !== rightParts[1]) return leftParts[1] - rightParts[1]
  return leftParts[2] - rightParts[2]
}

export function __testOnlyIsUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
  return __testOnlyCompareSemver(latestVersion, currentVersion) > 0
}

export function __testOnlyShouldStartPackagedUpdateCheck(
  nowMs: number,
  lastCheckStartedAtMs: number,
  checkIntervalMs: number
): boolean {
  return (nowMs - lastCheckStartedAtMs) >= checkIntervalMs
}

function baseStatus(currentVersion: string): AppUpdateStatusResult {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: RELEASE_FALLBACK_URL,
    checkedAt: Date.now(),
    error: null,
    phase: 'idle',
    downloadPercent: null,
    canInstall: false,
  }
}

function publishStatus(patch: Partial<AppUpdateStatusResult>): AppUpdateStatusResult {
  liveStatus = {
    ...liveStatus,
    ...patch,
    checkedAt: patch.checkedAt ?? Date.now(),
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC_CHANNELS.updates.status, liveStatus)
  }
  return liveStatus
}

function pickVersion(info: UpdateInfo | null | undefined): string | null {
  if (!info) return null
  const version = typeof info.version === 'string' ? info.version.trim() : ''
  if (version.length > 0) return version
  const releaseName = typeof info.releaseName === 'string' ? info.releaseName.trim() : ''
  return releaseName.length > 0 ? releaseName : null
}

function setStatusFromUpdateInfo(
  info: UpdateInfo | null | undefined,
  patch: Partial<AppUpdateStatusResult>
): AppUpdateStatusResult {
  const latestVersion = pickVersion(info)
  return publishStatus({
    latestVersion: latestVersion ?? liveStatus.latestVersion,
    releaseUrl: RELEASE_FALLBACK_URL,
    ...patch,
  })
}

async function fetchLatestRelease(): Promise<{ latestVersion: string; releaseUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `agent-observer/${app.getVersion()}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Update check failed with status ${response.status}`)
    }

    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof payload.tag_name !== 'string' || payload.tag_name.trim().length === 0) {
      throw new Error('Release payload missing tag_name')
    }

    const releaseUrl = typeof payload.html_url === 'string' && payload.html_url.startsWith('http')
      ? payload.html_url
      : RELEASE_FALLBACK_URL

    return {
      latestVersion: payload.tag_name.trim(),
      releaseUrl,
    }
  } finally {
    clearTimeout(timer)
  }
}

function normalizeUpdateError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Update check timed out'
  }
  if (err instanceof Error) return err.message
  return String(err)
}

async function checkForUpdates(): Promise<AppUpdateStatusResult> {
  const currentVersion = getAppVersion()
  const fallback = baseStatus(currentVersion)

  try {
    const latest = await fetchLatestRelease()
    return {
      ...fallback,
      latestVersion: latest.latestVersion,
      releaseUrl: latest.releaseUrl,
      updateAvailable: __testOnlyIsUpdateAvailable(currentVersion, latest.latestVersion),
      checkedAt: Date.now(),
      phase: __testOnlyIsUpdateAvailable(currentVersion, latest.latestVersion) ? 'available' : 'idle',
    }
  } catch (err) {
    return {
      ...fallback,
      error: normalizeUpdateError(err),
      checkedAt: Date.now(),
      phase: 'error',
    }
  }
}

async function resolveFallbackUpdateStatus(): Promise<AppUpdateStatusResult> {
  const now = Date.now()
  if (cachedStatus && (now - cacheTimestampMs) < UPDATE_CHECK_CACHE_MS) {
    return cachedStatus
  }

  if (pendingStatusPromise) return pendingStatusPromise

  pendingStatusPromise = checkForUpdates()
    .then((status) => {
      cachedStatus = status
      cacheTimestampMs = Date.now()
      return status
    })
    .finally(() => {
      pendingStatusPromise = null
    })

  return pendingStatusPromise
}

function initializeAutoUpdaterIfNeeded(): void {
  if (updaterInitialized) return
  updaterInitialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
  })

  autoUpdater.on('checking-for-update', () => {
    publishStatus({
      phase: 'checking',
      error: null,
      canInstall: false,
      downloadPercent: null,
    })
  })

  autoUpdater.on('update-available', (info) => {
    setStatusFromUpdateInfo(info, {
      phase: 'downloading',
      updateAvailable: true,
      error: null,
      canInstall: false,
      downloadPercent: 0,
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    publishStatus({
      phase: 'downloading',
      updateAvailable: true,
      error: null,
      canInstall: false,
      downloadPercent: Number.isFinite(progress.percent) ? progress.percent : null,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatusFromUpdateInfo(info, {
      phase: 'downloaded',
      updateAvailable: true,
      error: null,
      canInstall: true,
      downloadPercent: 100,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setStatusFromUpdateInfo(info, {
      phase: 'idle',
      updateAvailable: false,
      error: null,
      canInstall: false,
      downloadPercent: null,
    })
  })

  autoUpdater.on('error', (err) => {
    publishStatus({
      phase: 'error',
      error: normalizeUpdateError(err),
      canInstall: false,
      downloadPercent: null,
    })
  })

  if (!periodicPackagedUpdateCheckTimer) {
    periodicPackagedUpdateCheckTimer = setInterval(() => {
      ensureAutoUpdaterCheckStarted()
    }, PACKAGED_UPDATE_CHECK_INTERVAL_MS)
    periodicPackagedUpdateCheckTimer.unref?.()
  }
}

function ensureAutoUpdaterCheckStarted(options?: { force?: boolean }): void {
  if (updaterCheckPromise) return
  const now = Date.now()
  if (
    !options?.force
    && !__testOnlyShouldStartPackagedUpdateCheck(
      now,
      lastPackagedUpdateCheckStartedAtMs,
      PACKAGED_UPDATE_CHECK_INTERVAL_MS
    )
  ) return
  lastPackagedUpdateCheckStartedAtMs = now
  updaterCheckPromise = autoUpdater.checkForUpdates()
    .then((result) => {
      if (!result?.updateInfo) {
        publishStatus({
          phase: 'idle',
          updateAvailable: false,
          canInstall: false,
        })
        return
      }
      const hasUpdate = __testOnlyIsUpdateAvailable(
        getAppVersion(),
        pickVersion(result.updateInfo) ?? getAppVersion()
      )
      if (!hasUpdate) {
        setStatusFromUpdateInfo(result.updateInfo, {
          phase: 'idle',
          updateAvailable: false,
          error: null,
          canInstall: false,
          downloadPercent: null,
        })
      }
    })
    .catch((err) => {
      publishStatus({
        phase: 'error',
        error: normalizeUpdateError(err),
        canInstall: false,
      })
    })
    .finally(() => {
      updaterCheckPromise = null
    })
}

async function resolveUpdateStatus(): Promise<AppUpdateStatusResult> {
  if (app.isPackaged) {
    initializeAutoUpdaterIfNeeded()
    ensureAutoUpdaterCheckStarted()
    return liveStatus
  }

  const fallback = await resolveFallbackUpdateStatus()
  liveStatus = fallback
  return fallback
}

export function setupUpdateHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle(IPC_CHANNELS.updates.getStatus, async () => {
    return resolveUpdateStatus()
  })

  ipcMain.handle(IPC_CHANNELS.updates.installAndRestart, async () => {
    if (!app.isPackaged || !liveStatus.canInstall) return false
    try {
      autoUpdater.quitAndInstall(false, true)
      return true
    } catch (err) {
      publishStatus({
        phase: 'error',
        error: normalizeUpdateError(err),
        canInstall: false,
      })
      return false
    }
  })

  if (app.isPackaged) {
    initializeAutoUpdaterIfNeeded()
    ensureAutoUpdaterCheckStarted({ force: true })
  }
}
