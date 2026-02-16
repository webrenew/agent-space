import { BrowserWindow, ipcMain } from 'electron'
import { type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logMainError, logMainEvent } from './diagnostics'
import { writeFileAtomicSync } from './atomic-write'
import {
  clearManagedForceKillTimer,
  resolveManagedRuntimeMs,
  runManagedProcess,
  scheduleManagedForceKill,
  terminateManagedProcess,
} from './process-runner'
import { assertAppNotShuttingDown } from './shutdown-state'

type TodoRunnerRunStatus = 'idle' | 'running' | 'success' | 'error'
type TodoRunnerRunTrigger = 'auto' | 'manual'
type TodoItemStatus = 'pending' | 'running' | 'done' | 'error'

interface TodoItemState {
  id: string
  text: string
  status: TodoItemStatus
  attempts: number
  lastError: string | null
  lastRunAt: number | null
  lastDurationMs: number | null
}

interface TodoRunnerJobRecord {
  id: string
  name: string
  prompt: string
  workingDirectory: string
  runnerCommand: string
  enabled: boolean
  yoloMode: boolean
  todos: TodoItemState[]
  createdAt: number
  updatedAt: number
}

interface TodoRunnerJobInput {
  id?: string
  name: string
  prompt: string
  workingDirectory: string
  runnerCommand: string
  enabled: boolean
  yoloMode: boolean
  todoItems: string[]
}

interface TodoRunnerRuntime {
  isRunning: boolean
  lastRunAt: number | null
  lastStatus: TodoRunnerRunStatus
  lastError: string | null
  lastDurationMs: number | null
  lastRunTrigger: TodoRunnerRunTrigger | null
  currentTodoIndex: number | null
}

interface TodoRunnerJobView {
  id: string
  name: string
  prompt: string
  workingDirectory: string
  runnerCommand: string
  enabled: boolean
  yoloMode: boolean
  todoItems: string[]
  createdAt: number
  updatedAt: number
  isRunning: boolean
  lastRunAt: number | null
  lastStatus: TodoRunnerRunStatus
  lastError: string | null
  lastDurationMs: number | null
  lastRunTrigger: TodoRunnerRunTrigger | null
  totalTodos: number
  completedTodos: number
  failedTodos: number
  blockedTodos: number
  currentTodoIndex: number | null
  nextTodoText: string | null
}

interface RunningTodoProcess {
  process: ChildProcess
  todoIndex: number
}

const TODO_RUNNER_DIR = path.join(os.homedir(), '.agent-observer')
const TODO_RUNNER_FILE = path.join(TODO_RUNNER_DIR, 'todo-runner.json')
const TODO_RUNNER_TICK_MS = 5_000
const TODO_RUNNER_DEFAULT_MAX_CONCURRENT_JOBS = 2
const TODO_RUNNER_DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000
const TODO_RUNNER_FORCE_KILL_TIMEOUT_MS = 10_000
const TODO_RUNNER_DISPATCH_DRAIN_TIMEOUT_MS = 5_000
const TODO_RUNNER_ENV_VALUE_MAX_CHARS = 2_048
const TODO_MAX_ATTEMPTS = 3

let handlersRegistered = false
let todoRunnerTimer: NodeJS.Timeout | null = null
let tickInFlight = false
let todoRunnerShuttingDown = false
let jobsCache: TodoRunnerJobRecord[] = []
let nextJobScanIndex = 0

const runtimeByJobId = new Map<string, TodoRunnerRuntime>()
const runningProcessByJobId = new Map<string, RunningTodoProcess>()
const pendingStartByJobId = new Map<string, { todoIndex: number; trigger: TodoRunnerRunTrigger }>()
const runPromiseByJobId = new Map<string, Promise<void>>()
const stoppedByUserJobIds = new Set<string>()
const forceKillTimerByJobId = new Map<string, NodeJS.Timeout>()
const manualRunRequestedJobIds = new Set<string>()

function createRuntime(): TodoRunnerRuntime {
  return {
    isRunning: false,
    lastRunAt: null,
    lastStatus: 'idle',
    lastError: null,
    lastDurationMs: null,
    lastRunTrigger: null,
    currentTodoIndex: null,
  }
}

function resolveTodoRunnerMaxRuntimeMs(): number {
  return resolveManagedRuntimeMs({
    envVarName: 'AGENT_SPACE_TODO_RUNNER_MAX_RUNTIME_MS',
    defaultMs: TODO_RUNNER_DEFAULT_MAX_RUNTIME_MS,
    onInvalidConfig: (rawValue, fallbackMs) => {
      logMainEvent('todo_runner.invalid_timeout_config', {
        rawValue,
        fallbackMs,
      }, 'warn')
    },
  })
}

function resolveTodoRunnerMaxConcurrentJobs(): number {
  const raw = process.env.AGENT_SPACE_TODO_RUNNER_MAX_CONCURRENT_JOBS
  if (!raw) return TODO_RUNNER_DEFAULT_MAX_CONCURRENT_JOBS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logMainEvent('todo_runner.invalid_concurrency_config', {
      rawValue: raw,
      fallback: TODO_RUNNER_DEFAULT_MAX_CONCURRENT_JOBS,
    }, 'warn')
    return TODO_RUNNER_DEFAULT_MAX_CONCURRENT_JOBS
  }
  return parsed
}

