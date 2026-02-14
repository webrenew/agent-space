import { BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logMainError, logMainEvent } from './diagnostics'

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

const TODO_RUNNER_DIR = path.join(os.homedir(), '.agent-space')
const TODO_RUNNER_FILE = path.join(TODO_RUNNER_DIR, 'todo-runner.json')
const TODO_RUNNER_TICK_MS = 5_000
const TODO_MAX_ATTEMPTS = 3

let handlersRegistered = false
let todoRunnerTimer: NodeJS.Timeout | null = null
let tickInFlight = false
let jobsCache: TodoRunnerJobRecord[] = []

const runtimeByJobId = new Map<string, TodoRunnerRuntime>()
const runningProcessByJobId = new Map<string, RunningTodoProcess>()
const stoppedByUserJobIds = new Set<string>()

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

function appendTail(current: string, text: string, max = 8_000): string {
  const combined = `${current}${text}`
  if (combined.length <= max) return combined
  return combined.slice(combined.length - max)
}

function normalizeTodoItems(todoItems: string[]): string[] {
  return todoItems
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeJobInput(input: TodoRunnerJobInput): TodoRunnerJobInput {
  return {
    id: input.id,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    workingDirectory: path.resolve(input.workingDirectory.trim()),
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
  fs.writeFileSync(TODO_RUNNER_FILE, JSON.stringify(jobs, null, 2), 'utf-8')
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

  const running = runningProcessByJobId.get(jobId)
  if (running) {
    stoppedByUserJobIds.add(jobId)
    try {
      running.process.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  jobsCache = jobsCache.filter((job) => job.id !== jobId)
  runtimeByJobId.delete(jobId)
  writeJobsToDisk(jobsCache)
  broadcastTodoRunnerUpdate()
}

function startJob(jobId: string): TodoRunnerJobView {
  const job = findJobById(jobId)
  job.enabled = true
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

  const running = runningProcessByJobId.get(jobId)
  if (running) {
    stoppedByUserJobIds.add(jobId)
    try {
      running.process.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

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

function findNextRunnableTodoIndex(job: TodoRunnerJobRecord): number | null {
  for (let index = 0; index < job.todos.length; index += 1) {
    const todo = job.todos[index]
    if (todo.status === 'running') {
      todo.status = 'pending'
    }
    if (todo.status === 'done') continue
    if (todo.attempts >= TODO_MAX_ATTEMPTS) continue
    return index
  }
  return null
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
  if (runningProcessByJobId.has(job.id)) return
  const todo = job.todos[todoIndex]
  if (!todo) return

  let cwdStat: fs.Stats
  try {
    cwdStat = fs.statSync(job.workingDirectory)
  } catch {
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
  const env = {
    ...process.env,
    AGENT_SPACE_TODO_PAYLOAD: JSON.stringify(payload),
    AGENT_SPACE_TODO_TEXT: todo.text,
    AGENT_SPACE_TODO_INDEX: String(todoIndex + 1),
    AGENT_SPACE_TODO_TOTAL: String(job.todos.length),
    AGENT_SPACE_TODO_PROMPT: job.prompt,
    AGENT_SPACE_TODO_JOB_ID: job.id,
    AGENT_SPACE_TODO_JOB_NAME: job.name,
    AGENT_SPACE_YOLO_MODE: job.yoloMode ? '1' : '0',
  }

  const proc = spawn(job.runnerCommand, {
    cwd: job.workingDirectory,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  })

  runningProcessByJobId.set(job.id, { process: proc, todoIndex })
  broadcastTodoRunnerUpdate()

  try {
    proc.stdin?.write(`${JSON.stringify(payload, null, 2)}\n`)
    proc.stdin?.end()
  } catch {
    // Ignore stdin write failures; process may not read stdin.
  }

  const rl = proc.stdout ? createInterface({ input: proc.stdout }) : null
  let stdoutTail = ''
  let stderrTail = ''
  let resultError: string | null = null

  rl?.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    stdoutTail = appendTail(stdoutTail, `${trimmed}\n`)

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (parsed.status === 'error') {
        resultError = typeof parsed.error === 'string'
          ? parsed.error
          : 'Runner reported status=error'
      }
      if (parsed.type === 'result' && parsed.is_error === true) {
        resultError = typeof parsed.error === 'string'
          ? parsed.error
          : 'Runner reported result.is_error=true'
      }
    } catch {
      // Ignore non-JSON lines.
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = appendTail(stderrTail, chunk.toString())
  })

  await new Promise<void>((resolve) => {
    proc.on('exit', (code) => {
      rl?.close()
      runningProcessByJobId.delete(job.id)

      const completedAt = Date.now()
      const durationMs = completedAt - startedAt
      const runtimeNext = ensureRuntime(job.id)
      runtimeNext.isRunning = false
      runtimeNext.currentTodoIndex = null
      runtimeNext.lastRunAt = completedAt
      runtimeNext.lastDurationMs = durationMs
      runtimeNext.lastRunTrigger = trigger

      const wasStoppedByUser = stoppedByUserJobIds.has(job.id)
      if (wasStoppedByUser) {
        stoppedByUserJobIds.delete(job.id)
      }

      let errorMessage: string | null = null
      if (wasStoppedByUser) {
        errorMessage = 'Stopped by user'
      } else if (resultError) {
        errorMessage = resultError
      } else if (code !== 0) {
        errorMessage = stderrTail.trim() || stdoutTail.trim() || `Runner exited with code ${code ?? 'null'}`
      }

      if (!errorMessage) {
        todo.status = 'done'
        todo.lastError = null
        runtimeNext.lastStatus = 'success'
        runtimeNext.lastError = null
        logMainEvent('todo_runner.todo.success', {
          jobId: job.id,
          jobName: job.name,
          todoIndex,
          trigger,
          durationMs,
        })
      } else {
        todo.status = 'error'
        todo.lastError = errorMessage
        runtimeNext.lastStatus = 'error'
        runtimeNext.lastError = errorMessage
        logMainEvent('todo_runner.todo.error', {
          jobId: job.id,
          jobName: job.name,
          todoIndex,
          trigger,
          durationMs,
          error: errorMessage,
        }, 'error')

        if (todo.attempts >= TODO_MAX_ATTEMPTS) {
          job.enabled = false
          runtimeNext.lastError = `${errorMessage} (attempt limit reached, job paused)`
        }
      }

      todo.lastDurationMs = durationMs
      job.updatedAt = completedAt
      runtimeByJobId.set(job.id, runtimeNext)
      writeJobsToDisk(jobsCache)
      broadcastTodoRunnerUpdate()
      resolve()
    })

    proc.on('error', (err) => {
      rl?.close()
      runningProcessByJobId.delete(job.id)
      const completedAt = Date.now()
      const durationMs = completedAt - startedAt

      todo.status = 'error'
      todo.lastError = `Failed to spawn runner: ${err.message}`
      todo.lastDurationMs = durationMs
      job.enabled = false
      job.updatedAt = completedAt

      const runtimeNext = ensureRuntime(job.id)
      runtimeNext.isRunning = false
      runtimeNext.currentTodoIndex = null
      runtimeNext.lastRunAt = completedAt
      runtimeNext.lastDurationMs = durationMs
      runtimeNext.lastRunTrigger = trigger
      runtimeNext.lastStatus = 'error'
      runtimeNext.lastError = todo.lastError
      runtimeByJobId.set(job.id, runtimeNext)

      logMainError('todo_runner.todo.spawn_error', err, {
        jobId: job.id,
        jobName: job.name,
        todoIndex,
        trigger,
      })

      writeJobsToDisk(jobsCache)
      broadcastTodoRunnerUpdate()
      resolve()
    })
  })
}

async function todoRunnerTick(): Promise<void> {
  if (tickInFlight) return
  tickInFlight = true
  try {
    if (runningProcessByJobId.size > 0) return

    for (const job of jobsCache) {
      if (!job.enabled) continue
      if (runningProcessByJobId.has(job.id)) continue

      const nextIndex = findNextRunnableTodoIndex(job)
      if (nextIndex === null) {
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

      await runTodo(job, nextIndex, 'auto')
      break
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
  loadJobsCache()
  startTodoRunnerLoop()

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('todoRunner:list', () => {
    return listJobs()
  })

  ipcMain.handle('todoRunner:upsert', async (_event, input: TodoRunnerJobInput) => {
    return upsertJob(input)
  })

  ipcMain.handle('todoRunner:delete', async (_event, jobId: string) => {
    deleteJob(jobId)
  })

  ipcMain.handle('todoRunner:start', async (_event, jobId: string) => {
    return startJob(jobId)
  })

  ipcMain.handle('todoRunner:pause', async (_event, jobId: string) => {
    return pauseJob(jobId)
  })

  ipcMain.handle('todoRunner:reset', async (_event, jobId: string) => {
    return resetJob(jobId)
  })
}

export function cleanupTodoRunner(): void {
  if (todoRunnerTimer) {
    clearInterval(todoRunnerTimer)
    todoRunnerTimer = null
  }

  for (const [jobId, running] of runningProcessByJobId) {
    stoppedByUserJobIds.add(jobId)
    try {
      running.process.kill('SIGTERM')
    } catch {
      // ignore
    }
  }
  runningProcessByJobId.clear()
}
