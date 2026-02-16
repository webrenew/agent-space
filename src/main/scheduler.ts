import { ipcMain, BrowserWindow } from 'electron'
import { type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getClaudeBinaryPath, getClaudeEnvironment } from './claude-session'
import { logMainError, logMainEvent } from './diagnostics'
import { resolveClaudeProfileForDirectory } from './claude-profile'
import { writeFileAtomicSync } from './atomic-write'
import {
  clearManagedForceKillTimer,
  resolveManagedRuntimeMs,
  runManagedProcess,
  scheduleManagedForceKill,
  terminateManagedProcess,
} from './process-runner'
import { assertAppNotShuttingDown } from './shutdown-state'

type SchedulerRunStatus = 'idle' | 'running' | 'success' | 'error'
type SchedulerRunTrigger = 'cron' | 'manual'

interface SchedulerRunContext {
  scheduledForMinuteKey: string | null
  scheduledForTimestamp: string | null
  backfillMinutes: number | null
}

interface SchedulerTask {
  id: string
  name: string
  cron: string
  prompt: string
  workingDirectory: string
  enabled: boolean
  yoloMode: boolean
  createdAt: number
  updatedAt: number
}

interface SchedulerTaskInput {
  id?: string
  name: string
  cron: string
  prompt: string
  workingDirectory: string
  enabled: boolean
  yoloMode: boolean
}

interface SchedulerTaskRuntime {
  lastRunAt: number | null
  lastStatus: SchedulerRunStatus
  lastError: string | null
  lastDurationMs: number | null
  lastRunTrigger: SchedulerRunTrigger | null
  lastRunMinuteKey: string | null
  lastScheduledMinuteKey: string | null
  lastBackfillMinutes: number | null
}

interface SchedulerTaskWithRuntime extends SchedulerTask {
  nextRunAt: number | null
  isRunning: boolean
  lastRunAt: number | null
  lastStatus: SchedulerRunStatus
  lastError: string | null
  lastDurationMs: number | null
  lastRunTrigger: SchedulerRunTrigger | null
  lastScheduledMinuteKey: string | null
  lastBackfillMinutes: number | null
}

interface PendingSchedulerCronRun {
  minuteTimestampMs: number
  minuteKey: string
}

interface ParsedCronField {
  values: Set<number>
  wildcard: boolean
}

interface ParsedCron {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

const SCHEDULER_DIR = path.join(os.homedir(), '.agent-observer')
const SCHEDULER_FILE = path.join(SCHEDULER_DIR, 'schedules.json')
const SCHEDULER_MAX_SCAN_MINUTES = 366 * 24 * 60
const SCHEDULER_TICK_MS = 10_000
const SCHEDULER_BACKFILL_DEFAULT_WINDOW_MINUTES = 15
const SCHEDULER_BACKFILL_MAX_WINDOW_MINUTES = 24 * 60
const SCHEDULER_RUN_DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000
const SCHEDULER_FORCE_KILL_TIMEOUT_MS = 10_000
const INVALID_CRON_ERROR_PREFIX = 'Invalid cron expression:'

let handlersRegistered = false
let schedulerTimer: NodeJS.Timeout | null = null
let schedulerTickInFlight = false
let schedulerTickRequested = false
let lastSuccessfulSchedulerTickAt: number | null = null
let tasksCache: SchedulerTask[] = []

const runtimeByTaskId = new Map<string, SchedulerTaskRuntime>()
const runningProcessByTaskId = new Map<string, ChildProcess>()
const pendingCronRunsByTaskId = new Map<string, PendingSchedulerCronRun[]>()
const cronDispatchInFlightByTaskId = new Set<string>()
const cronParseCache = new Map<string, ParsedCron>()
const loadValidationErrorsByTaskId = new Map<string, string>()
const forceKillTimerByTaskId = new Map<string, NodeJS.Timeout>()

function taskExists(taskId: string): boolean {
  return tasksCache.some((task) => task.id === taskId)
}

function resolveSchedulerRunMaxRuntimeMs(): number {
  return resolveManagedRuntimeMs({
    envVarName: 'AGENT_SPACE_SCHEDULER_MAX_RUNTIME_MS',
    defaultMs: SCHEDULER_RUN_DEFAULT_MAX_RUNTIME_MS,
    onInvalidConfig: (rawValue, fallbackMs) => {
      logMainEvent('scheduler.run.invalid_timeout_config', {
        rawValue,
        fallbackMs,
      }, 'warn')
    },
  })
}

function resolveSchedulerBackfillWindowMinutes(): number {
  const rawValue = process.env.AGENT_SPACE_SCHEDULER_BACKFILL_WINDOW_MINUTES
  if (!rawValue) return SCHEDULER_BACKFILL_DEFAULT_WINDOW_MINUTES

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    logMainEvent('scheduler.tick.invalid_backfill_window_config', {
      rawValue,
      fallbackMinutes: SCHEDULER_BACKFILL_DEFAULT_WINDOW_MINUTES,
    }, 'warn')
    return SCHEDULER_BACKFILL_DEFAULT_WINDOW_MINUTES
  }

