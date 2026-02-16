import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { createInterface } from 'readline'

function appendTail(current: string, text: string, max: number): string {
  const combined = `${current}${text}`
  if (combined.length <= max) return combined
  return combined.slice(combined.length - max)
}

const processGroupTerminationByProcess = new WeakMap<ChildProcess, boolean>()

function shouldUseManagedProcessGroup(spawnOptions: SpawnOptions): boolean {
  if (process.platform === 'win32') return false
  if (spawnOptions.detached === false) return false
  return true
}

function resolveManagedSpawnOptions(spawnOptions: SpawnOptions): {
  spawnOptions: SpawnOptions
  useProcessGroup: boolean
} {
  const useProcessGroup = shouldUseManagedProcessGroup(spawnOptions)
  if (!useProcessGroup) {
    return {
      spawnOptions,
      useProcessGroup: false,
    }
  }

  return {
    spawnOptions: {
      ...spawnOptions,
      detached: true,
    },
    useProcessGroup: true,
  }
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
    const sigkillResult = sendSignal(options.process, 'SIGKILL')
    if (sigkillResult.error) {
      options.onForceKillFailed(sigkillResult.error)
    } else if (sigkillResult.sent) {
      options.onForceKill()
    }
  }, options.delayMs)
  options.timers.set(options.key, timer)
}

interface WaitForProcessExitResult {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  timedOut: boolean
}

function hasProcessExited(process: ChildProcess): boolean {
  return process.exitCode !== null || process.signalCode !== null
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<WaitForProcessExitResult> {
  if (hasProcessExited(process)) {
    return Promise.resolve({
      exitCode: process.exitCode,
      signalCode: process.signalCode,
      timedOut: false,
    })
  }

  return new Promise((resolve) => {
    let settled = false
    let timeout: NodeJS.Timeout | null = null

    const cleanup = () => {
      process.off('exit', onExit)
      process.off('error', onError)
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
    }

    const settle = (result: WaitForProcessExitResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle({
        exitCode: code,
        signalCode: signal,
        timedOut: false,
      })
    }

    const onError = () => {
      settle({
        exitCode: process.exitCode,
        signalCode: process.signalCode,
        timedOut: false,
      })
    }

    process.once('exit', onExit)
    process.once('error', onError)
    timeout = setTimeout(() => {
      settle({
        exitCode: process.exitCode,
        signalCode: process.signalCode,
        timedOut: true,
      })
    }, Math.max(1, timeoutMs))
  })
}

function sendSignalDirect(
  process: ChildProcess,
  signal: NodeJS.Signals
): { sent: boolean; error: unknown | null } {
  if (hasProcessExited(process)) {
    return { sent: false, error: null }
  }

  try {
    const sent = process.kill(signal)
    if (!sent && !hasProcessExited(process)) {
      return { sent: false, error: new Error(`Failed to send ${signal}`) }
    }
    return { sent, error: null }
  } catch (error) {
    return { sent: false, error }
  }
}

function sendSignal(process: ChildProcess, signal: NodeJS.Signals): { sent: boolean; error: unknown | null } {
  if (hasProcessExited(process)) {
    return { sent: false, error: null }
  }

  const useProcessGroup = processGroupTerminationByProcess.get(process) === true
  if (useProcessGroup && typeof process.pid === 'number' && process.pid > 0) {
    try {
      globalThis.process.kill(-process.pid, signal)
      return { sent: true, error: null }
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException
      if (candidate?.code === 'ESRCH') {
        return { sent: false, error: null }
      }
      const fallbackResult = sendSignalDirect(process, signal)
      if (!fallbackResult.error) return fallbackResult
      return { sent: false, error: fallbackResult.error }
    }
  }

  return sendSignalDirect(process, signal)
}

export interface TerminateManagedProcessOptions {
  process: ChildProcess
  sigtermTimeoutMs: number
  sigkillTimeoutMs?: number
  onSigtermSent?: () => void
  onSigtermFailed?: (error: unknown) => void
  onForceKill?: () => void
  onForceKillFailed?: (error: unknown) => void
}

export interface TerminateManagedProcessResult {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  escalatedToSigkill: boolean
  timedOut: boolean
  durationMs: number
}

export async function terminateManagedProcess(
  options: TerminateManagedProcessOptions
): Promise<TerminateManagedProcessResult> {
  const startedAt = Date.now()
  const childProcess = options.process

  if (hasProcessExited(childProcess)) {
    return {
      exitCode: childProcess.exitCode,
      signalCode: childProcess.signalCode,
      escalatedToSigkill: false,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    }
  }

  const sigtermResult = sendSignal(childProcess, 'SIGTERM')
  if (sigtermResult.error) {
    options.onSigtermFailed?.(sigtermResult.error)
  } else if (sigtermResult.sent) {
    options.onSigtermSent?.()
  }

  const sigtermWait = await waitForProcessExit(childProcess, options.sigtermTimeoutMs)
  if (!sigtermWait.timedOut || hasProcessExited(childProcess)) {
    return {
      exitCode: sigtermWait.exitCode,
      signalCode: sigtermWait.signalCode,
      escalatedToSigkill: false,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    }
  }

  let escalatedToSigkill = false
  const sigkillResult = sendSignal(childProcess, 'SIGKILL')
  if (sigkillResult.error) {
    options.onForceKillFailed?.(sigkillResult.error)
  } else if (sigkillResult.sent) {
    escalatedToSigkill = true
    options.onForceKill?.()
  }

  const sigkillWait = await waitForProcessExit(
    childProcess,
    options.sigkillTimeoutMs ?? options.sigtermTimeoutMs
  )

  return {
    exitCode: sigkillWait.exitCode,
    signalCode: sigkillWait.signalCode,
    escalatedToSigkill,
    timedOut: sigkillWait.timedOut && !hasProcessExited(childProcess),
    durationMs: Date.now() - startedAt,
  }
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

  const managedSpawn = resolveManagedSpawnOptions(options.spawnOptions)
  let processRef: ChildProcess
  try {
    processRef = spawn(options.command, options.args ?? [], managedSpawn.spawnOptions)
    processGroupTerminationByProcess.set(processRef, managedSpawn.useProcessGroup)
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

    const sigtermResult = sendSignal(processRef, 'SIGTERM')
    if (sigtermResult.error) {
      options.onTimeoutSigtermFailed?.(sigtermResult.error)
    }

    forceKillTimer = setTimeout(() => {
      if (processRef.exitCode !== null || processRef.signalCode !== null) return
      const sigkillResult = sendSignal(processRef, 'SIGKILL')
      if (sigkillResult.error) {
        options.onForceKillFailed?.(sigkillResult.error)
      } else if (sigkillResult.sent) {
        options.onForceKill?.()
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
      processGroupTerminationByProcess.delete(processRef)
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
