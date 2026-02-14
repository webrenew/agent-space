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

interface RegisteredPluginCommand {
  id: string
  name: string
  pluginId: string
  description: string | null
  execute: PluginCommandDefinition['execute']
}

type HooksByEvent = {
  [E in PluginHookEvent]: RegisteredHook<E>[]
}

type PluginLoadState = 'loaded' | 'failed' | 'skipped'

interface RawDiscoveredPlugin {
  id: string
  name: string
  version: string
  description: string | null
  rootDir: string
  manifestPath: string
  source: 'agent-space.plugin.json' | 'openclaw.plugin.json' | 'package.json'
  rendererEntry: string | null
}

export interface RuntimeDiscoveredPlugin extends RawDiscoveredPlugin {
  loadState: PluginLoadState
  loadError: string | null
}

export interface PluginCommandContext {
  chatSessionId: string
  workspaceDirectory: string | null
  agentId: string | null
  rawMessage: string
  argsRaw: string
  args: string[]
  attachmentNames: string[]
  mentionPaths: string[]
}

export interface PluginCommandDefinition {
  name: string
  description?: string
  execute: (
    context: PluginCommandContext
  ) =>
    | void
    | string
    | { message?: string; isError?: boolean; error?: string }
    | Promise<void | string | { message?: string; isError?: boolean; error?: string }>
}

export interface PluginCommandSummary {
  name: string
  pluginId: string
  description: string | null
}

export interface PluginCommandExecutionResult {
  handled: boolean
  commandName: string
  pluginId: string | null
  message: string | null
  isError: boolean
}

export interface PluginCatalogSnapshot {
  directories: string[]
  plugins: RuntimeDiscoveredPlugin[]
  commands: PluginCommandSummary[]
  warnings: string[]
  syncedAt: number
}

interface LoadedPluginInstance {
  entryPath: string
  dispose: () => void
}

interface PluginModule {
  default?: unknown
  register?: unknown
}

interface RendererPluginApi {
  registerHook: <E extends PluginHookEvent>(
    event: E,
    handler: PluginHookHandler<E>,
    options?: { order?: number }
  ) => () => void
  on: <E extends PluginHookEvent>(
    event: E,
    handler: PluginHookHandler<E>,
    options?: { order?: number }
  ) => () => void
  registerCommand: (
    command: PluginCommandDefinition
  ) => () => void
  log: (level: 'info' | 'warn' | 'error', event: string, payload?: Record<string, unknown>) => void
  plugin: RawDiscoveredPlugin
}

type RegisterPluginFunction = (api: RendererPluginApi) => unknown | Promise<unknown>

const hooksByEvent: HooksByEvent = {
  session_start: [],
  session_end: [],
  message_received: [],
  message_sent: [],
  before_tool_call: [],
  after_tool_call: [],
}

const pluginCatalogListeners = new Set<() => void>()
const loadedPluginInstances = new Map<string, LoadedPluginInstance>()
const pluginLoadErrors = new Map<string, string>()
const pluginCommandsByName = new Map<string, RegisteredPluginCommand>()
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
let commandCounter = 0
let runtimeInitialized = false
let lastCatalogSignature = ''
let pluginCatalogSnapshot: PluginCatalogSnapshot = {
  directories: [],
  plugins: [],
  commands: [],
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

function isAbsolutePath(input: string): boolean {
  return input.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(input)
    || input.startsWith('\\\\')
}

function replaceTildePrefix(rawPath: string, homeDir: string): string {
  if (rawPath === '~') return homeDir
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return `${homeDir}${rawPath.slice(1)}`
  }
  return rawPath
}

function toFileModuleSpecifier(filePath: string, versionTag?: number): string {
  const normalized = filePath.replace(/\\/g, '/')
  const base = /^[a-zA-Z]:\//.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized}`
  const encoded = encodeURI(base)
  if (!versionTag || !Number.isFinite(versionTag)) return encoded
  return `${encoded}?v=${Math.floor(versionTag)}`
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function runDisposer(
  disposer: (() => void) | null | undefined,
  context: string,
  pluginId?: string
): void {
  if (!disposer) return
  try {
    disposer()
  } catch (err) {
    logRendererEvent('warn', 'plugin.runtime.dispose_failed', {
      context,
      pluginId,
      error: toErrorMessage(err),
    })
  }
}

function normalizeCommandName(rawName: string): string | null {
  const trimmed = rawName.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const normalized = withoutPrefix.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-z0-9._-]+$/.test(normalized)) return null
  return normalized
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