  if (parsed > SCHEDULER_BACKFILL_MAX_WINDOW_MINUTES) {
    logMainEvent('scheduler.tick.clamped_backfill_window_config', {
      rawValue,
      parsed,
      clampedMinutes: SCHEDULER_BACKFILL_MAX_WINDOW_MINUTES,
    }, 'warn')
    return SCHEDULER_BACKFILL_MAX_WINDOW_MINUTES
  }
  return parsed
}

function clearSchedulerForceKillTimer(taskId: string): void {
  clearManagedForceKillTimer(forceKillTimerByTaskId, taskId)
}

function scheduleSchedulerForceKill(taskId: string, proc: ChildProcess, reason: string): void {
  scheduleManagedForceKill({
    timers: forceKillTimerByTaskId,
    key: taskId,
    process: proc,
    delayMs: SCHEDULER_FORCE_KILL_TIMEOUT_MS,
    onForceKill: () => {
      logMainEvent('scheduler.process.force_kill', { taskId, reason }, 'warn')
    },
    onForceKillFailed: (err) => {
      logMainError('scheduler.process.force_kill_failed', err, { taskId, reason })
    },
  })
}

function createRuntime(): SchedulerTaskRuntime {
  return {
    lastRunAt: null,
    lastStatus: 'idle',
    lastError: null,
    lastDurationMs: null,
    lastRunTrigger: null,
    lastRunMinuteKey: null,
    lastScheduledMinuteKey: null,
    lastBackfillMinutes: null,
  }
}

function ensureSchedulerDir(): void {
  if (!fs.existsSync(SCHEDULER_DIR)) {
    fs.mkdirSync(SCHEDULER_DIR, { recursive: true })
  }
}

function broadcastSchedulerUpdate(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('scheduler:updated')
    }
  }
}

function normalizeTaskInput(input: SchedulerTaskInput): SchedulerTaskInput {
  const normalizedWorkingDirectory = input.workingDirectory.trim()
  return {
    id: input.id,
    name: input.name.trim(),
    cron: input.cron.trim().replace(/\s+/g, ' '),
    prompt: input.prompt.trim(),
    workingDirectory: normalizedWorkingDirectory ? path.resolve(normalizedWorkingDirectory) : '',
    enabled: input.enabled === true,
    yoloMode: input.yoloMode === true,
  }
}

function assertValidTaskInput(input: SchedulerTaskInput): void {
  if (!input.name.trim()) {
    throw new Error('Task name is required')
  }
  if (!input.prompt.trim()) {
    throw new Error('Task prompt is required')
  }
  if (!input.workingDirectory.trim()) {
    throw new Error('Task directory is required')
  }

  const parsedCron = parseCronExpression(input.cron)
  if (!parsedCron) {
    throw new Error('Invalid cron expression. Use five fields: minute hour day month weekday')
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(input.workingDirectory)
  } catch {
    throw new Error(`Directory does not exist: ${input.workingDirectory}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`Directory is not valid: ${input.workingDirectory}`)
  }

  cronParseCache.set(input.cron, parsedCron)
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
}

function floorToMinuteTimestamp(timestampMs: number): number {
  return Math.floor(timestampMs / 60_000) * 60_000
}

function parseCronFieldPart(part: string, min: number, max: number, mapDow = false): number[] {
  const applyDowMap = (value: number): number => {
    if (!mapDow) return value
    return value === 7 ? 0 : value
  }

  const toNumber = (value: string): number => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number "${value}"`)
    return parsed
  }

  const pushRange = (start: number, end: number, step: number): number[] => {
    if (step <= 0) throw new Error('Step must be positive')
    if (start < min || end > max || start > end) {
      throw new Error(`Range "${start}-${end}" is out of bounds (${min}-${max})`)
    }
    const values: number[] = []
    for (let value = start; value <= end; value += step) {
      values.push(value)
    }
    return values
  }

  const [base, stepRaw] = part.split('/')
  const step = stepRaw ? Number.parseInt(stepRaw, 10) : 1
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`Invalid step "${stepRaw}"`)
  }

  if (base === '*') {
    return pushRange(min, max, step).map(applyDowMap)
  }

  if (base.includes('-')) {
    const [startRaw, endRaw] = base.split('-')
    const start = toNumber(startRaw)
    const end = toNumber(endRaw)
    return pushRange(start, end, step).map(applyDowMap)
  }

  const value = toNumber(base)
  if (value < min || value > max) {
    throw new Error(`Value "${value}" is out of bounds (${min}-${max})`)
  }
  return [applyDowMap(value)]
}

function parseCronField(field: string, min: number, max: number, mapDow = false): ParsedCronField {
  const normalized = field.trim()
  if (!normalized) throw new Error('Cron field is empty')
  if (normalized === '*') {
    const values = new Set<number>()
    for (let value = min; value <= max; value += 1) {
      if (mapDow && value === 7) {
        values.add(0)
      } else {
        values.add(value)
      }
    }
    return {
      values,
      wildcard: true,
    }
  }

  const values = new Set<number>()
  for (const part of normalized.split(',')) {
    for (const value of parseCronFieldPart(part.trim(), min, max, mapDow)) {
      values.add(value)
    }
  }
  if (values.size === 0) throw new Error('Cron field has no values')
  return { values, wildcard: false }
}