function resolveTodoRunnerDispatchDrainTimeoutMs(): number {
  return resolveManagedRuntimeMs({
    envVarName: 'AGENT_SPACE_TODO_RUNNER_DISPATCH_DRAIN_TIMEOUT_MS',
    defaultMs: TODO_RUNNER_DISPATCH_DRAIN_TIMEOUT_MS,
    onInvalidConfig: (rawValue, fallbackMs) => {
      logMainEvent('todo_runner.cleanup.invalid_dispatch_drain_timeout_config', {
        rawValue,
        fallbackMs,
      }, 'warn')
    },
  })
}

export function __testOnlyComputeTodoRunnerAvailableSlots(
  maxConcurrentJobs: number,
  runningJobs: number,
  pendingStartJobs: number
): number {
  return Math.max(0, maxConcurrentJobs - runningJobs - pendingStartJobs)
}

export function __testOnlyIsTodoJobDispatchEligible(isRunning: boolean, isPendingStart: boolean): boolean {
  return __testOnlyCanDispatchTodoRun(false, false, isRunning, isPendingStart)
}

export function __testOnlyCanDispatchTodoRun(
  isShuttingDown: boolean,
  hasRunPromiseInFlight: boolean,
  isRunning: boolean,
  isPendingStart: boolean
): boolean {
  return !(isShuttingDown || hasRunPromiseInFlight || isRunning || isPendingStart)
}

function isJobDispatchEligible(jobId: string): boolean {
  return __testOnlyCanDispatchTodoRun(
    todoRunnerShuttingDown,
    runPromiseByJobId.has(jobId),
    runningProcessByJobId.has(jobId),
    pendingStartByJobId.has(jobId)
  )
}

export async function __testOnlyWaitForTodoRunPromises(
  runPromises: Promise<void>[],
  timeoutMs: number
): Promise<{ drained: boolean; pendingCount: number }> {
  if (runPromises.length === 0) {
    return { drained: true, pendingCount: 0 }
  }

  let timeoutHandle: NodeJS.Timeout | null = null
  let timedOut = false
  try {
    await Promise.race([
      Promise.allSettled(runPromises).then(() => undefined),
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true
          resolve()
        }, Math.max(1, timeoutMs))
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }

  return {
    drained: !timedOut,
    pendingCount: timedOut ? runPromises.length : 0,
  }
}

async function waitForInFlightTodoRuns(timeoutMs: number): Promise<{ drained: boolean; pendingCount: number }> {
  return __testOnlyWaitForTodoRunPromises([...runPromiseByJobId.values()], timeoutMs)
}

function reservePendingStart(jobId: string, todoIndex: number, trigger: TodoRunnerRunTrigger): boolean {
  if (!isJobDispatchEligible(jobId)) return false
  pendingStartByJobId.set(jobId, { todoIndex, trigger })
  return true
}

function releasePendingStart(jobId: string): void {
  pendingStartByJobId.delete(jobId)
}

function limitEnvValue(value: string, maxChars = TODO_RUNNER_ENV_VALUE_MAX_CHARS): {
  value: string
  truncated: boolean
} {
  if (value.length <= maxChars) {
    return { value, truncated: false }
  }
  return { value: value.slice(0, maxChars), truncated: true }
}

function isPayloadTransportSpawnError(err: unknown): err is NodeJS.ErrnoException {
  if (!err || typeof err !== 'object') return false
  const candidate = err as NodeJS.ErrnoException
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  return code === 'E2BIG' || message.includes('e2big') || message.includes('argument list too long')
}

function ensureTodoRunnerDir(): void {
  if (!fs.existsSync(TODO_RUNNER_DIR)) {
    fs.mkdirSync(TODO_RUNNER_DIR, { recursive: true })
  }
}

function broadcastTodoRunnerUpdate(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('todoRunner:updated')
    }
  }
}