function refreshSnapshotCommands(): void {
  if (pluginCatalogSnapshot.syncedAt === 0) return
  updatePluginCatalogSnapshot({
    ...pluginCatalogSnapshot,
    commands: getRegisteredPluginCommands(),
    syncedAt: Date.now(),
  })
}

function normalizeCommandExecutionOutput(
  output: unknown
): { message: string | null; isError: boolean } {
  if (output === null || output === undefined) {
    return { message: null, isError: false }
  }
  if (typeof output === 'string') {
    const message = output.trim()
    return { message: message || null, isError: false }
  }
  const record = asRecord(output)
  if (record) {
    const messageFromMessage = asString(record.message)
    const messageFromError = asString(record.error)
    const isError = record.isError === true || Boolean(messageFromError)
    if (messageFromMessage) {
      return { message: messageFromMessage, isError }
    }
    if (messageFromError) {
      return { message: messageFromError, isError: true }
    }
  }
  try {
    return { message: JSON.stringify(output), isError: false }
  } catch {
    return { message: String(output), isError: false }
  }
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

async function detectPluginAtRoot(rootDir: string): Promise<RawDiscoveredPlugin | null> {
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

async function resolveRendererEntryPath(plugin: RawDiscoveredPlugin, homeDir: string): Promise<string | null> {
  if (!plugin.rendererEntry) return null
  const expanded = replaceTildePrefix(plugin.rendererEntry, homeDir)
  return isAbsolutePath(expanded) ? expanded : joinPath(plugin.rootDir, expanded)
}

export function registerPluginCommand(
  command: PluginCommandDefinition,
  options?: { pluginId?: string }
): () => void {
  const normalizedName = normalizeCommandName(command.name)
  if (!normalizedName) {
    throw new Error(`Invalid plugin command name: ${command.name}`)
  }

  const registered: RegisteredPluginCommand = {
    id: `command-${++commandCounter}`,
    name: normalizedName,
    pluginId: options?.pluginId ?? 'anonymous',
    description: asString(command.description) ?? null,
    execute: command.execute,
  }

  const existing = pluginCommandsByName.get(normalizedName)
  if (existing && existing.id !== registered.id) {
    logRendererEvent('warn', 'plugin.command.replaced', {
      commandName: normalizedName,
      replacedPluginId: existing.pluginId,
      pluginId: registered.pluginId,
    })
  }

  pluginCommandsByName.set(normalizedName, registered)
  refreshSnapshotCommands()

  return () => {
    const current = pluginCommandsByName.get(normalizedName)
    if (!current || current.id !== registered.id) return
    pluginCommandsByName.delete(normalizedName)
    refreshSnapshotCommands()
  }
}

export function getRegisteredPluginCommands(): PluginCommandSummary[] {
  return Array.from(pluginCommandsByName.values())
    .map((command) => ({
      name: command.name,
      pluginId: command.pluginId,
      description: command.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function invokePluginCommand(
  commandName: string,
  context: PluginCommandContext
): Promise<PluginCommandExecutionResult> {
  const normalizedName = normalizeCommandName(commandName)
  if (!normalizedName) {
    return {
      handled: false,
      commandName: commandName.trim(),
      pluginId: null,
      message: null,
      isError: false,
    }
  }

  const command = pluginCommandsByName.get(normalizedName)
  if (!command) {
    return {
      handled: false,
      commandName: normalizedName,
      pluginId: null,
      message: null,
      isError: false,
    }
  }

  try {
    const output = await command.execute(context)
    const normalizedOutput = normalizeCommandExecutionOutput(output)
    logRendererEvent('info', 'plugin.command.executed', {
      pluginId: command.pluginId,
      commandName: normalizedName,
      hasMessage: Boolean(normalizedOutput.message),
      isError: normalizedOutput.isError,
    })
    return {
      handled: true,
      commandName: normalizedName,
      pluginId: command.pluginId,
      message: normalizedOutput.message,
      isError: normalizedOutput.isError,
    }
  } catch (err) {
    const errorMessage = toErrorMessage(err)
    logRendererEvent('warn', 'plugin.command.failed', {
      pluginId: command.pluginId,
      commandName: normalizedName,
      error: errorMessage,
    })
    return {
      handled: true,
      commandName: normalizedName,
      pluginId: command.pluginId,
      message: errorMessage,
      isError: true,
    }
  }
}

async function loadPluginModule(
  plugin: RawDiscoveredPlugin,
  entryPath: string
): Promise<LoadedPluginInstance> {
  const stat = await window.electronAPI.fs.stat(entryPath)
  if (!stat.isFile) {
    throw new Error(`Renderer entry is not a file: ${entryPath}`)
  }

  const moduleSpecifier = toFileModuleSpecifier(entryPath, stat.modified)
  const moduleExports = await import(/* @vite-ignore */ moduleSpecifier) as PluginModule
  const registerCandidate = typeof moduleExports.default === 'function'
    ? moduleExports.default
    : moduleExports.register
  if (typeof registerCandidate !== 'function') {
    throw new Error('Plugin module must export default function register(api) or named register(api)')
  }

  const hookDisposers: Array<() => void> = []
  const registerHookFromPlugin = <E extends PluginHookEvent>(
    event: E,
    handler: PluginHookHandler<E>,
    options?: { order?: number }
  ): (() => void) => {
    const dispose = registerPluginHook(event, handler, {
      pluginId: plugin.id,
      order: options?.order,
    })
    hookDisposers.push(dispose)
    return () => {
      const index = hookDisposers.indexOf(dispose)
      if (index >= 0) hookDisposers.splice(index, 1)
      runDisposer(dispose, 'hook_unregister', plugin.id)
    }
  }

  const commandDisposers: Array<() => void> = []
  const registerCommandFromPlugin = (command: PluginCommandDefinition): (() => void) => {
    const dispose = registerPluginCommand(command, { pluginId: plugin.id })
    commandDisposers.push(dispose)
    return () => {
      const index = commandDisposers.indexOf(dispose)
      if (index >= 0) commandDisposers.splice(index, 1)
      runDisposer(dispose, 'command_unregister', plugin.id)
    }
  }

  const api: RendererPluginApi = {
    registerHook: registerHookFromPlugin,
    on: registerHookFromPlugin,
    registerCommand: registerCommandFromPlugin,
    log: (level, event, payload) => {
      logRendererEvent(level, `plugin.${plugin.id}.${event}`, payload)
    },
    plugin,
  }

  const pluginCleanupCandidates: Array<() => void> = []
  const register = registerCandidate as RegisterPluginFunction
  const registrationResult = await register(api)
  if (typeof registrationResult === 'function') {
    pluginCleanupCandidates.push(registrationResult as () => void)
  } else {
    const registrationRecord = asRecord(registrationResult)
    const disposeMaybe = registrationRecord?.dispose
    if (typeof disposeMaybe === 'function') {
      pluginCleanupCandidates.push(disposeMaybe as () => void)
    }
  }

  const dispose = () => {
    while (pluginCleanupCandidates.length > 0) {
      const candidate = pluginCleanupCandidates.pop()
      runDisposer(candidate, 'plugin_unregister', plugin.id)
    }
    while (commandDisposers.length > 0) {
      const commandDispose = commandDisposers.pop()
      runDisposer(commandDispose, 'command_unregister', plugin.id)
    }
    while (hookDisposers.length > 0) {
      const hookDispose = hookDisposers.pop()
      runDisposer(hookDispose, 'hook_unregister', plugin.id)
    }
  }

  return { entryPath, dispose }
}

async function reconcileLoadedPlugins(
  plugins: RawDiscoveredPlugin[],
  homeDir: string
): Promise<void> {
  const desiredEntryPaths = new Map<string, string | null>()
  for (const plugin of plugins) {
    desiredEntryPaths.set(plugin.manifestPath, await resolveRendererEntryPath(plugin, homeDir))
  }

  for (const [manifestPath, instance] of loadedPluginInstances) {
    const desiredEntryPath = desiredEntryPaths.get(manifestPath)
    if (!desiredEntryPath || desiredEntryPath !== instance.entryPath) {
      runDisposer(instance.dispose, 'plugin_reload', manifestPath)
      loadedPluginInstances.delete(manifestPath)
    }
  }

  for (const manifestPath of Array.from(pluginLoadErrors.keys())) {
    if (!desiredEntryPaths.has(manifestPath)) {
      pluginLoadErrors.delete(manifestPath)
    }
  }

  for (const plugin of plugins) {
    const entryPath = desiredEntryPaths.get(plugin.manifestPath) ?? null
    if (!entryPath) {
      pluginLoadErrors.delete(plugin.manifestPath)
      continue
    }
    if (loadedPluginInstances.has(plugin.manifestPath)) {
      pluginLoadErrors.delete(plugin.manifestPath)
      continue
    }

    try {
      const instance = await loadPluginModule(plugin, entryPath)
      loadedPluginInstances.set(plugin.manifestPath, instance)
      pluginLoadErrors.delete(plugin.manifestPath)
      logRendererEvent('info', 'plugin.runtime.loaded', {
        pluginId: plugin.id,
        manifestPath: plugin.manifestPath,
        entryPath,
      })
    } catch (err) {
      const message = toErrorMessage(err)
      pluginLoadErrors.set(plugin.manifestPath, message)
      logRendererEvent('warn', 'plugin.runtime.load_failed', {
        pluginId: plugin.id,
        manifestPath: plugin.manifestPath,
        entryPath,
        error: message,
      })
    }
  }
}

function toRuntimePlugin(plugin: RawDiscoveredPlugin): RuntimeDiscoveredPlugin {
  if (!plugin.rendererEntry) {
    return {
      ...plugin,
      loadState: 'skipped',
      loadError: null,
    }
  }
  if (loadedPluginInstances.has(plugin.manifestPath)) {
    return {
      ...plugin,
      loadState: 'loaded',
      loadError: null,
    }
  }
  return {
    ...plugin,
    loadState: 'failed',
    loadError: pluginLoadErrors.get(plugin.manifestPath) ?? 'Renderer entry failed to load',
  }
}

async function syncPluginCatalogFromSettings(): Promise<void> {
  try {
    const settings = await window.electronAPI.settings.get()
    await syncPluginCatalogFromProfiles(settings.claudeProfiles)
  } catch (err) {
    logRendererEvent('warn', 'plugin.catalog.settings_sync_failed', {
      error: toErrorMessage(err),
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
  if (!window.electronAPI?.fs) {
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

  const discoveryWarnings: string[] = []
  const pluginsByManifest = new Map<string, RawDiscoveredPlugin>()
  const scannedDirectories: string[] = []

  for (const directory of normalizedDirs) {
    try {
      const stat = await window.electronAPI.fs.stat(directory)
      if (!stat.isDirectory) {
        discoveryWarnings.push(`Plugin dir is not a directory: ${directory}`)
        continue
      }
    } catch {
      discoveryWarnings.push(`Plugin dir not found: ${directory}`)
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

  const discoveredPlugins = Array.from(pluginsByManifest.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  await reconcileLoadedPlugins(discoveredPlugins, homeDir)

  const runtimePlugins = discoveredPlugins.map(toRuntimePlugin)
  const loadWarnings = runtimePlugins
    .filter((plugin) => plugin.loadState === 'failed' && plugin.loadError)
    .map((plugin) => `${plugin.name}: ${plugin.loadError}`)

  const snapshot: PluginCatalogSnapshot = {
    directories: scannedDirectories,
    plugins: runtimePlugins,
    commands: getRegisteredPluginCommands(),
    warnings: [...discoveryWarnings, ...loadWarnings],
    syncedAt: Date.now(),
  }

  lastCatalogSignature = nextSignature
  updatePluginCatalogSnapshot(snapshot)

  logRendererEvent('info', 'plugin.catalog.synced', {
    requestedDirectories: normalizedDirs.length,
    scannedDirectories: scannedDirectories.length,
    discoveredPlugins: discoveredPlugins.length,
    loadedPlugins: runtimePlugins.filter((plugin) => plugin.loadState === 'loaded').length,
    registeredCommands: snapshot.commands.length,
    warnings: snapshot.warnings.length,
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
        error: toErrorMessage(err),
      })
    }
  }
}

function registerBuiltinCommands(): void {
  registerPluginCommand(
    {
      name: 'plugins',
      description: 'List loaded renderer plugins and commands.',
      execute: () => {
        const loaded = pluginCatalogSnapshot.plugins.filter((plugin) => plugin.loadState === 'loaded')
        const commandNames = getRegisteredPluginCommands().map((command) => `/${command.name}`)
        const pluginList = loaded.length > 0
          ? loaded.map((plugin) => plugin.name).join(', ')
          : 'none'
        const commands = commandNames.length > 0
          ? commandNames.join(', ')
          : 'none'
        return `Plugins loaded: ${pluginList}\nCommands: ${commands}`
      },
    },
    { pluginId: 'builtin.runtime' }
  )
}

export function initializePluginRuntime(): void {
  if (runtimeInitialized) return
  runtimeInitialized = true

  registerDiagnosticsHooks(registerPluginHook)
  registerBuiltinCommands()
  void syncPluginCatalogFromSettings()
  logRendererEvent('info', 'plugin.runtime.initialized', {
    registeredEvents: Object.entries(hooksByEvent).map(([event, hooks]) => `${event}:${hooks.length}`),
    registeredCommands: getRegisteredPluginCommands().map((entry) => entry.name),
  })
}