function parseCronExpression(expression: string): ParsedCron | null {
  const normalized = expression.trim().replace(/\s+/g, ' ')
  const fields = normalized.split(' ')
  if (fields.length !== 5) return null

  try {
    return {
      minute: parseCronField(fields[0], 0, 59),
      hour: parseCronField(fields[1], 0, 23),
      dayOfMonth: parseCronField(fields[2], 1, 31),
      month: parseCronField(fields[3], 1, 12),
      dayOfWeek: parseCronField(fields[4], 0, 7, true),
    }
  } catch {
    return null
  }
}

function getParsedCron(expression: string): ParsedCron | null {
  const cached = cronParseCache.get(expression)
  if (cached) return cached
  const parsed = parseCronExpression(expression)
  if (!parsed) return null
  cronParseCache.set(expression, parsed)
  return parsed
}

function matchesCronDate(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.minute.values.has(date.getMinutes())) return false
  if (!parsed.hour.values.has(date.getHours())) return false
  if (!parsed.month.values.has(date.getMonth() + 1)) return false

  const dayOfMonthMatch = parsed.dayOfMonth.values.has(date.getDate())
  const dayOfWeekMatch = parsed.dayOfWeek.values.has(date.getDay())
  const domWildcard = parsed.dayOfMonth.wildcard
  const dowWildcard = parsed.dayOfWeek.wildcard

  if (domWildcard && dowWildcard) return true
  if (domWildcard) return dayOfWeekMatch
  if (dowWildcard) return dayOfMonthMatch
  return dayOfMonthMatch || dayOfWeekMatch
}

