import { ipcMain, BrowserWindow } from 'electron'
import os from 'os'
import { getSettings, isValidShell, isValidDirectory } from './settings'

// node-pty is a native module — require at runtime to avoid bundling issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty = require('node-pty')

interface PtySession {
  pty: ReturnType<typeof pty.spawn>
  pollTimer: ReturnType<typeof setInterval> | null
  wasClaudeRunning: boolean
  outputClaudeDetected: boolean
}

const sessions = new Map<string, PtySession>()
let idCounter = 0

// Match process names: claude, claude-code, node (claude runs as node)
const CLAUDE_PROCESS_RE = /\bclaude\b/i

// Output-based detection: Claude Code prints these on startup
const CLAUDE_OUTPUT_PATTERNS = [
  /claude(?:\s+code)?.*v?\d+\.\d+/i,        // version banner
  /╭─+╮/,                                     // box-drawing TUI border
  /\bTips:/,                                   // tips section
  /\bType \/help/i,                            // help hint
  /\bclaude>\s*$/m,                            // prompt
  /\bHuman:\s*$/m,                             // REPL prompt variant
  /\bClaude Code\b/i,                          // product name in output
]

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

export function setupTerminalHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('terminal:create', (_event, options?: { cols?: number; rows?: number }) => {
    const id = `term-${++idCounter}`
    const settings = getSettings()

    const customShell = settings.general.customShell
    const shell = settings.general.shell === 'custom' && customShell && isValidShell(customShell)
      ? customShell
      : getDefaultShell()

    const customDir = settings.general.customDirectory
    const cwd = settings.general.startingDirectory === 'custom' && customDir && isValidDirectory(customDir)
      ? customDir
      : os.homedir()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options?.cols ?? 80,
      rows: options?.rows ?? 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    })

    const session: PtySession = {
      pty: ptyProcess,
      pollTimer: null,
      wasClaudeRunning: false,
      outputClaudeDetected: false
    }

    // Rolling buffer for output-based detection
    let outputBuffer = ''
    const OUTPUT_BUFFER_MAX = 2000

    // Forward data from PTY to renderer + scan for Claude patterns
    ptyProcess.onData((data: string) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', id, data)
      }

      // Output-based Claude detection (supplements process name polling)
      if (!session.outputClaudeDetected) {
        outputBuffer += data
        if (outputBuffer.length > OUTPUT_BUFFER_MAX) {
          outputBuffer = outputBuffer.slice(-OUTPUT_BUFFER_MAX)
        }

        const matched = CLAUDE_OUTPUT_PATTERNS.some((re) => re.test(outputBuffer))
        if (matched) {
          session.outputClaudeDetected = true
          outputBuffer = '' // free memory

          if (!session.wasClaudeRunning) {
            session.wasClaudeRunning = true
            if (!mainWindow.isDestroyed()) {
              mainWindow.webContents.send('terminal:claude-status', id, true)
            }
          }
        }
      }
    })

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', id, exitCode, signal)
      }
      if (session.pollTimer) clearInterval(session.pollTimer)
      sessions.delete(id)
    })

    // Poll foreground process name every 1s
    session.pollTimer = setInterval(() => {
      const s = sessions.get(id)
      if (!s) return

      try {
        const processName: string = s.pty.process
        const isClaude = CLAUDE_PROCESS_RE.test(processName)

        // Combine: process name OR output detection
        const isClaudeRunning = isClaude || s.outputClaudeDetected

        if (isClaudeRunning !== s.wasClaudeRunning) {
          s.wasClaudeRunning = isClaudeRunning

          // When Claude exits, reset output detection for next run
          if (!isClaudeRunning) {
            s.outputClaudeDetected = false
            outputBuffer = ''
          }

          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal:claude-status', id, isClaudeRunning)
          }
        }
      } catch {
        // Process may have exited between check — ignore
      }
    }, 1000)

    sessions.set(id, session)

    return { id, cwd }
  })

  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    sessions.get(id)?.pty.write(data)
  })

  ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    try {
      sessions.get(id)?.pty.resize(cols, rows)
    } catch {
      // Resize can throw if process already exited
    }
  })

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    if (session.pollTimer) clearInterval(session.pollTimer)
    try {
      session.pty.kill()
    } catch {
      // Already dead
    }
    sessions.delete(id)
  })
}

export function cleanupTerminals(): void {
  for (const [id, session] of sessions) {
    if (session.pollTimer) clearInterval(session.pollTimer)
    try {
      session.pty.kill()
    } catch {
      // ignore
    }
    sessions.delete(id)
  }
}