function nextJobId(): string {
  return `todo-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function nextTodoId(index: number): string {
  return `item-${Date.now()}-${index}-${Math.floor(Math.random() * 1_000_000)}`
}

function normalizeTodoItems(todoItems: string[]): string[] {
  return todoItems
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeJobInput(input: TodoRunnerJobInput): TodoRunnerJobInput {
  const workingDirectory = input.workingDirectory.trim()
  return {
    id: input.id,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    workingDirectory: workingDirectory ? path.resolve(workingDirectory) : '',
    runnerCommand: input.runnerCommand.trim(),
    enabled: input.enabled === true,
    yoloMode: input.yoloMode === true,
    todoItems: normalizeTodoItems(input.todoItems),
  }
}

function assertValidJobInput(input: TodoRunnerJobInput): void {
  if (!input.name.trim()) throw new Error('Job name is required')
  if (!input.workingDirectory.trim()) throw new Error('Working directory is required')
  if (!input.runnerCommand.trim()) throw new Error('Runner command is required')
  if (input.todoItems.length === 0) throw new Error('At least one todo item is required')

  let stat: fs.Stats
  try {
    stat = fs.statSync(input.workingDirectory)
  } catch {
    throw new Error(`Directory does not exist: ${input.workingDirectory}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${input.workingDirectory}`)
  }
}

function readJobsFromDisk(): TodoRunnerJobRecord[] {
  ensureTodoRunnerDir()
  if (!fs.existsSync(TODO_RUNNER_FILE)) return []

  try {
    const raw = fs.readFileSync(TODO_RUNNER_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown[] }).jobs)
        ? (parsed as { jobs: unknown[] }).jobs
        : []

    const jobs: TodoRunnerJobRecord[] = []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const obj = entry as Record<string, unknown>

      const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? obj.id : nextJobId()
      const name = typeof obj.name === 'string' ? obj.name.trim() : ''
      const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : ''
      const workingDirectory = typeof obj.workingDirectory === 'string'
        ? path.resolve(obj.workingDirectory.trim())
        : ''
      const runnerCommand = typeof obj.runnerCommand === 'string' ? obj.runnerCommand.trim() : ''
      const enabled = obj.enabled === true
      const yoloMode = obj.yoloMode === true
      const createdAt = typeof obj.createdAt === 'number' ? obj.createdAt : Date.now()
      const updatedAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now()
      const todoEntries = Array.isArray(obj.todos) ? obj.todos : []

      const todos: TodoItemState[] = []
      for (let i = 0; i < todoEntries.length; i += 1) {
        const todoEntry = todoEntries[i]
        if (!todoEntry || typeof todoEntry !== 'object') continue
        const todoObj = todoEntry as Record<string, unknown>
        const text = typeof todoObj.text === 'string' ? todoObj.text.trim() : ''
        if (!text) continue
        const statusRaw = typeof todoObj.status === 'string' ? todoObj.status : 'pending'
        const status: TodoItemStatus = statusRaw === 'done' || statusRaw === 'error' || statusRaw === 'running'
          ? statusRaw
          : 'pending'
        todos.push({
          id: typeof todoObj.id === 'string' && todoObj.id.trim().length > 0
            ? todoObj.id
            : nextTodoId(i),
          text,
          status: status === 'running' ? 'pending' : status,
          attempts: typeof todoObj.attempts === 'number' && todoObj.attempts >= 0 ? todoObj.attempts : 0,
          lastError: typeof todoObj.lastError === 'string' ? todoObj.lastError : null,
          lastRunAt: typeof todoObj.lastRunAt === 'number' ? todoObj.lastRunAt : null,
          lastDurationMs: typeof todoObj.lastDurationMs === 'number' ? todoObj.lastDurationMs : null,
        })
      }

      if (!name || !workingDirectory || !runnerCommand || todos.length === 0) continue
      jobs.push({
        id,
        name,
        prompt,
        workingDirectory,
        runnerCommand,
        enabled,
        yoloMode,
        todos,
        createdAt,
        updatedAt,
      })
    }

    return jobs
  } catch (err) {
    logMainError('todo_runner.read.failed', err)
    return []
  }
}

function writeJobsToDisk(jobs: TodoRunnerJobRecord[]): void {
  ensureTodoRunnerDir()
  writeFileAtomicSync(TODO_RUNNER_FILE, JSON.stringify(jobs, null, 2))
}

function loadJobsCache(): void {
  jobsCache = readJobsFromDisk()
  for (const job of jobsCache) {
    if (!runtimeByJobId.has(job.id)) {
      runtimeByJobId.set(job.id, createRuntime())
    }
  }
}

function ensureRuntime(jobId: string): TodoRunnerRuntime {
  const runtime = runtimeByJobId.get(jobId) ?? createRuntime()
  runtimeByJobId.set(jobId, runtime)
  return runtime
}

function clearForceKillTimer(jobId: string): void {
  clearManagedForceKillTimer(forceKillTimerByJobId, jobId)
}

function scheduleForceKill(jobId: string, childProcess: ChildProcess, reason: string): void {
  scheduleManagedForceKill({
    timers: forceKillTimerByJobId,
    key: jobId,
    process: childProcess,
    delayMs: TODO_RUNNER_FORCE_KILL_TIMEOUT_MS,
    onForceKill: () => {
      logMainEvent('todo_runner.process.force_kill', { jobId, reason })
    },
    onForceKillFailed: (err) => {
      logMainError('todo_runner.process.force_kill_failed', err, { jobId, reason })
    },
  })
}

function stopRunningProcess(jobId: string, reason: string): void {
  const running = runningProcessByJobId.get(jobId)
  if (!running) return

  stoppedByUserJobIds.add(jobId)
  try {
    running.process.kill('SIGTERM')
  } catch (err) {
    logMainError('todo_runner.process.stop_failed', err, { jobId, reason })
  }
  scheduleForceKill(jobId, running.process, reason)
}

function findLiveTodo(jobId: string, todoId: string): {
  job: TodoRunnerJobRecord
  todo: TodoItemState | null
} | null {
  const liveJob = jobsCache.find((entry) => entry.id === jobId)
  if (!liveJob) return null
  const liveTodo = liveJob.todos.find((entry) => entry.id === todoId) ?? null
  return { job: liveJob, todo: liveTodo }
}

function mergeTodoStates(todoItems: string[], previousTodos: TodoItemState[]): TodoItemState[] {
  const merged: TodoItemState[] = []

  for (let i = 0; i < todoItems.length; i += 1) {
    const text = todoItems[i]
    const previous = previousTodos[i]

    if (previous && previous.text === text) {
      merged.push({
        ...previous,
        status: previous.status === 'running' ? 'pending' : previous.status,
      })
      continue
    }

    merged.push({
      id: nextTodoId(i),
      text,
      status: 'pending',
      attempts: 0,
      lastError: null,
      lastRunAt: null,
      lastDurationMs: null,
    })
  }

  return merged
}

function hasTodoListChanged(todoItems: string[], previousTodos: TodoItemState[]): boolean {
  if (todoItems.length !== previousTodos.length) return true
  for (let i = 0; i < todoItems.length; i += 1) {
    if (todoItems[i] !== previousTodos[i]?.text) return true
  }
  return false
}

function toJobWithRuntime(job: TodoRunnerJobRecord): TodoRunnerJobView {
  const runtime = ensureRuntime(job.id)
  const totalTodos = job.todos.length
  const completedTodos = job.todos.filter((todo) => todo.status === 'done').length
  const failedTodos = job.todos.filter((todo) => todo.status === 'error').length
  const blockedTodos = job.todos.filter(
    (todo) => todo.status === 'error' && todo.attempts >= TODO_MAX_ATTEMPTS
  ).length

  const nextTodo = job.todos.find(
    (todo) => todo.status !== 'done' && todo.attempts < TODO_MAX_ATTEMPTS
  ) ?? null

  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt,
    workingDirectory: job.workingDirectory,
    runnerCommand: job.runnerCommand,
    enabled: job.enabled,
    yoloMode: job.yoloMode,
    todoItems: job.todos.map((todo) => todo.text),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    isRunning: runtime.isRunning,
    lastRunAt: runtime.lastRunAt,
    lastStatus: runtime.lastStatus,
    lastError: runtime.lastError,
    lastDurationMs: runtime.lastDurationMs,
    lastRunTrigger: runtime.lastRunTrigger,
    totalTodos,
    completedTodos,
    failedTodos,
    blockedTodos,
    currentTodoIndex: runtime.currentTodoIndex,
    nextTodoText: nextTodo?.text ?? null,
  }
}

function listJobs(): TodoRunnerJobView[] {
  return jobsCache
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((job) => toJobWithRuntime(job))
}

function upsertJob(input: TodoRunnerJobInput): TodoRunnerJobView {
  const normalized = normalizeJobInput(input)
  assertValidJobInput(normalized)

  const now = Date.now()

  if (normalized.id) {
    const index = jobsCache.findIndex((job) => job.id === normalized.id)
    if (index < 0) throw new Error(`Job not found: ${normalized.id}`)
    const previous = jobsCache[index]
    if (
      !isJobDispatchEligible(previous.id)
      && hasTodoListChanged(normalized.todoItems, previous.todos)
    ) {
      throw new Error('Cannot edit todo items while job is running. Pause the job and try again.')
    }
    const updated: TodoRunnerJobRecord = {
      ...previous,
      name: normalized.name,
      prompt: normalized.prompt,
      workingDirectory: normalized.workingDirectory,
      runnerCommand: normalized.runnerCommand,
      enabled: normalized.enabled,
      yoloMode: normalized.yoloMode,
      todos: mergeTodoStates(normalized.todoItems, previous.todos),
      updatedAt: now,
    }
    jobsCache[index] = updated
    writeJobsToDisk(jobsCache)
    broadcastTodoRunnerUpdate()
    if (updated.enabled) {
      kickTodoRunner()
    }
    return toJobWithRuntime(updated)
  }

  const created: TodoRunnerJobRecord = {
    id: nextJobId(),
    name: normalized.name,
    prompt: normalized.prompt,
    workingDirectory: normalized.workingDirectory,
    runnerCommand: normalized.runnerCommand,
    enabled: normalized.enabled,
    yoloMode: normalized.yoloMode,
    todos: normalized.todoItems.map((text, index) => ({
      id: nextTodoId(index),
      text,
      status: 'pending',
      attempts: 0,
      lastError: null,
      lastRunAt: null,
      lastDurationMs: null,
    })),
    createdAt: now,
    updatedAt: now,
  }

  jobsCache = [...jobsCache, created]
  runtimeByJobId.set(created.id, createRuntime())
  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
  if (created.enabled) {
    kickTodoRunner()
  }
  return toJobWithRuntime(created)
}

function findJobById(jobId: string): TodoRunnerJobRecord {
  const job = jobsCache.find((entry) => entry.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  return job
}

function deleteJob(jobId: string): void {
  if (!jobId) throw new Error('Job id is required')

  stopRunningProcess(jobId, 'delete')
  manualRunRequestedJobIds.delete(jobId)

  jobsCache = jobsCache.filter((job) => job.id !== jobId)
  runtimeByJobId.delete(jobId)
  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
}

function startJob(jobId: string): TodoRunnerJobView {
  const job = findJobById(jobId)
  job.enabled = true
  if (isJobDispatchEligible(jobId)) {
    manualRunRequestedJobIds.add(jobId)
  }
  job.updatedAt = Date.now()
  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
  kickTodoRunner()
  return toJobWithRuntime(job)
}

function pauseJob(jobId: string): TodoRunnerJobView {
  const job = findJobById(jobId)
  job.enabled = false
  job.updatedAt = Date.now()
  manualRunRequestedJobIds.delete(jobId)

  stopRunningProcess(jobId, 'pause')

  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
  return toJobWithRuntime(job)
}

function resetJob(jobId: string): TodoRunnerJobView {
  const job = findJobById(jobId)
  job.todos = job.todos.map((todo) => ({
    ...todo,
    status: 'pending',
    attempts: 0,
    lastError: null,
    lastRunAt: null,
    lastDurationMs: null,
  }))
  job.updatedAt = Date.now()
  manualRunRequestedJobIds.delete(jobId)

  const runtime = ensureRuntime(job.id)
  runtime.lastStatus = 'idle'
  runtime.lastError = null
  runtime.lastRunAt = null
  runtime.lastDurationMs = null
  runtime.currentTodoIndex = null
  runtime.lastRunTrigger = null

  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
  if (job.enabled) {
    kickTodoRunner()
  }
  return toJobWithRuntime(job)
}

export function __testOnlyCollectStaleRunningTodoIndices(
  todos: Array<Pick<TodoItemState, 'status'>>
): number[] {
  const staleIndexes: number[] = []
  for (let index = 0; index < todos.length; index += 1) {
    if (todos[index]?.status === 'running') {
      staleIndexes.push(index)
    }
  }
  return staleIndexes
}

export function __testOnlyFindNextRunnableTodoIndex(
  todos: Array<Pick<TodoItemState, 'status' | 'attempts'>>
): number | null {
  for (let index = 0; index < todos.length; index += 1) {
    const todo = todos[index]
    if (!todo) continue
    if (todo.status === 'running') continue
    if (todo.status === 'done') continue
    if (todo.attempts >= TODO_MAX_ATTEMPTS) continue
    return index
  }
  return null
}

function reconcileStaleRunningTodos(job: TodoRunnerJobRecord): number {
  if (runningProcessByJobId.has(job.id) || pendingStartByJobId.has(job.id)) return 0
  const staleIndexes = __testOnlyCollectStaleRunningTodoIndices(job.todos)
  if (staleIndexes.length === 0) return 0

  for (const staleIndex of staleIndexes) {
    const staleTodo = job.todos[staleIndex]
    if (staleTodo) {
      staleTodo.status = 'pending'
    }
  }

  logMainEvent('todo_runner.todo.recovered_stale_running', {
    jobId: job.id,
    jobName: job.name,
    recoveredCount: staleIndexes.length,
    recoveredIndexes: staleIndexes,
  }, 'warn')
  return staleIndexes.length
}

function findNextRunnableTodoIndex(job: TodoRunnerJobRecord): number | null {
  return __testOnlyFindNextRunnableTodoIndex(job.todos)
}

function buildRunnerPayload(job: TodoRunnerJobRecord, todo: TodoItemState, todoIndex: number) {
  return {
    job: {
      id: job.id,
      name: job.name,
      prompt: job.prompt,
      workingDirectory: job.workingDirectory,
      yoloMode: job.yoloMode,
    },
    todo: {
      id: todo.id,
      text: todo.text,
      index: todoIndex + 1,
      total: job.todos.length,
      attempts: todo.attempts,
      maxAttempts: TODO_MAX_ATTEMPTS,
    },
    todoItems: job.todos.map((entry, index) => ({
      id: entry.id,
      text: entry.text,
      status: entry.status,
      index: index + 1,
    })),
  }
}

async function runTodo(job: TodoRunnerJobRecord, todoIndex: number, trigger: TodoRunnerRunTrigger): Promise<void> {
  if (todoRunnerShuttingDown) {
    releasePendingStart(job.id)
    return
  }
  if (runningProcessByJobId.has(job.id)) {
    releasePendingStart(job.id)
    return
  }
  const todo = job.todos[todoIndex]
  if (!todo) {
    releasePendingStart(job.id)
    return
  }
  const todoId = todo.id

  let cwdStat: fs.Stats
  try {
    cwdStat = fs.statSync(job.workingDirectory)
  } catch {
    releasePendingStart(job.id)
    const runtime = ensureRuntime(job.id)
    runtime.lastStatus = 'error'
    runtime.lastError = `Directory not found: ${job.workingDirectory}`
    runtime.lastRunAt = Date.now()
    runtime.lastRunTrigger = trigger
    job.enabled = false
    writeJobsToDisk(jobsCache)
    broadcastTodoRunnerUpdate()
    return
  }
  if (!cwdStat.isDirectory()) {
    releasePendingStart(job.id)
    const runtime = ensureRuntime(job.id)
    runtime.lastStatus = 'error'
    runtime.lastError = `Not a directory: ${job.workingDirectory}`
    runtime.lastRunAt = Date.now()
    runtime.lastRunTrigger = trigger
    job.enabled = false
    writeJobsToDisk(jobsCache)
    broadcastTodoRunnerUpdate()
    return
  }

  if (todoRunnerShuttingDown) {
    releasePendingStart(job.id)
    return
  }

  const startedAt = Date.now()
  const runtime = ensureRuntime(job.id)
  runtime.isRunning = true
  runtime.lastStatus = 'running'
  runtime.lastError = null
  runtime.lastDurationMs = null
  runtime.currentTodoIndex = todoIndex
  runtime.lastRunTrigger = trigger

  todo.status = 'running'
  todo.attempts += 1
  todo.lastError = null
  todo.lastRunAt = startedAt
  job.updatedAt = startedAt

  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()

  const payload = buildRunnerPayload(job, todo, todoIndex)
  const payloadJson = JSON.stringify(payload)
  const todoTextEnv = limitEnvValue(todo.text)
  const promptEnv = limitEnvValue(job.prompt)
  const env = {
    ...process.env,
    AGENT_SPACE_TODO_PAYLOAD_TRANSPORT: 'stdin',
    AGENT_SPACE_TODO_PAYLOAD_BYTES: String(Buffer.byteLength(payloadJson, 'utf8')),
    AGENT_SPACE_TODO_TEXT: todoTextEnv.value,
    AGENT_SPACE_TODO_TEXT_TRUNCATED: todoTextEnv.truncated ? '1' : '0',
    AGENT_SPACE_TODO_INDEX: String(todoIndex + 1),
    AGENT_SPACE_TODO_TOTAL: String(job.todos.length),
    AGENT_SPACE_TODO_PROMPT: promptEnv.value,
    AGENT_SPACE_TODO_PROMPT_TRUNCATED: promptEnv.truncated ? '1' : '0',
    AGENT_SPACE_TODO_JOB_ID: job.id,
    AGENT_SPACE_TODO_JOB_NAME: job.name,
    AGENT_SPACE_YOLO_MODE: job.yoloMode ? '1' : '0',
  }

  const maxRuntimeMs = resolveTodoRunnerMaxRuntimeMs()
  const timeoutSeconds = Math.max(1, Math.round(maxRuntimeMs / 1000))
  const processResult = await runManagedProcess({
    command: job.runnerCommand,
    spawnOptions: {
      cwd: job.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    },
    stdinPayload: `${payloadJson}\n`,
    maxRuntimeMs,
    forceKillTimeoutMs: TODO_RUNNER_FORCE_KILL_TIMEOUT_MS,
    timeoutErrorMessage: `Todo runner timed out after ${timeoutSeconds}s`,
    onSpawned: (process) => {
      releasePendingStart(job.id)
      runningProcessByJobId.set(job.id, { process, todoIndex })
      broadcastTodoRunnerUpdate()
    },
    onStdoutLine: (line, controls) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (parsed.status === 'error') {
          controls.setResultError(typeof parsed.error === 'string'
            ? parsed.error
            : 'Runner reported status=error')
        }
        if (parsed.type === 'result' && parsed.is_error === true) {
          controls.setResultError(typeof parsed.error === 'string'
            ? parsed.error
            : 'Runner reported result.is_error=true')
        }
      } catch {
        // Ignore non-JSON lines.
      }
    },
    onTimeout: () => {
      logMainEvent('todo_runner.todo.timeout', {
        jobId: job.id,
        jobName: job.name,
        todoId,
        todoIndex,
        trigger,
        maxRuntimeMs,
      }, 'warn')
    },
    onTimeoutSigtermFailed: (err) => {
      logMainError('todo_runner.todo.timeout_sigterm_failed', err, {
        jobId: job.id,
        jobName: job.name,
        todoId,
        todoIndex,
        trigger,
      })
    },
    onForceKill: () => {
      logMainEvent('todo_runner.process.force_kill', { jobId: job.id, reason: 'timeout' })
    },
    onForceKillFailed: (err) => {
      logMainError('todo_runner.process.force_kill_failed', err, { jobId: job.id, reason: 'timeout' })
    },
  })

  releasePendingStart(job.id)
  runningProcessByJobId.delete(job.id)
  clearForceKillTimer(job.id)
  const completedAt = Date.now()
  const durationMs = processResult.durationMs
  const wasStoppedByUser = stoppedByUserJobIds.has(job.id)
  const payloadTransportError = isPayloadTransportSpawnError(processResult.spawnError)
  const payloadTransportErrorMessage = 'Runner launch exceeded OS payload limits; payload stays on stdin and todo was not consumed'
  if (wasStoppedByUser) {
    stoppedByUserJobIds.delete(job.id)
  }

  const liveState = findLiveTodo(job.id, todoId)
  if (!liveState) {
    stoppedByUserJobIds.delete(job.id)
    kickTodoRunner()
    return
  }

  const runtimeNext = ensureRuntime(job.id)
  runtimeNext.isRunning = false
  runtimeNext.currentTodoIndex = null
  runtimeNext.lastRunAt = completedAt
  runtimeNext.lastDurationMs = durationMs
  runtimeNext.lastRunTrigger = trigger

  if (processResult.spawnError) {
    if (liveState.todo) {
      if (wasStoppedByUser) {
        liveState.todo.status = 'pending'
        liveState.todo.attempts = Math.max(0, liveState.todo.attempts - 1)
        liveState.todo.lastError = null
      } else if (payloadTransportError) {
        liveState.todo.status = 'pending'
        liveState.todo.attempts = Math.max(0, liveState.todo.attempts - 1)
        liveState.todo.lastError = payloadTransportErrorMessage
      } else {
        liveState.todo.status = 'error'
        liveState.todo.lastError = `Failed to spawn runner: ${processResult.spawnError.message}`
      }
      liveState.todo.lastDurationMs = durationMs
    }

    if (!wasStoppedByUser && !payloadTransportError) {
      liveState.job.enabled = false
    }
    liveState.job.updatedAt = completedAt

    runtimeNext.lastStatus = wasStoppedByUser ? 'idle' : 'error'
    runtimeNext.lastError = wasStoppedByUser
      ? null
      : payloadTransportError
        ? payloadTransportErrorMessage
        : liveState.todo?.lastError ?? `Failed to spawn runner: ${processResult.spawnError.message}`
    runtimeByJobId.set(liveState.job.id, runtimeNext)

    if (payloadTransportError) {
      logMainEvent('todo_runner.todo.spawn_payload_error', {
        jobId: job.id,
        jobName: job.name,
        todoIndex,
        trigger,
        code: isPayloadTransportSpawnError(processResult.spawnError)
          ? processResult.spawnError.code ?? null
          : null,
        error: processResult.spawnError.message,
      }, 'warn')
    } else {
      logMainError('todo_runner.todo.spawn_error', processResult.spawnError, {
        jobId: job.id,
        jobName: job.name,
        todoIndex,
        trigger,
      })
    }

    writeJobsToDisk(jobsCache)
    broadcastTodoRunnerUpdate()
    kickTodoRunner()
    return
  }

  let errorMessage: string | null = null
  if (wasStoppedByUser) {
    errorMessage = 'Stopped by user'
  } else if (processResult.resultError) {
    errorMessage = processResult.resultError
  } else if (processResult.exitCode !== 0) {
    errorMessage = processResult.stderrTail.trim()
      || processResult.stdoutTail.trim()
      || `Runner exited with code ${processResult.exitCode ?? 'null'}`
  }

  if (wasStoppedByUser) {
    if (liveState.todo) {
      liveState.todo.status = 'pending'
      liveState.todo.attempts = Math.max(0, liveState.todo.attempts - 1)
      liveState.todo.lastError = null
    }
    runtimeNext.lastStatus = 'idle'
    runtimeNext.lastError = null
  } else if (!errorMessage) {
    if (liveState.todo) {
      liveState.todo.status = 'done'
      liveState.todo.lastError = null
    }
    runtimeNext.lastStatus = 'success'
    runtimeNext.lastError = null
    logMainEvent('todo_runner.todo.success', {
      jobId: liveState.job.id,
      jobName: liveState.job.name,
      todoIndex,
      trigger,
      durationMs,
    })
  } else {
    if (liveState.todo) {
      liveState.todo.status = 'error'
      liveState.todo.lastError = errorMessage
    }
    runtimeNext.lastStatus = 'error'
    runtimeNext.lastError = errorMessage
    logMainEvent('todo_runner.todo.error', {
      jobId: liveState.job.id,
      jobName: liveState.job.name,
      todoIndex,
      trigger,
      durationMs,
      timedOut: processResult.timedOut,
      error: errorMessage,
    }, 'error')

    if (liveState.todo && liveState.todo.attempts >= TODO_MAX_ATTEMPTS) {
      liveState.job.enabled = false
      runtimeNext.lastError = `${errorMessage} (attempt limit reached, job paused)`
    }
  }

  if (liveState.todo) {
    liveState.todo.lastDurationMs = durationMs
  }
  liveState.job.updatedAt = completedAt
  runtimeByJobId.set(liveState.job.id, runtimeNext)
  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()

  // Fill open worker slots promptly when a todo attempt exits.
  kickTodoRunner()
}

async function todoRunnerTick(): Promise<void> {
  if (todoRunnerShuttingDown) return
  if (tickInFlight) return
  tickInFlight = true
  try {
    if (jobsCache.length === 0) {
      nextJobScanIndex = 0
      return
    }

    const maxConcurrentJobs = resolveTodoRunnerMaxConcurrentJobs()
    const availableSlots = __testOnlyComputeTodoRunnerAvailableSlots(
      maxConcurrentJobs,
      runningProcessByJobId.size,
      pendingStartByJobId.size
    )

    let recoveredStaleTodoCount = 0
    for (const job of jobsCache) {
      recoveredStaleTodoCount += reconcileStaleRunningTodos(job)
    }
    if (recoveredStaleTodoCount > 0) {
      writeJobsToDisk(jobsCache)
      broadcastTodoRunnerUpdate()
    }
    if (availableSlots <= 0) return

    const jobCount = jobsCache.length
    const startIndex = ((nextJobScanIndex % jobCount) + jobCount) % jobCount
    let startedCount = 0

    for (let offset = 0; offset < jobCount && startedCount < availableSlots; offset += 1) {
      const index = (startIndex + offset) % jobCount
      const job = jobsCache[index]
      if (!job.enabled) continue
      if (!isJobDispatchEligible(job.id)) continue

      const nextIndex = findNextRunnableTodoIndex(job)
      if (nextIndex === null) {
        manualRunRequestedJobIds.delete(job.id)
        const runtime = ensureRuntime(job.id)
        const allDone = job.todos.every((todo) => todo.status === 'done')
        if (allDone && runtime.lastStatus !== 'success') {
          runtime.lastStatus = 'success'
          runtime.lastError = null
          runtimeByJobId.set(job.id, runtime)
          broadcastTodoRunnerUpdate()
        }
        continue
      }

      const trigger: TodoRunnerRunTrigger = manualRunRequestedJobIds.has(job.id) ? 'manual' : 'auto'
      manualRunRequestedJobIds.delete(job.id)
      if (!reservePendingStart(job.id, nextIndex, trigger)) continue

      nextJobScanIndex = (index + 1) % jobCount
      startedCount += 1
      const runPromise = runTodo(job, nextIndex, trigger).catch((err) => {
        releasePendingStart(job.id)
        logMainError('todo_runner.todo.run_failed', err, {
          jobId: job.id,
          jobName: job.name,
          todoIndex: nextIndex,
          trigger,
        })
      }).finally(() => {
        runPromiseByJobId.delete(job.id)
      })
      runPromiseByJobId.set(job.id, runPromise)
    }
  } finally {
    tickInFlight = false
  }
}

function kickTodoRunner(): void {
  todoRunnerTick().catch((err) => {
    logMainError('todo_runner.tick.failed', err)
  })
}

function startTodoRunnerLoop(): void {
  if (todoRunnerTimer) return
  todoRunnerTimer = setInterval(() => {
    kickTodoRunner()
  }, TODO_RUNNER_TICK_MS)
  kickTodoRunner()
}

export function setupTodoRunnerHandlers(): void {
  todoRunnerShuttingDown = false
  loadJobsCache()
  startTodoRunnerLoop()

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('todoRunner:list', () => {
    return listJobs()
  })

  ipcMain.handle('todoRunner:upsert', async (_event, input: TodoRunnerJobInput) => {
    assertAppNotShuttingDown('todoRunner:upsert')
    return upsertJob(input)
  })

  ipcMain.handle('todoRunner:delete', async (_event, jobId: string) => {
    assertAppNotShuttingDown('todoRunner:delete')
    deleteJob(jobId)
  })

  ipcMain.handle('todoRunner:start', async (_event, jobId: string) => {
    assertAppNotShuttingDown('todoRunner:start')
    return startJob(jobId)
  })

  ipcMain.handle('todoRunner:pause', async (_event, jobId: string) => {
    assertAppNotShuttingDown('todoRunner:pause')
    return pauseJob(jobId)
  })

  ipcMain.handle('todoRunner:reset', async (_event, jobId: string) => {
    assertAppNotShuttingDown('todoRunner:reset')
    return resetJob(jobId)
  })
}

export async function cleanupTodoRunner(): Promise<void> {
  todoRunnerShuttingDown = true
  if (todoRunnerTimer) {
    clearInterval(todoRunnerTimer)
    todoRunnerTimer = null
  }
  tickInFlight = false

  const dispatchDrainTimeoutMs = resolveTodoRunnerDispatchDrainTimeoutMs()
  const inFlightRunCount = runPromiseByJobId.size
  if (inFlightRunCount > 0) {
    logMainEvent('todo_runner.cleanup.await_dispatches.start', {
      inFlightRunCount,
      timeoutMs: dispatchDrainTimeoutMs,
    })

    const dispatchDrain = await waitForInFlightTodoRuns(dispatchDrainTimeoutMs)
    if (!dispatchDrain.drained) {
      logMainEvent('todo_runner.cleanup.await_dispatches.timeout', {
        timeoutMs: dispatchDrainTimeoutMs,
        pendingRunCount: dispatchDrain.pendingCount,
      }, 'warn')
    } else {
      logMainEvent('todo_runner.cleanup.await_dispatches.completed', {
        awaitedRunCount: inFlightRunCount,
      })
    }
  }

  const runningEntries = Array.from(runningProcessByJobId.entries())
  if (runningEntries.length > 0) {
    logMainEvent('todo_runner.cleanup.await_processes.start', {
      runningProcessCount: runningEntries.length,
    })
  }

  await Promise.all(runningEntries.map(async ([jobId, running]) => {
    stoppedByUserJobIds.add(jobId)
    clearForceKillTimer(jobId)
    const result = await terminateManagedProcess({
      process: running.process,
      sigtermTimeoutMs: TODO_RUNNER_FORCE_KILL_TIMEOUT_MS,
      sigkillTimeoutMs: TODO_RUNNER_FORCE_KILL_TIMEOUT_MS,
      onSigtermSent: () => {
        logMainEvent('todo_runner.process.stop.sigterm_sent', { jobId, reason: 'cleanup' })
      },
      onSigtermFailed: (err) => {
        logMainError('todo_runner.process.stop_failed', err, { jobId, reason: 'cleanup' })
      },
      onForceKill: () => {
        logMainEvent('todo_runner.process.force_kill', { jobId, reason: 'cleanup' })
      },
      onForceKillFailed: (err) => {
        logMainError('todo_runner.process.force_kill_failed', err, { jobId, reason: 'cleanup' })
      },
    })

    clearForceKillTimer(jobId)
    runningProcessByJobId.delete(jobId)

    logMainEvent('todo_runner.process.stop.completed', {
      jobId,
      reason: 'cleanup',
      exitCode: result.exitCode,
      signalCode: result.signalCode,
      escalatedToSigkill: result.escalatedToSigkill,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    }, result.timedOut ? 'warn' : 'info')
  }))

  if (runningEntries.length > 0) {
    logMainEvent('todo_runner.cleanup.await_processes.completed', {
      awaitedProcessCount: runningEntries.length,
    })
  }

  runningProcessByJobId.clear()
  pendingStartByJobId.clear()
  runPromiseByJobId.clear()
  manualRunRequestedJobIds.clear()
  nextJobScanIndex = 0
}
