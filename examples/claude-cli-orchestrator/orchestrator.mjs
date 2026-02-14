#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, execFileSync } from 'child_process'
import { createInterface } from 'readline'

const DEFAULTS = {
  pollMs: 10_000,
  maxAttempts: 3,
  retryDelayMs: 30_000,
  tasksFile: './tasks.json',
  stateFile: './.claude-orchestrator-state.json',
  logsDir: './.claude-orchestrator-logs',
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv
  const options = {}

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) continue

    const key = token.slice(2)
    const next = rest[i + 1]
    if (next && !next.startsWith('--')) {
      options[key] = next
      i += 1
    } else {
      options[key] = true
    }
  }

  return { command, options }
}

function printUsage() {
  console.log(`
Claude CLI Orchestrator

Usage:
  node orchestrator.mjs run [--tasks <file>] [--state <file>] [--logs <dir>] [--poll-ms <n>]
  node orchestrator.mjs once [--tasks <file>] [--state <file>] [--logs <dir>]
  node orchestrator.mjs add --name <name> --cwd <dir> [--prompt <text> | --prompt-file <file>] [options]
  node orchestrator.mjs status [--tasks <file>] [--state <file>]

Task options for "add":
  --id <id>
  --model <model-id>
  --system-prompt <text>
  --allowed-tools "<tool1,tool2>"
  --dangerously-skip-permissions
  --max-attempts <n>
  --retry-delay-ms <n>
  --run-timeout-ms <n>
  --repeat-delay-ms <n>
`)
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`)
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempFile = `${filePath}.tmp`
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(tempFile, filePath)
}

function normalizePath(p) {
  if (!p || typeof p !== 'string') return ''
  return path.resolve(p.trim())
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  return fallback
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

function toTaskArray(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.tasks)) return raw.tasks
  return []
}

function loadTasks(tasksFile) {
  const raw = readJsonFile(tasksFile, { tasks: [] })
  const taskArray = toTaskArray(raw)
  const usedIds = new Set()
  const tasks = []

  for (let i = 0; i < taskArray.length; i += 1) {
    const input = taskArray[i]
    if (!input || typeof input !== 'object') continue

    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const workingDirectory = normalizePath(input.workingDirectory)
    if (!name || !prompt || !workingDirectory) continue

    let id = typeof input.id === 'string' ? slugify(input.id) : ''
    if (!id) id = slugify(name) || `task-${i + 1}`
    while (usedIds.has(id)) {
      id = `${id}-${Math.floor(Math.random() * 1000)}`
    }
    usedIds.add(id)

    const allowedTools = Array.isArray(input.allowedTools)
      ? input.allowedTools.filter((tool) => typeof tool === 'string' && tool.trim().length > 0)
      : []

    tasks.push({
      id,
      name,
      prompt,
      workingDirectory,
      enabled: input.enabled !== false,
      model: typeof input.model === 'string' ? input.model.trim() : '',
      systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '',
      allowedTools,
      dangerouslySkipPermissions: input.dangerouslySkipPermissions === true,
      maxAttempts: parsePositiveInt(input.maxAttempts, DEFAULTS.maxAttempts),
      retryDelayMs: parsePositiveInt(input.retryDelayMs, DEFAULTS.retryDelayMs),
      runTimeoutMs: parsePositiveInt(input.runTimeoutMs, 0),
      repeatDelayMs: parsePositiveInt(input.repeatDelayMs, 0),
      successRegex: typeof input.successRegex === 'string' ? input.successRegex : '',
    })
  }

  return tasks
}

function saveTasks(tasksFile, tasks) {
  writeJsonFile(tasksFile, { tasks })
}

function createEmptyState() {
  return {
    version: 1,
    tasks: {},
    runs: [],
  }
}

function loadState(stateFile) {
  const raw = readJsonFile(stateFile, createEmptyState())
  if (!raw || typeof raw !== 'object') return createEmptyState()
  if (!raw.tasks || typeof raw.tasks !== 'object') raw.tasks = {}
  if (!Array.isArray(raw.runs)) raw.runs = []
  return raw
}

function saveState(stateFile, state) {
  writeJsonFile(stateFile, state)
}

function ensureTaskRuntime(state, taskId) {
  const current = state.tasks[taskId]
  if (current && typeof current === 'object') return current

  const runtime = {
    status: 'pending',
    attempts: 0,
    lastRunStartedAt: null,
    lastRunEndedAt: null,
    lastDurationMs: null,
    lastError: null,
    lastExitCode: null,
    nextEligibleAt: 0,
    lastRunId: null,
    lastLogFile: null,
  }
  state.tasks[taskId] = runtime
  return runtime
}

function reconcileState(state, tasks) {
  const validTaskIds = new Set(tasks.map((task) => task.id))

  for (const task of tasks) {
    const runtime = ensureTaskRuntime(state, task.id)
    if (runtime.status === 'running') {
      runtime.status = 'error'
      runtime.lastError = 'Orchestrator restarted while this task was running'
      runtime.nextEligibleAt = Date.now()
      runtime.lastRunEndedAt = Date.now()
    }
  }

  for (const taskId of Object.keys(state.tasks)) {
    if (!validTaskIds.has(taskId)) {
      delete state.tasks[taskId]
    }
  }
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toISOString()
}

function printStatus(tasks, state) {
  if (tasks.length === 0) {
    console.log('No tasks configured.')
    return
  }

  console.log(`Tasks: ${tasks.length}`)
  for (const task of tasks) {
    const runtime = ensureTaskRuntime(state, task.id)
    console.log(
      `- ${task.id} | ${task.name} | status=${runtime.status} | attempts=${runtime.attempts}/${task.maxAttempts} | next=${formatTime(runtime.nextEligibleAt)}`
    )
    if (runtime.lastError) {
      console.log(`  lastError: ${runtime.lastError}`)
    }
  }
}

function taskIsRunnable(task, runtime, now) {
  if (!task.enabled) return false
  if (runtime.status === 'running') return false
  if (runtime.nextEligibleAt && runtime.nextEligibleAt > now) return false
  if (runtime.status === 'success') return false
  if (runtime.status === 'pending') return true
  if (runtime.status === 'error') return runtime.attempts < task.maxAttempts
  return true
}

function resolveClaudeBinary() {
  if (process.env.CLAUDE_BIN && process.env.CLAUDE_BIN.trim()) {
    return process.env.CLAUDE_BIN.trim()
  }

  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // continue
    }
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const resolved = execFileSync(shell, ['-ilc', 'which claude'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    if (resolved) return resolved
  } catch {
    // continue
  }

  return 'claude'
}

function getEnhancedEnv() {
  const home = os.homedir()
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ]
  const currentPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
  return {
    ...process.env,
    PATH: `${extraPaths.join(':')}:${currentPath}`,
  }
}

function buildRunPrompt(task, attemptNumber) {
  return [
    '[Orchestrated Claude Code run]',
    `Task: ${task.name}`,
    `Task ID: ${task.id}`,
    `Attempt: ${attemptNumber}/${task.maxAttempts}`,
    `Timestamp: ${new Date().toISOString()}`,
    '',
    task.prompt,
  ].join('\n')
}

function appendToTail(tail, text, maxLength = 200_000) {
  const next = `${tail}${text}`
  if (next.length <= maxLength) return next
  return next.slice(next.length - maxLength)
}

function runTask(task, runtime, { logsDir }) {
  return new Promise((resolve) => {
    let cwdStat
    try {
      cwdStat = fs.statSync(task.workingDirectory)
    } catch {
      resolve({
        ok: false,
        error: `Directory not found: ${task.workingDirectory}`,
        exitCode: null,
        durationMs: 0,
        logFile: null,
      })
      return
    }
    if (!cwdStat.isDirectory()) {
      resolve({
        ok: false,
        error: `Not a directory: ${task.workingDirectory}`,
        exitCode: null,
        durationMs: 0,
        logFile: null,
      })
      return
    }

    fs.mkdirSync(logsDir, { recursive: true })
    const runId = `${task.id}-${Date.now()}`
    const logFile = path.join(logsDir, `${runId}.jsonl`)
    const logStream = fs.createWriteStream(logFile, { flags: 'a' })
    const startedAt = Date.now()
    const attemptNumber = runtime.attempts
    const prompt = buildRunPrompt(task, attemptNumber)

    const args = ['-p', '--output-format', 'stream-json', '--verbose']
    if (task.model) {
      args.push('--model', task.model)
    }
    if (task.systemPrompt) {
      args.push('--append-system-prompt', task.systemPrompt)
    }
    if (Array.isArray(task.allowedTools) && task.allowedTools.length > 0) {
      args.push('--allowedTools', ...task.allowedTools)
    }
    if (task.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    args.push('--', prompt)

    const binaryPath = resolveClaudeBinary()
    const proc = spawn(binaryPath, args, {
      cwd: task.workingDirectory,
      env: getEnhancedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    let outputTail = ''
    let resultError = null
    let timedOut = false
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      logStream.end()
      resolve(result)
    }

    const timeoutId = task.runTimeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            proc.kill('SIGTERM')
          } catch {
            // ignore
          }
          setTimeout(() => {
            try {
              proc.kill('SIGKILL')
            } catch {
              // ignore
            }
          }, 5000)
        }, task.runTimeoutMs)
      : null

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      logStream.write(`${trimmed}\n`)
      outputTail = appendToTail(outputTail, `${trimmed}\n`)

      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.type === 'result' && parsed.is_error === true) {
          resultError = typeof parsed.error === 'string' ? parsed.error : 'Result returned is_error=true'
        }
      } catch {
        // ignore non-JSON
      }
    })

    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderr = appendToTail(stderr, text, 4_000)
      outputTail = appendToTail(outputTail, text)
      const stderrEvent = JSON.stringify({ type: 'stderr', data: text.replace(/\n/g, '\\n') })
      logStream.write(`${stderrEvent}\n`)
    })

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      rl.close()
      finish({
        ok: false,
        error: `Failed to spawn claude: ${error.message}`,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        logFile,
      })
    })

    proc.on('exit', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      rl.close()

      let error = null
      if (timedOut) {
        error = `Timed out after ${task.runTimeoutMs}ms`
      } else if (resultError) {
        error = resultError
      } else if (code !== 0) {
        error = stderr.trim() || `Claude exited with code ${code ?? 'null'}`
      }

      if (!error && task.successRegex) {
        try {
          const regex = new RegExp(task.successRegex, 'm')
          if (!regex.test(outputTail)) {
            error = `successRegex did not match task output: ${task.successRegex}`
          }
        } catch (regexError) {
          error = `Invalid successRegex: ${regexError.message}`
        }
      }

      finish({
        ok: !error,
        error,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        logFile,
      })
    })
  })
}

function pushRunHistory(state, run) {
  state.runs.push(run)
  if (state.runs.length > 500) {
    state.runs.splice(0, state.runs.length - 500)
  }
}

async function runNextTask(tasks, state, options) {
  const now = Date.now()
  const nextTask = tasks.find((task) => {
    const runtime = ensureTaskRuntime(state, task.id)
    return taskIsRunnable(task, runtime, now)
  })

  if (!nextTask) return false

  const runtime = ensureTaskRuntime(state, nextTask.id)
  runtime.attempts += 1
  runtime.status = 'running'
  runtime.lastRunStartedAt = Date.now()
  runtime.lastRunEndedAt = null
  runtime.lastDurationMs = null
  runtime.lastError = null
  runtime.lastExitCode = null
  runtime.lastRunId = `${nextTask.id}-${runtime.attempts}-${Date.now()}`

  saveState(options.stateFile, state)

  console.log(
    `[run] ${nextTask.name} (${nextTask.id}) attempt ${runtime.attempts}/${nextTask.maxAttempts}`
  )

  const result = await runTask(nextTask, runtime, options)
  const endedAt = Date.now()

  runtime.lastRunEndedAt = endedAt
  runtime.lastDurationMs = result.durationMs
  runtime.lastExitCode = result.exitCode
  runtime.lastLogFile = result.logFile

  if (result.ok) {
    if (nextTask.repeatDelayMs > 0) {
      runtime.status = 'pending'
      runtime.nextEligibleAt = endedAt + nextTask.repeatDelayMs
      runtime.lastError = null
      console.log(
        `[ok] ${nextTask.name} succeeded; next run at ${new Date(runtime.nextEligibleAt).toISOString()}`
      )
    } else {
      runtime.status = 'success'
      runtime.nextEligibleAt = Number.MAX_SAFE_INTEGER
      runtime.lastError = null
      console.log(`[ok] ${nextTask.name} succeeded`)
    }
  } else {
    runtime.status = 'error'
    runtime.lastError = result.error || 'Unknown error'
    if (runtime.attempts < nextTask.maxAttempts) {
      runtime.nextEligibleAt = endedAt + nextTask.retryDelayMs
      console.log(
        `[error] ${nextTask.name}: ${runtime.lastError} (retry at ${new Date(runtime.nextEligibleAt).toISOString()})`
      )
    } else {
      runtime.nextEligibleAt = Number.MAX_SAFE_INTEGER
      console.log(`[error] ${nextTask.name}: ${runtime.lastError} (no retries left)`)
    }
  }

  pushRunHistory(state, {
    runId: runtime.lastRunId,
    taskId: nextTask.id,
    taskName: nextTask.name,
    status: runtime.status,
    attempt: runtime.attempts,
    startedAt: runtime.lastRunStartedAt,
    endedAt: runtime.lastRunEndedAt,
    durationMs: runtime.lastDurationMs,
    exitCode: runtime.lastExitCode,
    error: runtime.lastError,
    logFile: runtime.lastLogFile,
  })

  saveState(options.stateFile, state)
  return true
}

function readPromptFromArgs(options) {
  if (typeof options.prompt === 'string' && options.prompt.trim()) {
    return options.prompt.trim()
  }
  if (typeof options['prompt-file'] === 'string' && options['prompt-file'].trim()) {
    const file = normalizePath(options['prompt-file'])
    return fs.readFileSync(file, 'utf8').trim()
  }
  return ''
}

function parseAllowedTools(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function addTaskCommand(options) {
  const tasksFile = normalizePath(options.tasks || DEFAULTS.tasksFile)
  const name = typeof options.name === 'string' ? options.name.trim() : ''
  const workingDirectory = normalizePath(options.cwd || options.workingDirectory)
  const prompt = readPromptFromArgs(options)

  if (!name) {
    throw new Error('--name is required')
  }
  if (!workingDirectory) {
    throw new Error('--cwd is required')
  }
  if (!prompt) {
    throw new Error('Either --prompt or --prompt-file is required')
  }

  let cwdStat
  try {
    cwdStat = fs.statSync(workingDirectory)
  } catch {
    throw new Error(`Working directory does not exist: ${workingDirectory}`)
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${workingDirectory}`)
  }

  const raw = readJsonFile(tasksFile, { tasks: [] })
  const taskArray = toTaskArray(raw)
  const id = slugify(options.id || name) || `task-${Date.now()}`
  const hasDuplicate = taskArray.some((task) => task && typeof task === 'object' && String(task.id) === id)
  if (hasDuplicate) {
    throw new Error(`Task id already exists: ${id}`)
  }

  const newTask = {
    id,
    name,
    prompt,
    workingDirectory,
    enabled: options.enabled === undefined ? true : parseBoolean(options.enabled, true),
    model: typeof options.model === 'string' ? options.model.trim() : '',
    systemPrompt: typeof options['system-prompt'] === 'string' ? options['system-prompt'].trim() : '',
    allowedTools: parseAllowedTools(options['allowed-tools']),
    dangerouslySkipPermissions: parseBoolean(options['dangerously-skip-permissions'], false),
    maxAttempts: parsePositiveInt(options['max-attempts'], DEFAULTS.maxAttempts),
    retryDelayMs: parsePositiveInt(options['retry-delay-ms'], DEFAULTS.retryDelayMs),
    runTimeoutMs: parsePositiveInt(options['run-timeout-ms'], 0),
    repeatDelayMs: parsePositiveInt(options['repeat-delay-ms'], 0),
    successRegex: typeof options['success-regex'] === 'string' ? options['success-regex'] : '',
  }

  taskArray.push(newTask)
  saveTasks(tasksFile, taskArray)

  console.log(`Added task "${newTask.name}" (${newTask.id}) to ${tasksFile}`)
}

