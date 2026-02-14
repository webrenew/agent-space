import type {
  ClaudeProfilesConfig,
  PluginHookEvent,
  PluginHookEventPayloadMap,
  PluginHookHandler,
} from '../types'
import { logRendererEvent } from '../lib/diagnostics'
import { registerDiagnosticsHooks } from './builtins/diagnosticsHooks'

interface RegisteredHook<E extends PluginHookEvent = PluginHookEvent> {
  id: string
  event: E
  pluginId: string
  order: number
  handler: PluginHookHandler<E>
}

type HooksByEvent = {
  [E in PluginHookEvent]: RegisteredHook<E>[]
}

export interface RuntimeDiscoveredPlugin {
  id: string
  name: string
  version: string
  description: string | null
  rootDir: string
  manifestPath: string
  source: 'agent-space.plugin.json' | 'openclaw.plugin.json' | 'package.json'
  rendererEntry: string | null
}

export interface PluginCatalogSnapshot {
  directories: string[]
  plugins: RuntimeDiscoveredPlugin[]
  warnings: string[]
  syncedAt: number
}

const hooksByEvent: HooksByEvent = {
  session_start: [],
  session_end: [],
  message_received: [],
  message_sent: [],
  before_tool_call: [],
  after_tool_call: [],
}

const pluginCatalogListeners = new Set<() => void>()
const IGNORED_CHILD_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  '.pnpm-store',
  '.yarn',
  '.cache',
])

let hookCounter = 0
let runtimeInitialized = false
let lastCatalogSignature = ''
let pluginCatalogSnapshot: PluginCatalogSnapshot = {
  directories: [],
  plugins: [],
  warnings: [],
  syncedAt: 0,
}

function getHooksForEvent<E extends PluginHookEvent>(event: E): RegisteredHook<E>[] {
  return hooksByEvent[event]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    next.push(trimmed)
  }
  return next
}

function getPathBaseName(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? targetPath
}

function joinPath(base: string, name: string): string {
  if (base.endsWith('/') || base.endsWith('\\')) return `${base}${name}`
  return `${base}/${name}`
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const file = await window.electronAPI.fs.readFile(filePath)
    const parsed = JSON.parse(file.content) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function readManifestMetadata(
  raw: Record<string, unknown>,
  fallbackName: string
): { id: string; name: string; version: string; description: string | null; rendererEntry: string | null } {
  const name = asString(raw.name) ?? fallbackName
  const version = asString(raw.version) ?? '0.0.0'
  const description = asString(raw.description)
  const rendererEntry = asString(raw.rendererEntry)
    ?? asString(raw.entry)
    ?? asString(raw.main)
    ?? null
  return {
    id: asString(raw.id) ?? name,
    name,
    version,
    description,
    rendererEntry,
  }
}

async function detectPluginAtRoot(rootDir: string): Promise<RuntimeDiscoveredPlugin | null> {
  const fallbackName = getPathBaseName(rootDir)

  const agentSpaceManifestPath = joinPath(rootDir, 'agent-space.plugin.json')
  const agentSpaceManifest = await readJsonFile(agentSpaceManifestPath)
  if (agentSpaceManifest) {
    const metadata = readManifestMetadata(agentSpaceManifest, fallbackName)
    return {
      ...metadata,
      rootDir,
      manifestPath: agentSpaceManifestPath,
      source: 'agent-space.plugin.json',
    }
  }

  const openClawManifestPath = joinPath(rootDir, 'openclaw.plugin.json')
  const openClawManifest = await readJsonFile(openClawManifestPath)
  if (openClawManifest) {
    const metadata = readManifestMetadata(openClawManifest, fallbackName)
    return {
      ...metadata,
      rootDir,
      manifestPath: openClawManifestPath,
      source: 'openclaw.plugin.json',
    }
  }

  const packagePath = joinPath(rootDir, 'package.json')
  const packageJson = await readJsonFile(packagePath)
  if (!packageJson) return null

  const openClawConfig = asRecord(packageJson.openclaw)
  const agentSpaceConfig = asRecord(packageJson.agentSpace)
  const extensionEntries = asStringArray(openClawConfig?.extensions)
  const packageKeywords = asStringArray(packageJson.keywords)
  const hasPluginKeyword = packageKeywords.some((keyword) =>
    keyword === 'openclaw-plugin' || keyword === 'agent-space-plugin'
  )
  const metadata = readManifestMetadata(packageJson, fallbackName)
  const rendererEntryFromConfig = asString(agentSpaceConfig?.rendererEntry)
    ?? asString(openClawConfig?.rendererEntry)
    ?? extensionEntries[0]
    ?? null

  if (!hasPluginKeyword && extensionEntries.length === 0 && !rendererEntryFromConfig) {
    return null
  }

  return {
    ...metadata,
    rendererEntry: rendererEntryFromConfig ?? metadata.rendererEntry,
    rootDir,
    manifestPath: packagePath,
    source: 'package.json',
  }
}

async function listCandidatePluginRoots(directory: string): Promise<string[]> {
  const roots = [directory]
  try {
    const entries = await window.electronAPI.fs.readDir(directory)
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      if (entry.name.startsWith('.')) continue
      if (IGNORED_CHILD_DIRS.has(entry.name)) continue
      roots.push(entry.path)
      if (roots.length >= 80) break
    }
  } catch {
    // Keep root-only scan if we fail to enumerate children.
  }
  return roots
}

