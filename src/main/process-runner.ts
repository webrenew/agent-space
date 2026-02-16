import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { createInterface } from 'readline'

function appendTail(current: string, text: string, max: number): string {
  const combined = `${current}${text}`
  if (combined.length <= max) return combined
  return combined.slice(combined.length - max)
}

export function resolveManagedRuntimeMs(options: {
  envVarName: string
  defaultMs: number
  onInvalidConfig: (rawValue: string, fallbackMs: number) => void
}): number {
  const raw = process.env[options.envVarName]
  if (!raw) return options.defaultMs
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    options.onInvalidConfig(raw, options.defaultMs)
    return options.defaultMs
  }
  return parsed
}

export function clearManagedForceKillTimer(
  timers: Map<string, NodeJS.Timeout>,
  key: string
): void {
  const timer = timers.get(key)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(key)
}

export function scheduleManagedForceKill(options: {
  timers: Map<string, NodeJS.Timeout>
  key: string
  process: ChildProcess
  delayMs: number
  onForceKill: () => void
  onForceKillFailed: (error: unknown) => void
}): void {
  clearManagedForceKillTimer(options.timers, options.key)
  const timer = setTimeout(() => {
    options.timers.delete(options.key)
    try {
      if (options.process.exitCode !== null || options.process.signalCode !== null) return
      options.process.kill('SIGKILL')
      options.onForceKill()
    } catch (error) {
      options.onForceKillFailed(error)
    }
  }, options.delayMs)
  options.timers.set(options.key, timer)
}

export interface RunManagedProcessOptions {
  command: string
  args?: string[]
  spawnOptions: SpawnOptions
  stdinPayload?: string
  maxRuntimeMs: number
  forceKillTimeoutMs: number
  timeoutErrorMessage: string
  stdoutTailMaxChars?: number
  stderrTailMaxChars?: number
  onSpawned?: (process: ChildProcess) => void
  onStdoutLine?: (
    line: string,
    controls: {
      setResultError: (errorMessage: string | null) => void
      getResultError: () => string | null
    }
  ) => void
  onTimeout?: () => void
  onTimeoutSigtermFailed?: (error: unknown) => void
  onForceKill?: () => void
  onForceKillFailed?: (error: unknown) => void
}

export interface RunManagedProcessResult {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  spawnError: Error | null
  timedOut: boolean
  resultError: string | null
  stdoutTail: string
  stderrTail: string
  durationMs: number
}

export async function runManagedProcess(
  options: RunManagedProcessOptions
): Promise<RunManagedProcessResult> {
  const startedAt = Date.now()
  const stdoutLimit = options.stdoutTailMaxChars ?? 8_000
  const stderrLimit = options.stderrTailMaxChars ?? 8_000

  let processRef: ChildProcess
  try {
    processRef = spawn(options.command, options.args ?? [], options.spawnOptions)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return {
      exitCode: null,
      signalCode: null,
      spawnError: err,
      timedOut: false,
      resultError: null,
      stdoutTail: '',
      stderrTail: '',
      durationMs: Date.now() - startedAt,
    }
  }

  options.onSpawned?.(processRef)

  if (options.stdinPayload !== undefined) {
    try {
      processRef.stdin?.write(options.stdinPayload)
      processRef.stdin?.end()
    } catch {
      // Ignore stdin write failures; not every process consumes stdin.
    }
  }

  const rl = processRef.stdout ? createInterface({ input: processRef.stdout }) : null
  let stdoutTail = ''
  let stderrTail = ''
  let resultError: string | null = null
  let timedOut = false
  let runtimeTimer: NodeJS.Timeout | null = null
  let forceKillTimer: NodeJS.Timeout | null = null
  let settled = false

  const clearTimers = () => {
    if (runtimeTimer) {
      clearTimeout(runtimeTimer)
      runtimeTimer = null
    }
    if (forceKillTimer) {
      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }
  }

  runtimeTimer = setTimeout(() => {
    if (processRef.exitCode !== null || processRef.signalCode !== null) return
    timedOut = true
    resultError = options.timeoutErrorMessage
    options.onTimeout?.()

    try {
      processRef.kill('SIGTERM')
    } catch (error) {
      options.onTimeoutSigtermFailed?.(error)
    }

    forceKillTimer = setTimeout(() => {
      try {
        if (processRef.exitCode !== null || processRef.signalCode !== null) return
        processRef.kill('SIGKILL')
        options.onForceKill?.()
      } catch (error) {
        options.onForceKillFailed?.(error)
      }
    }, options.forceKillTimeoutMs)
  }, options.maxRuntimeMs)

  rl?.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    stdoutTail = appendTail(stdoutTail, `${trimmed}\n`, stdoutLimit)
    options.onStdoutLine?.(trimmed, {
      setResultError: (errorMessage) => {
        resultError = errorMessage
      },
      getResultError: () => resultError,
    })
  })

  processRef.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = appendTail(stderrTail, chunk.toString(), stderrLimit)
  })

  return await new Promise<RunManagedProcessResult>((resolve) => {
    const finalize = (payload: {
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      spawnError: Error | null
    }) => {
      if (settled) return
      settled = true
      clearTimers()
      rl?.close()
      resolve({
        exitCode: payload.exitCode,
        signalCode: payload.signalCode,
        spawnError: payload.spawnError,
        timedOut,
        resultError,
        stdoutTail,
        stderrTail,
        durationMs: Date.now() - startedAt,
      })
    }

    processRef.on('exit', (code, signal) => {
      finalize({
        exitCode: code,
        signalCode: signal,
        spawnError: null,
      })
    })

    processRef.on('error', (error) => {
      finalize({
        exitCode: processRef.exitCode,
        signalCode: processRef.signalCode,
        spawnError: error,
      })
    })
  })
}
