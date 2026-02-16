import { spawn, type ChildProcess } from 'child_process'
import { once } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect, test } from '@playwright/test'
import { runManagedProcess, terminateManagedProcess } from '../../src/main/process-runner'

async function forceKillIfRunning(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return
  try {
    childProcess.kill('SIGKILL')
  } catch {
    // Process may already be gone.
  }
  try {
    await once(childProcess, 'exit')
  } catch {
    // Ignore post-kill wait failures in test cleanup.
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(1, timeoutMs)
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !isPidRunning(pid)
}

async function forceKillPidIfRunning(pid: number): Promise<void> {
  if (!isPidRunning(pid)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // PID may have exited between checks.
  }
  await waitForPidExit(pid, 500)
}

test('termination helper is a no-op for already exited processes', async () => {
  const childProcess = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
  })
  await once(childProcess, 'exit')

  const result = await terminateManagedProcess({
    process: childProcess,
    sigtermTimeoutMs: 100,
  })

  expect(result.escalatedToSigkill).toBe(false)
  expect(result.timedOut).toBe(false)
})

test('termination helper shuts down process via SIGTERM before escalation deadline', async () => {
  const childProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })

  try {
    const result = await terminateManagedProcess({
      process: childProcess,
      sigtermTimeoutMs: 1_000,
      sigkillTimeoutMs: 500,
    })

    expect(result.escalatedToSigkill).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.exitCode === 0 || result.signalCode === 'SIGTERM').toBe(true)
  } finally {
    await forceKillIfRunning(childProcess)
  }
})

test('termination helper escalates to SIGKILL after SIGTERM deadline', async () => {
  const childProcess = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
    {
      stdio: 'ignore',
    }
  )

  try {
    // Give the child time to install its SIGTERM handler deterministically.
    await new Promise((resolve) => setTimeout(resolve, 100))

    const result = await terminateManagedProcess({
      process: childProcess,
      sigtermTimeoutMs: 200,
      sigkillTimeoutMs: 1_000,
    })

    expect(result.escalatedToSigkill).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.signalCode).toBe('SIGKILL')
  } finally {
    await forceKillIfRunning(childProcess)
  }
})

test('managed shell timeout terminates descendant process trees', async () => {
  test.skip(process.platform === 'win32', 'POSIX process-group signaling only')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-observer-process-tree-'))
  const pidFile = path.join(tempDir, 'descendant.pid')
  const descendantScript = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
  const parentScript = [
    'const fs = require("fs")',
    'const { spawn } = require("child_process")',
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: "ignore" })`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
    'process.on("SIGTERM", () => {})',
    'setInterval(() => {}, 1000)',
  ].join('; ')
  const shellCommand = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(parentScript)}`

  let descendantPid: number | null = null
  try {
    const result = await runManagedProcess({
      command: shellCommand,
      spawnOptions: {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      },
      maxRuntimeMs: 500,
      forceKillTimeoutMs: 200,
      timeoutErrorMessage: 'managed timeout',
    })

    expect(result.timedOut).toBe(true)
    const pidRaw = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : ''
    const parsedPid = Number.parseInt(pidRaw, 10)
    if (Number.isFinite(parsedPid) && parsedPid > 0) {
      descendantPid = parsedPid
    }
    expect(descendantPid).not.toBeNull()
    const pid = descendantPid as number
    expect(await waitForPidExit(pid, 2_000)).toBe(true)
    expect(isPidRunning(pid)).toBe(false)
  } finally {
    if (descendantPid !== null) {
      await forceKillPidIfRunning(descendantPid)
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