function replaceTildePrefix(rawPath: string, homeDir: string): string {
  if (rawPath === '~') return homeDir
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return `${homeDir}${rawPath.slice(1)}`
  }
  return rawPath
}

function updatePluginCatalogSnapshot(next: PluginCatalogSnapshot): void {
  pluginCatalogSnapshot = next
  for (const listener of pluginCatalogListeners) {
    try {
      listener()
    } catch (err) {
      console.error('[plugins] listener failure:', err)
    }
  }
}

async function syncPluginCatalogFromSettings(): Promise<void> {
  try {
    const settings = await window.electronAPI.settings.get()
    await syncPluginCatalogFromProfiles(settings.claudeProfiles)
  } catch (err) {
    logRendererEvent('warn', 'plugin.catalog.settings_sync_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function getPluginCatalogSnapshot(): PluginCatalogSnapshot {
  return pluginCatalogSnapshot
}

export function subscribePluginCatalog(listener: () => void): () => void {
  pluginCatalogListeners.add(listener)
  return () => {
    pluginCatalogListeners.delete(listener)
  }
}

export function collectPluginDirsFromProfiles(config: ClaudeProfilesConfig | undefined): string[] {
  if (!config) return []
  return dedupePreserveOrder(
    config.profiles.flatMap((profile) => profile.pluginDirs.map((path) => path.trim()))
  )
}

export async function syncPluginCatalog(pluginDirs: string[]): Promise<PluginCatalogSnapshot> {
  if (!window?.electronAPI?.fs) {
    return pluginCatalogSnapshot
  }

  const normalizedInputDirs = dedupePreserveOrder(pluginDirs)
  const homeDir = await window.electronAPI.fs.homeDir()
  const normalizedDirs = dedupePreserveOrder(
    normalizedInputDirs.map((dir) => replaceTildePrefix(dir, homeDir))
  )
  const nextSignature = normalizedDirs.join('::')
  if (nextSignature === lastCatalogSignature) {
    return pluginCatalogSnapshot
  }

  const warnings: string[] = []
  const pluginsByManifest = new Map<string, RuntimeDiscoveredPlugin>()
  const scannedDirectories: string[] = []

  for (const directory of normalizedDirs) {
    try {
      const stat = await window.electronAPI.fs.stat(directory)
      if (!stat.isDirectory) {
        warnings.push(`Plugin dir is not a directory: ${directory}`)
        continue
      }
    } catch {
      warnings.push(`Plugin dir not found: ${directory}`)
      continue
    }

    scannedDirectories.push(directory)
    const roots = await listCandidatePluginRoots(directory)
    for (const rootDir of roots) {
      const discovered = await detectPluginAtRoot(rootDir)
      if (!discovered) continue
      const dedupeKey = discovered.manifestPath
      if (!pluginsByManifest.has(dedupeKey)) {
        pluginsByManifest.set(dedupeKey, discovered)
      }
    }
  }

  const plugins = Array.from(pluginsByManifest.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  const snapshot: PluginCatalogSnapshot = {
    directories: scannedDirectories,
    plugins,
    warnings,
    syncedAt: Date.now(),
  }

  lastCatalogSignature = nextSignature
  updatePluginCatalogSnapshot(snapshot)

  logRendererEvent('info', 'plugin.catalog.synced', {
    requestedDirectories: normalizedDirs.length,
    scannedDirectories: scannedDirectories.length,
    discoveredPlugins: plugins.length,
    warnings: warnings.length,
  })

  return snapshot
}

export async function syncPluginCatalogFromProfiles(
  config: ClaudeProfilesConfig | undefined
): Promise<PluginCatalogSnapshot> {
  return syncPluginCatalog(collectPluginDirsFromProfiles(config))
}

export function registerPluginHook<E extends PluginHookEvent>(
  event: E,
  handler: PluginHookHandler<E>,
  options?: { pluginId?: string; order?: number }
): () => void {
  const hook: RegisteredHook<E> = {
    id: `hook-${++hookCounter}`,
    event,
    pluginId: options?.pluginId ?? 'anonymous',
    order: options?.order ?? 100,
    handler,
  }
  const hooks = getHooksForEvent(event)
  hooks.push(hook)
  hooks.sort((a, b) => a.order - b.order)

  return () => {
    const current = getHooksForEvent(event)
    const index = current.findIndex((entry) => entry.id === hook.id)
    if (index >= 0) {
      current.splice(index, 1)
    }
  }
}

export async function emitPluginHook<E extends PluginHookEvent>(
  event: E,
  payload: PluginHookEventPayloadMap[E]
): Promise<void> {
  const hooks = getHooksForEvent(event)
  if (hooks.length === 0) return

  for (const hook of hooks) {
    try {
      await hook.handler(payload)
    } catch (err) {
      logRendererEvent('error', 'plugin.hook.failed', {
        event,
        hookId: hook.id,
        pluginId: hook.pluginId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export function initializePluginRuntime(): void {
  if (runtimeInitialized) return
  runtimeInitialized = true

  registerDiagnosticsHooks(registerPluginHook)
  void syncPluginCatalogFromSettings()
  logRendererEvent('info', 'plugin.runtime.initialized', {
    registeredEvents: Object.entries(hooksByEvent).map(([event, hooks]) => `${event}:${hooks.length}`),
  })
}
