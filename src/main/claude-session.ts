import { ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { createInterface, Interface as ReadlineInterface } from 'readline'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { resolveClaudeProfileForDirectory } from './claude-profile'

// ── Types (mirrored from renderer, kept lightweight for main process) ──

interface ClaudeSessionOptions {
  prompt: string
  model?: string
  systemPrompt?: string
  allowedTools?: string[]
  workingDirectory?: string
  dangerouslySkipPermissions?: boolean
}

interface ClaudeEvent {
  sessionId: string
  type: string
  data: Record<string, unknown>
}

interface ActiveSession {
  process: ChildProcess
  readline: ReadlineInterface
  sessionId: string
}

// ── State ──────────────────────────────────────────────────────────────

const activeSessions = new Map<string, ActiveSession>()
let sessionCounter = 0

// ── Resolve Claude CLI binary ─────────────────────────────────────────

/**
 * Packaged Electron apps don't inherit the user's shell PATH.
 * We resolve the claude binary by checking common install locations,
 * then falling back to asking the user's login shell.
 */
function resolveClaudeBinary(): string {
  const home = os.homedir()

  // Common locations where claude gets installed
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]

  // Also check nvm paths
  const nvmDir = path.join(home, '.nvm', 'versions', 'node')
  try {
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir)
      for (const v of versions) {
        candidates.push(path.join(nvmDir, v, 'bin', 'claude'))
      }
    }
  } catch {
    // nvm dir doesn't exist — fine
  }

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      console.log(`[claude-session] Found claude binary at: ${candidate}`)
      return candidate
    } catch {
      // Not found or not executable — continue
    }
  }

  // Last resort: try asking the user's login shell
  try {
    const shell = process.env.SHELL ?? '/bin/zsh'
    const result = execFileSync(shell, ['-ilc', 'which claude'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, HOME: home },
    }).trim()
    if (result && fs.existsSync(result)) {
      console.log(`[claude-session] Resolved claude via login shell: ${result}`)
      return result
    }
  } catch {
    // Shell resolution failed — continue
  }

  // Fall back to bare 'claude' and let spawn try PATH
  console.warn('[claude-session] Could not resolve claude binary, falling back to bare "claude"')
  return 'claude'
}

/**
 * Build a comprehensive PATH that includes common user binary dirs.
 * This ensures spawned processes can find tools even from a packaged app.
 */
function getEnhancedEnv(): NodeJS.ProcessEnv {
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

  const currentPath = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'
  const enhancedPath = [...extraPaths, ...currentPath.split(':')].join(':')

  return { ...process.env, PATH: enhancedPath }
}

let resolvedClaudePath: string | null = null

export function getClaudeBinaryPath(): string {
  if (!resolvedClaudePath) {
    resolvedClaudePath = resolveClaudeBinary()
  }
  return resolvedClaudePath
}

export function getClaudeEnvironment(): NodeJS.ProcessEnv {
  return getEnhancedEnv()
}

function checkClaudeAvailability(): {
  available: boolean
  binaryPath: string | null
  version: string | null
  error?: string
} {
  try {
    if (!resolvedClaudePath) {
      resolvedClaudePath = resolveClaudeBinary()
    }
    const binaryPath = resolvedClaudePath
    const version = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: getEnhancedEnv(),
      cwd: process.cwd(),
    }).trim()

    return {
      available: true,
      binaryPath,
      version: version || null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      available: false,
      binaryPath: resolvedClaudePath,
      version: null,
      error: message,
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function generateSessionId(): string {
  return `chat-${++sessionCounter}-${Date.now()}`
}

function emitEvent(event: ClaudeEvent): void {
  // Broadcast to all windows (main + popped-out chat windows)
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('claude:event', event)
    }
  }
}

/**
 * Parse a single JSONL line from the Claude CLI stream-json output.
 * Returns zero or more normalized Claude events for the line.
 */