function computeNextRunAt(task: SchedulerTask, fromDate = new Date()): number | null {
  if (!task.enabled) return null
  const parsed = getParsedCron(task.cron)
  if (!parsed) return null

  const cursor = new Date(fromDate.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  for (let i = 0; i < SCHEDULER_MAX_SCAN_MINUTES; i++) {
    if (matchesCronDate(parsed, cursor)) {
      return cursor.getTime()
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

function readTasksFromDisk(): SchedulerTask[] {
  ensureSchedulerDir()
  if (!fs.existsSync(SCHEDULER_FILE)) return []

  try {
    cronParseCache.clear()
    loadValidationErrorsByTaskId.clear()
    const raw = fs.readFileSync(SCHEDULER_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const tasks: SchedulerTask[] = []
    let changed = false
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const candidate: SchedulerTask = {
        id: typeof obj.id === 'string' ? obj.id : '',
        name: typeof obj.name === 'string' ? obj.name : '',
        cron: typeof obj.cron === 'string' ? obj.cron : '',
        prompt: typeof obj.prompt === 'string' ? obj.prompt : '',
        workingDirectory: typeof obj.workingDirectory === 'string' ? obj.workingDirectory : '',
        enabled: obj.enabled === true,
        yoloMode: obj.yoloMode === true,
        createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
        updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
      }

      const normalized = normalizeTaskInput(candidate)
      if (!normalized.name || !normalized.cron || !normalized.prompt) continue
      if (!normalized.workingDirectory) continue

      const parsedCron = parseCronExpression(normalized.cron)
      if (parsedCron) {
        cronParseCache.set(normalized.cron, parsedCron)
      } else {
        loadValidationErrorsByTaskId.set(candidate.id, `${INVALID_CRON_ERROR_PREFIX} ${normalized.cron}`)
        logMainEvent('scheduler.task.invalid_cron', {
          taskId: candidate.id,
          taskName: normalized.name,
          cron: normalized.cron,
        }, 'warn')
        if (normalized.enabled) changed = true
      }

      tasks.push({
        ...candidate,
        name: normalized.name,
        cron: normalized.cron,
        prompt: normalized.prompt,
        workingDirectory: normalized.workingDirectory,
        enabled: parsedCron ? normalized.enabled : false,
        yoloMode: normalized.yoloMode,
      })
    }

    if (changed) {
      writeTasksToDisk(tasks)
    }

    return tasks
  } catch (err) {
    logMainError('scheduler.read.failed', err)
    return []
  }
}

function writeTasksToDisk(tasks: SchedulerTask[]): void {
  ensureSchedulerDir()
  writeFileAtomicSync(SCHEDULER_FILE, JSON.stringify(tasks, null, 2))
}

function loadTasksCache(): void {
  tasksCache = readTasksFromDisk()
  for (const task of tasksCache) {
    const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
    const validationError = loadValidationErrorsByTaskId.get(task.id)
    if (validationError) {
      runtime.lastStatus = 'error'
      runtime.lastError = `${validationError} (task disabled)`
      runtime.lastDurationMs = null
      runtime.lastRunTrigger = null
      runtime.lastScheduledMinuteKey = null
      runtime.lastBackfillMinutes = null
    } else if (runtime.lastError?.startsWith(INVALID_CRON_ERROR_PREFIX)) {
      runtime.lastStatus = 'idle'
      runtime.lastError = null
      runtime.lastDurationMs = null
      runtime.lastRunTrigger = null
      runtime.lastScheduledMinuteKey = null
      runtime.lastBackfillMinutes = null
    }
    runtimeByTaskId.set(task.id, runtime)
  }
}

function nextTaskId(): string {
  return `sched-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function toTaskWithRuntime(task: SchedulerTask): SchedulerTaskWithRuntime {
  const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
  runtimeByTaskId.set(task.id, runtime)
  return {
    ...task,
    nextRunAt: computeNextRunAt(task),
    isRunning: runningProcessByTaskId.has(task.id),
    lastRunAt: runtime.lastRunAt,
    lastStatus: runtime.lastStatus,
    lastError: runtime.lastError,
    lastDurationMs: runtime.lastDurationMs,
    lastRunTrigger: runtime.lastRunTrigger,
    lastScheduledMinuteKey: runtime.lastScheduledMinuteKey,
    lastBackfillMinutes: runtime.lastBackfillMinutes,
  }
}

function listTasks(): SchedulerTaskWithRuntime[] {
  return tasksCache
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toTaskWithRuntime)
}

function upsertTask(input: SchedulerTaskInput): SchedulerTaskWithRuntime {
  const normalized = normalizeTaskInput(input)
  assertValidTaskInput(normalized)

  const now = Date.now()
  if (normalized.id) {
    const existingIndex = tasksCache.findIndex((task) => task.id === normalized.id)
    if (existingIndex < 0) {
      throw new Error(`Task not found: ${normalized.id}`)
    }

    const previous = tasksCache[existingIndex]
    const updated: SchedulerTask = {
      ...previous,
      name: normalized.name,
      cron: normalized.cron,
      prompt: normalized.prompt,
      workingDirectory: normalized.workingDirectory,
      enabled: normalized.enabled,
      yoloMode: normalized.yoloMode,
      updatedAt: now,
    }
    tasksCache[existingIndex] = updated
    if (!updated.enabled || updated.cron !== previous.cron) {
      pendingCronRunsByTaskId.delete(updated.id)
    }
    loadValidationErrorsByTaskId.delete(updated.id)
    writeTasksToDisk(tasksCache)
    const runtime = runtimeByTaskId.get(updated.id) ?? createRuntime()
    if (runtime.lastError?.startsWith(INVALID_CRON_ERROR_PREFIX)) {
      runtime.lastStatus = 'idle'
      runtime.lastError = null
      runtime.lastDurationMs = null
      runtime.lastRunTrigger = null
      runtime.lastScheduledMinuteKey = null
      runtime.lastBackfillMinutes = null
    }
    runtimeByTaskId.set(updated.id, runtime)
    broadcastSchedulerUpdate()
    return toTaskWithRuntime(updated)
  }

  const task: SchedulerTask = {
    id: nextTaskId(),
    name: normalized.name,
    cron: normalized.cron,
    prompt: normalized.prompt,
    workingDirectory: normalized.workingDirectory,
    enabled: normalized.enabled,
    yoloMode: normalized.yoloMode,
    createdAt: now,
    updatedAt: now,
  }
  tasksCache = [...tasksCache, task]
  loadValidationErrorsByTaskId.delete(task.id)
  runtimeByTaskId.set(task.id, createRuntime())
  writeTasksToDisk(tasksCache)
  broadcastSchedulerUpdate()
  return toTaskWithRuntime(task)
}

function deleteTask(taskId: string): void {
  if (!taskId) throw new Error('Task id is required')

  tasksCache = tasksCache.filter((task) => task.id !== taskId)
  runtimeByTaskId.delete(taskId)
  pendingCronRunsByTaskId.delete(taskId)
  cronDispatchInFlightByTaskId.delete(taskId)
  loadValidationErrorsByTaskId.delete(taskId)
  cronParseCache.clear()

  const runningProc = runningProcessByTaskId.get(taskId)
  if (runningProc) {
    try {
      runningProc.kill('SIGTERM')
      scheduleSchedulerForceKill(taskId, runningProc, 'delete')
    } catch (err) {
      logMainError('scheduler.process.stop_failed', err, { taskId, reason: 'delete' })
      scheduleSchedulerForceKill(taskId, runningProc, 'delete')
    }
  }

  writeTasksToDisk(tasksCache)
  broadcastSchedulerUpdate()
}

async function runTask(
  task: SchedulerTask,
  trigger: SchedulerRunTrigger,
  runContext: SchedulerRunContext = {
    scheduledForMinuteKey: null,
    scheduledForTimestamp: null,
    backfillMinutes: null,
  }
): Promise<boolean> {
  if (runningProcessByTaskId.has(task.id)) return false

  const effectiveScheduledMinuteKey = trigger === 'cron'
    ? (runContext.scheduledForMinuteKey ?? minuteKey(new Date()))
    : null
  const effectiveScheduledTimestamp = trigger === 'cron'
    ? (runContext.scheduledForTimestamp ?? new Date().toISOString())
    : null
  const effectiveBackfillMinutes = trigger === 'cron'
    ? Math.max(0, runContext.backfillMinutes ?? 0)
    : null

  let cwdStat: fs.Stats
  try {
    cwdStat = fs.statSync(task.workingDirectory)
  } catch {
    const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
    runtime.lastRunAt = Date.now()
    runtime.lastStatus = 'error'
    runtime.lastError = `Directory not found: ${task.workingDirectory}`
    runtime.lastDurationMs = null
    runtime.lastRunTrigger = trigger
    runtime.lastScheduledMinuteKey = effectiveScheduledMinuteKey
    runtime.lastBackfillMinutes = effectiveBackfillMinutes
    runtimeByTaskId.set(task.id, runtime)
    broadcastSchedulerUpdate()
    return true
  }
  if (!cwdStat.isDirectory()) {
    const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
    runtime.lastRunAt = Date.now()
    runtime.lastStatus = 'error'
    runtime.lastError = `Not a directory: ${task.workingDirectory}`
    runtime.lastDurationMs = null
    runtime.lastRunTrigger = trigger
    runtime.lastScheduledMinuteKey = effectiveScheduledMinuteKey
    runtime.lastBackfillMinutes = effectiveBackfillMinutes
    runtimeByTaskId.set(task.id, runtime)
    broadcastSchedulerUpdate()
    return true
  }

  const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
  runtime.lastRunAt = Date.now()
  runtime.lastStatus = 'running'
  runtime.lastError = null
  runtime.lastDurationMs = null
  runtime.lastRunTrigger = trigger
  if (effectiveScheduledMinuteKey) {
    runtime.lastRunMinuteKey = effectiveScheduledMinuteKey
  }
  runtime.lastScheduledMinuteKey = effectiveScheduledMinuteKey
  runtime.lastBackfillMinutes = effectiveBackfillMinutes
  runtimeByTaskId.set(task.id, runtime)
  broadcastSchedulerUpdate()

  const startedAtIso = new Date().toISOString()
  const runPrompt = [
    `[Scheduled task run]`,
    `Task: ${task.name}`,
    `Trigger: ${trigger}`,
    `Timestamp: ${startedAtIso}`,
    ...(effectiveScheduledTimestamp ? [`Scheduled timestamp: ${effectiveScheduledTimestamp}`] : []),
    ...(effectiveScheduledMinuteKey ? [`Scheduled minute key: ${effectiveScheduledMinuteKey}`] : []),
    ...(effectiveBackfillMinutes != null ? [`Backfill minutes: ${effectiveBackfillMinutes}`] : []),
    '',
    task.prompt,
  ].join('\n')

  const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose']
  if (task.yoloMode) {
    args.push('--dangerously-skip-permissions')
  }
  const profileResolution = resolveClaudeProfileForDirectory(task.workingDirectory)
  if (profileResolution.cliArgs.length > 0) {
    args.push(...profileResolution.cliArgs)
  }
  if (profileResolution.missingPathWarnings.length > 0) {
    for (const warning of profileResolution.missingPathWarnings) {
      logMainEvent('scheduler.profile.warning', {
        taskId: task.id,
        taskName: task.name,
        warning,
      }, 'warn')
    }
  }
  args.push('--', runPrompt)

  const binaryPath = getClaudeBinaryPath()
  const env = getClaudeEnvironment()
  const maxRuntimeMs = resolveSchedulerRunMaxRuntimeMs()
  const timeoutSeconds = Math.max(1, Math.round(maxRuntimeMs / 1000))

  logMainEvent('scheduler.run.start', {
    taskId: task.id,
    taskName: task.name,
    trigger,
    scheduledMinuteKey: effectiveScheduledMinuteKey,
    scheduledTimestamp: effectiveScheduledTimestamp,
    backfillMinutes: effectiveBackfillMinutes,
    cwd: task.workingDirectory,
    yoloMode: task.yoloMode,
    profileId: profileResolution.profile.id,
    profileName: profileResolution.profile.name,
    profileSource: profileResolution.source,
    profileRulePrefix: profileResolution.matchedRulePathPrefix,
  })

  const processResult = await runManagedProcess({
    command: binaryPath,
    args,
    spawnOptions: {
      cwd: task.workingDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    maxRuntimeMs,
    forceKillTimeoutMs: SCHEDULER_FORCE_KILL_TIMEOUT_MS,
    timeoutErrorMessage: `Scheduled run timed out after ${timeoutSeconds}s`,
    stderrTailMaxChars: 4_000,
    onSpawned: (proc) => {
      clearSchedulerForceKillTimer(task.id)
      runningProcessByTaskId.set(task.id, proc)
      broadcastSchedulerUpdate()
    },
    onStdoutLine: (line, controls) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (parsed.type === 'result') {
          const isError = parsed.is_error === true
          const errorMessage = typeof parsed.error === 'string' ? parsed.error : null
          if (isError) {
            controls.setResultError(errorMessage ?? 'Scheduled run returned an error')
          }
        }
      } catch {
        // Ignore non-JSON lines.
      }
    },
    onTimeout: () => {
      logMainEvent('scheduler.run.timeout', {
        taskId: task.id,
        taskName: task.name,
        trigger,
        scheduledMinuteKey: effectiveScheduledMinuteKey,
        scheduledTimestamp: effectiveScheduledTimestamp,
        backfillMinutes: effectiveBackfillMinutes,
        maxRuntimeMs,
      }, 'warn')
    },
    onTimeoutSigtermFailed: (err) => {
      logMainError('scheduler.run.timeout_sigterm_failed', err, {
        taskId: task.id,
        taskName: task.name,
        trigger,
      })
    },
    onForceKill: () => {
      logMainEvent('scheduler.run.force_kill', {
        taskId: task.id,
        taskName: task.name,
        trigger,
        scheduledMinuteKey: effectiveScheduledMinuteKey,
        scheduledTimestamp: effectiveScheduledTimestamp,
        backfillMinutes: effectiveBackfillMinutes,
        reason: 'timeout',
      }, 'warn')
    },
    onForceKillFailed: (err) => {
      logMainError('scheduler.run.force_kill_failed', err, {
        taskId: task.id,
        taskName: task.name,
        trigger,
        reason: 'timeout',
      })
    },
  })

  clearSchedulerForceKillTimer(task.id)
  runningProcessByTaskId.delete(task.id)

  const completedAt = Date.now()
  const duration = processResult.durationMs
  if (!taskExists(task.id)) {
    runtimeByTaskId.delete(task.id)
    logMainEvent('scheduler.run.skip_runtime_write_deleted_task', {
      taskId: task.id,
      taskName: task.name,
      trigger,
      scheduledMinuteKey: effectiveScheduledMinuteKey,
      scheduledTimestamp: effectiveScheduledTimestamp,
      backfillMinutes: effectiveBackfillMinutes,
      durationMs: duration,
      code: processResult.exitCode,
      error: processResult.spawnError?.message ?? processResult.resultError ?? null,
    })
    broadcastSchedulerUpdate()
    return true
  }

  const finalRuntime = runtimeByTaskId.get(task.id) ?? createRuntime()
  finalRuntime.lastRunAt = completedAt
  finalRuntime.lastDurationMs = duration

  if (processResult.spawnError) {
    finalRuntime.lastStatus = 'error'
    finalRuntime.lastError = processResult.spawnError.message
    runtimeByTaskId.set(task.id, finalRuntime)
    logMainError('scheduler.run.spawn_error', processResult.spawnError, {
      taskId: task.id,
      taskName: task.name,
      trigger,
      scheduledMinuteKey: effectiveScheduledMinuteKey,
      scheduledTimestamp: effectiveScheduledTimestamp,
      backfillMinutes: effectiveBackfillMinutes,
    })
    broadcastSchedulerUpdate()
    return true
  }

  if (processResult.exitCode === 0 && !processResult.resultError) {
    finalRuntime.lastStatus = 'success'
    finalRuntime.lastError = null
    logMainEvent('scheduler.run.success', {
      taskId: task.id,
      taskName: task.name,
      trigger,
      scheduledMinuteKey: effectiveScheduledMinuteKey,
      scheduledTimestamp: effectiveScheduledTimestamp,
      backfillMinutes: effectiveBackfillMinutes,
      durationMs: duration,
    })
  } else {
    finalRuntime.lastStatus = 'error'
    finalRuntime.lastError = processResult.resultError
      ?? (processResult.stderrTail.trim() || `Claude exited with code ${processResult.exitCode ?? 'null'}`)
    logMainEvent('scheduler.run.error', {
      taskId: task.id,
      taskName: task.name,
      trigger,
      scheduledMinuteKey: effectiveScheduledMinuteKey,
      scheduledTimestamp: effectiveScheduledTimestamp,
      backfillMinutes: effectiveBackfillMinutes,
      durationMs: duration,
      code: processResult.exitCode,
      error: finalRuntime.lastError,
    }, 'error')
  }

  runtimeByTaskId.set(task.id, finalRuntime)
  broadcastSchedulerUpdate()
  return true
}

async function runTaskById(taskId: string, trigger: SchedulerRunTrigger): Promise<SchedulerTaskWithRuntime> {
  const task = tasksCache.find((entry) => entry.id === taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  await runTask(task, trigger)
  const latestTask = tasksCache.find((entry) => entry.id === taskId)
  if (!latestTask) {
    throw new Error(`Task deleted during run: ${taskId}`)
  }
  return toTaskWithRuntime(latestTask)
}

function resolveSchedulerTickWindow(now: Date): {
  minuteTimestampsMs: number[]
  backfillWindowMinutes: number
  clamped: boolean
  gapMinutes: number
} {
  const nowMinuteTimestampMs = floorToMinuteTimestamp(now.getTime())
  const backfillWindowMinutes = resolveSchedulerBackfillWindowMinutes()

  if (lastSuccessfulSchedulerTickAt == null) {
    return {
      minuteTimestampsMs: [nowMinuteTimestampMs],
      backfillWindowMinutes,
      clamped: false,
      gapMinutes: 0,
    }
  }

  const previousMinuteTimestampMs = floorToMinuteTimestamp(lastSuccessfulSchedulerTickAt)
  const gapMinutes = Math.max(0, Math.floor((nowMinuteTimestampMs - previousMinuteTimestampMs) / 60_000))
  let startMinuteTimestampMs = previousMinuteTimestampMs + 60_000
  const earliestAllowedMinuteTimestampMs = nowMinuteTimestampMs - (backfillWindowMinutes * 60_000)
  let clamped = false
  if (startMinuteTimestampMs < earliestAllowedMinuteTimestampMs) {
    startMinuteTimestampMs = earliestAllowedMinuteTimestampMs
    clamped = true
  }

  if (startMinuteTimestampMs > nowMinuteTimestampMs) {
    return {
      minuteTimestampsMs: [],
      backfillWindowMinutes,
      clamped,
      gapMinutes,
    }
  }

  const minuteTimestampsMs: number[] = []
  for (let cursor = startMinuteTimestampMs; cursor <= nowMinuteTimestampMs; cursor += 60_000) {
    minuteTimestampsMs.push(cursor)
  }
  return {
    minuteTimestampsMs,
    backfillWindowMinutes,
    clamped,
    gapMinutes,
  }
}

function enqueuePendingCronRun(task: SchedulerTask, minuteTimestampMs: number, nowMinuteTimestampMs: number): boolean {
  const runMinuteKey = minuteKey(new Date(minuteTimestampMs))
  const runtime = runtimeByTaskId.get(task.id) ?? createRuntime()
  if (runtime.lastRunMinuteKey === runMinuteKey) return false

  const pendingRuns = pendingCronRunsByTaskId.get(task.id) ?? []
  if (pendingRuns.some((pending) => pending.minuteKey === runMinuteKey)) {
    return false
  }

  pendingRuns.push({
    minuteTimestampMs,
    minuteKey: runMinuteKey,
  })
  pendingRuns.sort((a, b) => a.minuteTimestampMs - b.minuteTimestampMs)
  pendingCronRunsByTaskId.set(task.id, pendingRuns)

  const backfillMinutes = Math.max(0, Math.floor((nowMinuteTimestampMs - minuteTimestampMs) / 60_000))
  if (backfillMinutes > 0) {
    logMainEvent('scheduler.tick.backfill_queued', {
      taskId: task.id,
      taskName: task.name,
      minuteKey: runMinuteKey,
      backfillMinutes,
      queuedRuns: pendingRuns.length,
    })
  }
  return true
}

function dispatchPendingCronRun(taskId: string): void {
  if (cronDispatchInFlightByTaskId.has(taskId)) return
  if (runningProcessByTaskId.has(taskId)) return

  const pendingRuns = pendingCronRunsByTaskId.get(taskId)
  if (!pendingRuns || pendingRuns.length === 0) {
    pendingCronRunsByTaskId.delete(taskId)
    return
  }

  const task = tasksCache.find((entry) => entry.id === taskId)
  if (!task || !task.enabled) {
    pendingCronRunsByTaskId.delete(taskId)
    return
  }

  const nextRun = pendingRuns.shift()
  if (!nextRun) {
    pendingCronRunsByTaskId.delete(taskId)
    return
  }
  if (pendingRuns.length === 0) {
    pendingCronRunsByTaskId.delete(taskId)
  }

  const nowMinuteTimestampMs = floorToMinuteTimestamp(Date.now())
  const backfillMinutes = Math.max(0, Math.floor((nowMinuteTimestampMs - nextRun.minuteTimestampMs) / 60_000))
  const runContext: SchedulerRunContext = {
    scheduledForMinuteKey: nextRun.minuteKey,
    scheduledForTimestamp: new Date(nextRun.minuteTimestampMs).toISOString(),
    backfillMinutes,
  }

  cronDispatchInFlightByTaskId.add(taskId)
  void runTask(task, 'cron', runContext).then((started) => {
    if (!started) {
      const queue = pendingCronRunsByTaskId.get(taskId) ?? []
      queue.unshift(nextRun)
      pendingCronRunsByTaskId.set(taskId, queue)
    }
  }).catch((err) => {
    const queue = pendingCronRunsByTaskId.get(taskId) ?? []
    queue.unshift(nextRun)
    pendingCronRunsByTaskId.set(taskId, queue)
    logMainError('scheduler.tick.run_task_failed', err, {
      taskId: task.id,
      taskName: task.name,
      minuteKey: nextRun.minuteKey,
    })
  }).finally(() => {
    cronDispatchInFlightByTaskId.delete(taskId)
    dispatchPendingCronRun(taskId)
  })
}

async function schedulerTick(): Promise<void> {
  if (schedulerTickInFlight) {
    if (!schedulerTickRequested) {
      logMainEvent('scheduler.tick.coalesced', { reason: 'in_flight' })
    }
    schedulerTickRequested = true
    return
  }
  schedulerTickInFlight = true

  const now = new Date()
  const nowMinuteTimestampMs = floorToMinuteTimestamp(now.getTime())
  const tickWindow = resolveSchedulerTickWindow(now)
  try {
    let queuedRunCount = 0
    let queuedBackfillRunCount = 0
    const tasksWithNewRuns = new Set<string>()

    for (const minuteTimestampMs of tickWindow.minuteTimestampsMs) {
      const minuteDate = new Date(minuteTimestampMs)
      for (const task of tasksCache) {
        if (!task.enabled) continue

        const parsed = getParsedCron(task.cron)
        if (!parsed) continue
        if (!matchesCronDate(parsed, minuteDate)) continue

        if (enqueuePendingCronRun(task, minuteTimestampMs, nowMinuteTimestampMs)) {
          queuedRunCount += 1
          if (minuteTimestampMs < nowMinuteTimestampMs) {
            queuedBackfillRunCount += 1
          }
          tasksWithNewRuns.add(task.id)
        }
      }
    }

    const taskIdsToDispatch = new Set<string>([
      ...tasksWithNewRuns,
      ...pendingCronRunsByTaskId.keys(),
    ])
    for (const taskId of taskIdsToDispatch) {
      dispatchPendingCronRun(taskId)
    }

    if (tickWindow.clamped) {
      logMainEvent('scheduler.tick.backfill_clamped', {
        backfillWindowMinutes: tickWindow.backfillWindowMinutes,
        gapMinutes: tickWindow.gapMinutes,
        nowMinuteKey: minuteKey(new Date(nowMinuteTimestampMs)),
      }, 'warn')
    }

    if (queuedRunCount > 0 || tickWindow.clamped) {
      const firstWindowMinute = tickWindow.minuteTimestampsMs[0]
      const lastWindowMinute = tickWindow.minuteTimestampsMs[tickWindow.minuteTimestampsMs.length - 1]
      logMainEvent('scheduler.tick.window_scanned', {
        scannedMinutes: tickWindow.minuteTimestampsMs.length,
        windowStartMinuteKey: typeof firstWindowMinute === 'number' ? minuteKey(new Date(firstWindowMinute)) : null,
        windowEndMinuteKey: typeof lastWindowMinute === 'number' ? minuteKey(new Date(lastWindowMinute)) : null,
        queuedRunCount,
        queuedBackfillRunCount,
        pendingTaskCount: pendingCronRunsByTaskId.size,
      })
    }
    lastSuccessfulSchedulerTickAt = now.getTime()
  } finally {
    schedulerTickInFlight = false
    if (schedulerTickRequested) {
      schedulerTickRequested = false
      logMainEvent('scheduler.tick.replay', { reason: 'coalesced' })
      kickSchedulerTick()
    }
  }
}

function kickSchedulerTick(): void {
  schedulerTick().catch((err) => {
    logMainError('scheduler.tick.failed', err)
  })
}

function startSchedulerLoop(): void {
  if (schedulerTimer) return

  schedulerTimer = setInterval(() => {
    kickSchedulerTick()
  }, SCHEDULER_TICK_MS)
}

export function setupSchedulerHandlers(): void {
  loadTasksCache()
  startSchedulerLoop()

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('scheduler:list', () => {
    return listTasks()
  })

  ipcMain.handle('scheduler:upsert', async (_event, input: SchedulerTaskInput) => {
    assertAppNotShuttingDown('scheduler:upsert')
    return upsertTask(input)
  })

  ipcMain.handle('scheduler:delete', async (_event, taskId: string) => {
    assertAppNotShuttingDown('scheduler:delete')
    deleteTask(taskId)
  })

  ipcMain.handle('scheduler:runNow', async (_event, taskId: string) => {
    assertAppNotShuttingDown('scheduler:runNow')
    return await runTaskById(taskId, 'manual')
  })

  ipcMain.handle('scheduler:debugRuntimeSize', () => {
    return runtimeByTaskId.size
  })
}

export async function cleanupScheduler(): Promise<void> {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  schedulerTickRequested = false
  schedulerTickInFlight = false
  lastSuccessfulSchedulerTickAt = null
  pendingCronRunsByTaskId.clear()
  cronDispatchInFlightByTaskId.clear()

  const runningEntries = Array.from(runningProcessByTaskId.entries())
  if (runningEntries.length === 0) return

  logMainEvent('scheduler.cleanup.await_processes.start', {
    runningProcessCount: runningEntries.length,
  })

  await Promise.all(runningEntries.map(async ([taskId, proc]) => {
    clearSchedulerForceKillTimer(taskId)
    const result = await terminateManagedProcess({
      process: proc,
      sigtermTimeoutMs: SCHEDULER_FORCE_KILL_TIMEOUT_MS,
      sigkillTimeoutMs: SCHEDULER_FORCE_KILL_TIMEOUT_MS,
      onSigtermSent: () => {
        logMainEvent('scheduler.process.stop.sigterm_sent', { taskId, reason: 'cleanup' })
      },
      onSigtermFailed: (err) => {
        logMainError('scheduler.process.stop_failed', err, { taskId, reason: 'cleanup' })
      },
      onForceKill: () => {
        logMainEvent('scheduler.process.force_kill', { taskId, reason: 'cleanup' }, 'warn')
      },
      onForceKillFailed: (err) => {
        logMainError('scheduler.process.force_kill_failed', err, { taskId, reason: 'cleanup' })
      },
    })

    clearSchedulerForceKillTimer(taskId)
    runningProcessByTaskId.delete(taskId)

    logMainEvent('scheduler.process.stop.completed', {
      taskId,
      reason: 'cleanup',
      exitCode: result.exitCode,
      signalCode: result.signalCode,
      escalatedToSigkill: result.escalatedToSigkill,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    }, result.timedOut ? 'warn' : 'info')
  }))

  logMainEvent('scheduler.cleanup.await_processes.completed', {
    awaitedProcessCount: runningEntries.length,
  })
}