async function runCommand(command, options) {
  const tasksFile = normalizePath(options.tasks || DEFAULTS.tasksFile)
  const stateFile = normalizePath(options.state || DEFAULTS.stateFile)
  const logsDir = normalizePath(options.logs || DEFAULTS.logsDir)
  const pollMs = parsePositiveInt(options['poll-ms'], DEFAULTS.pollMs)

  if (!fs.existsSync(tasksFile)) {
    throw new Error(`Tasks file not found: ${tasksFile}`)
  }

  let keepRunning = true
  process.on('SIGINT', () => {
    keepRunning = false
    console.log('\nReceived SIGINT. Stopping orchestrator...')
  })

  while (keepRunning) {
    const tasks = loadTasks(tasksFile)
    const state = loadState(stateFile)
    reconcileState(state, tasks)
    saveState(stateFile, state)

    if (command === 'status') {
      printStatus(tasks, state)
      return
    }

    const ranTask = await runNextTask(tasks, state, { stateFile, logsDir })

    if (command === 'once') {
      if (!ranTask) {
        console.log('No runnable task found.')
      }
      return
    }

    if (!ranTask) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))

  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage()
    return
  }

  if (command === 'add') {
    addTaskCommand(options)
    return
  }

  if (command === 'run' || command === 'once' || command === 'status') {
    await runCommand(command, options)
    return
  }

  printUsage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`)
  process.exitCode = 1
})