function parseStreamLine(
  sessionId: string,
  line: string
): ClaudeEvent[] {
  try {
    const events: ClaudeEvent[] = []
    const obj = JSON.parse(line) as Record<string, unknown>

    // system.init event
    if (obj.type === 'system' && obj.subtype === 'init') {
      events.push({
        sessionId,
        type: 'init',
        data: { session_id: (obj.session_id as string) ?? sessionId },
      })
      return events
    }

    // result event (final)
    if (obj.type === 'result') {
      events.push({
        sessionId,
        type: 'result',
        data: {
          result: (obj.result as string) ?? '',
          is_error: obj.is_error as boolean | undefined,
          error: obj.error as string | undefined,
          usage: obj.usage as Record<string, unknown> | undefined,
          modelUsage: obj.modelUsage as Record<string, unknown> | undefined,
          session_id: (obj.session_id as string) ?? sessionId,
        },
      })
      return events
    }

    // assistant / user message with content blocks
    if (obj.type === 'assistant' || obj.type === 'user') {
      const message = (obj.message ?? obj) as Record<string, unknown>
      const messageUsage = message.usage as Record<string, unknown> | undefined
      const contentBlocks = (message.content ?? []) as Array<Record<string, unknown>>

      // Emit all meaningful blocks in order.
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          events.push({
            sessionId,
            type: 'tool_use',
            data: {
              id: block.id as string,
              name: block.name as string,
              input: (block.input ?? {}) as Record<string, unknown>,
              usage: messageUsage,
            },
          })
          continue
        }

        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content ?? '')
          events.push({
            sessionId,
            type: 'tool_result',
            data: {
              tool_use_id: block.tool_use_id as string,
              content,
              is_error: block.is_error as boolean | undefined,
              usage: messageUsage,
            },
          })
          continue
        }

        if (block.type === 'thinking') {
          events.push({
            sessionId,
            type: 'thinking',
            data: {
              thinking: (block.thinking as string) ?? '',
              usage: messageUsage,
            },
          })
          continue
        }

        if (block.type === 'text') {
          events.push({
            sessionId,
            type: 'text',
            data: {
              text: (block.text as string) ?? '',
              usage: messageUsage,
            },
          })
        }
      }
      if (events.length > 0) return events
    }

    // Fallback: if it has a content_block with type info
    if (obj.content_block) {
      const block = obj.content_block as Record<string, unknown>
      if (block.type === 'text') {
        events.push({
          sessionId,
          type: 'text',
          data: { text: (block.text as string) ?? '' },
        })
      }
    }

    return events
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[claude-session] Failed to parse JSONL line: ${message}`)
    return []
  }
}

// ── Session Management ─────────────────────────────────────────────────

function startSession(options: ClaudeSessionOptions): string {
  const sessionId = generateSessionId()

  // Resolve claude binary once
  if (!resolvedClaudePath) {
    resolvedClaudePath = resolveClaudeBinary()
  }

  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
  ]

  if (options.model) {
    args.push('--model', options.model)
  }

  if (options.systemPrompt) {
    args.push('--append-system-prompt', options.systemPrompt)
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', ...options.allowedTools)
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  // Validate and resolve working directory
  const home = process.env.HOME ?? process.cwd()
  const rawCwd = options.workingDirectory ?? home
  const cwd = path.resolve(rawCwd)

  // Ensure directory exists to avoid ENOENT on spawn
  try {
    const stat = fs.statSync(cwd)
    if (!stat.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${cwd}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[claude-session] Invalid working directory: ${message}`)
    throw new Error(`Invalid working directory: ${message}`)
  }

  const profileResolution = resolveClaudeProfileForDirectory(cwd)
  if (profileResolution.cliArgs.length > 0) {
    args.push(...profileResolution.cliArgs)
  }
  console.log(
    `[claude-session] Profile "${profileResolution.profile.id}" (${profileResolution.source}) for cwd: ${cwd}`
  )
  if (profileResolution.missingPathWarnings.length > 0) {
    for (const warning of profileResolution.missingPathWarnings) {
      console.warn(`[claude-session] ${warning}`)
    }
  }

  // Sanitize prompt — strip null bytes to prevent spawn errors
  const safePrompt = options.prompt.replace(/\0/g, '')

  // Pass prompt as CLI argument after all flags.
  args.push('--', safePrompt)

  let proc: ChildProcess
  try {
    proc = spawn(resolvedClaudePath, args, {
      cwd,
      env: getEnhancedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[claude-session] Failed to spawn claude CLI (${resolvedClaudePath}): ${message}`)
    emitEvent({
      sessionId,
      type: 'error',
      data: { message: `Failed to spawn claude CLI: ${message}` },
    })
    throw new Error(`Failed to spawn claude CLI: ${message}`)
  }

  const rl = createInterface({ input: proc.stdout! })

  const session: ActiveSession = { process: proc, readline: rl, sessionId }
  activeSessions.set(sessionId, session)

  // Parse each JSONL line from stdout
  rl.on('line', (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const events = parseStreamLine(sessionId, trimmed)
    for (const event of events) {
      emitEvent(event)
    }
  })

  // Capture stderr for error reporting
  let stderrBuffer = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
  })

  proc.on('error', (err: Error) => {
    console.error(`[claude-session] Process error for ${sessionId}: ${err.message}`)
    emitEvent({
      sessionId,
      type: 'error',
      data: { message: `Process error: ${err.message}` },
    })
    activeSessions.delete(sessionId)
  })

  proc.on('exit', (code: number | null, signal: string | null) => {
    rl.close()

    // If we didn't already send a result event, send one now
    if (code !== 0 && stderrBuffer.trim()) {
      emitEvent({
        sessionId,
        type: 'error',
        data: {
          message: `Claude exited with code ${code ?? 'null'} (${signal ?? 'no signal'}): ${stderrBuffer.trim().slice(0, 500)}`,
        },
      })
    }

    // Always send a result event so the UI knows the session ended
    emitEvent({
      sessionId,
      type: 'result',
      data: {
        result: '',
        is_error: code !== 0,
        session_id: sessionId,
      },
    })

    activeSessions.delete(sessionId)
  })

  return sessionId
}

function stopSession(sessionId: string): void {
  const session = activeSessions.get(sessionId)
  if (!session) return

  // Force kill after 5s if SIGTERM doesn't work
  const forceKillTimer = setTimeout(() => {
    try {
      session.process.kill('SIGKILL')
    } catch {
      // Process already dead — expected
    }
  }, 5000)

  // Register exit handler BEFORE sending kill signal to avoid race
  session.process.once('exit', () => {
    clearTimeout(forceKillTimer)
  })

  try {
    session.readline.close()
    session.process.kill('SIGTERM')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[claude-session] Failed to stop session ${sessionId}: ${message}`)
    clearTimeout(forceKillTimer)
  }

  activeSessions.delete(sessionId)
}

// ── IPC Setup ──────────────────────────────────────────────────────────

let handlersRegistered = false

export function setupClaudeSessionHandlers(_mainWindow: BrowserWindow): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('claude:start', (_event, options: unknown) => {
    // Validate input shape
    if (!options || typeof options !== 'object') {
      throw new Error('claude:start requires an options object')
    }
    const opts = options as Record<string, unknown>
    if (typeof opts.prompt !== 'string' || !opts.prompt.trim()) {
      throw new Error('claude:start requires a non-empty prompt string')
    }
    const validated: ClaudeSessionOptions = {
      prompt: opts.prompt,
      model: typeof opts.model === 'string' ? opts.model : undefined,
      systemPrompt: typeof opts.systemPrompt === 'string' ? opts.systemPrompt : undefined,
      allowedTools: Array.isArray(opts.allowedTools) ? opts.allowedTools.filter((t): t is string => typeof t === 'string') : undefined,
      workingDirectory: typeof opts.workingDirectory === 'string' ? opts.workingDirectory : undefined,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions === true,
    }
    const sessionId = startSession(validated)
    return { sessionId }
  })

  ipcMain.handle('claude:stop', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new Error('claude:stop requires a sessionId string')
    }
    stopSession(sessionId)
  })

  ipcMain.handle('claude:isAvailable', () => {
    return checkClaudeAvailability()
  })
}

export function cleanupClaudeSessions(): void {
  for (const [id] of activeSessions) {
    stopSession(id)
  }
}
