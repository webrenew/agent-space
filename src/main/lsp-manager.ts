/**
 * LSP Server Manager — spawns and manages language servers as child processes.
 *
 * Each language server runs in stdio mode. Messages are JSON-RPC 2.0,
 * forwarded between renderer (via IPC) and the language server process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import os from 'os'

// ── Language → server mapping ────────────────────────────────────────

interface LspServerConfig {
  /** Human-readable name */
  name: string
  /** Binary name (resolved from node_modules/.bin) */
  command: string
  /** CLI arguments */
  args: string[]
  /** Languages this server handles */
  languages: string[]
}

/**
 * Resolve a command from node_modules/.bin relative to the app root.
 * Uses spawn with full path — no shell, no injection risk.
 */
function resolveServerBin(cmd: string): string {
  const appRoot = path.resolve(__dirname, '../..')
  return path.join(appRoot, 'node_modules', '.bin', cmd)
}

const SERVER_CONFIGS: LspServerConfig[] = [
  {
    name: 'TypeScript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  },
  {
    name: 'CSS',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    languages: ['css', 'scss', 'less'],
  },
  {
    name: 'HTML',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    languages: ['html'],
  },
  {
    name: 'JSON',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    languages: ['json', 'jsonc'],
  },
  {
    name: 'Markdown',
    command: 'vscode-markdown-language-server',
    args: ['--stdio'],
    languages: ['markdown'],
  },
]

// ── Active server instances ──────────────────────────────────────────

interface ActiveServer {
  config: LspServerConfig
  process: ChildProcess
  initialized: boolean
  /** Buffer for incomplete JSON-RPC messages */
  buffer: Buffer
}

const activeServers = new Map<string, ActiveServer>()

let mainWindow: BrowserWindow | null = null

// ── JSON-RPC message framing ─────────────────────────────────────────

function encodeMessage(msg: unknown): string {
  const body = JSON.stringify(msg)
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`
}

function parseMessages(buffer: Buffer): { messages: unknown[]; remaining: Buffer } {
  const messages: unknown[] = []
  let cursor = 0

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n', cursor, 'utf-8')
    if (headerEnd === -1) break

    const header = buffer.subarray(cursor, headerEnd).toString('ascii')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    const bodyStart = headerEnd + 4
    if (!match) {
      cursor = bodyStart
      continue
    }

    const contentLength = Number.parseInt(match[1], 10)
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      cursor = bodyStart
      continue
    }
    const bodyEnd = bodyStart + contentLength

    if (buffer.length < bodyEnd) break

    const body = buffer.subarray(bodyStart, bodyEnd).toString('utf-8')
    cursor = bodyEnd

    try {
      messages.push(JSON.parse(body))
    } catch (err) {
      console.error('[lsp-manager] Failed to parse JSON-RPC message:', err)
    }
  }

  return {
    messages,
    remaining: cursor === 0 ? buffer : buffer.subarray(cursor),
  }
}

// ── Server lifecycle ─────────────────────────────────────────────────

function findConfigForLanguage(languageId: string): LspServerConfig | undefined {
  return SERVER_CONFIGS.find((c) => c.languages.includes(languageId))
}

function getOrStartServer(languageId: string): ActiveServer | null {
  for (const [, server] of activeServers) {
    if (server.config.languages.includes(languageId)) {
      return server
    }
  }

  const config = findConfigForLanguage(languageId)
  if (!config) {
    console.warn(`[lsp-manager] No LSP server configured for language: ${languageId}`)
    return null
  }

  const binPath = resolveServerBin(config.command)
  console.log(`[lsp-manager] Starting ${config.name} server: ${binPath} ${config.args.join(' ')}`)

  try {
    // spawn with full path, no shell — safe from injection
    // Use enhanced PATH so servers can find node, tsserver, etc.
    const home = os.homedir()
    const extraPaths = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ]
    const currentPath = process.env.PATH ?? '/usr/bin:/bin'
    const enhancedPath = [...extraPaths, ...currentPath.split(':')].join(':')

    const proc = spawn(binPath, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: enhancedPath },
    })

    const server: ActiveServer = {
      config,
      process: proc,
      initialized: false,
      buffer: Buffer.alloc(0),
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      server.buffer = Buffer.concat([server.buffer, chunk])
      const { messages, remaining } = parseMessages(server.buffer)
      server.buffer = remaining

      for (const msg of messages) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lsp:message', {
            serverId: config.name,
            message: msg,
          })
        }
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text) console.error(`[lsp:${config.name}:stderr]`, text)
    })

    proc.on('error', (err) => {
      console.error(`[lsp-manager] ${config.name} server spawn error:`, err.message)
      activeServers.delete(config.name)
    })

    proc.on('exit', (code, signal) => {
      console.log(`[lsp-manager] ${config.name} server exited (code=${code}, signal=${signal})`)
      activeServers.delete(config.name)
    })

    activeServers.set(config.name, server)
    return server
  } catch (err) {
    console.error(`[lsp-manager] Failed to start ${config.name}:`, err)
    return null
  }
}

function stopServer(name: string): void {
  const server = activeServers.get(name)
  if (!server) return

  console.log(`[lsp-manager] Stopping ${name} server`)
  try {
    const shutdownMsg = {
      jsonrpc: '2.0',
      id: 'shutdown',
      method: 'shutdown',
      params: null,
    }
    server.process.stdin?.write(encodeMessage(shutdownMsg))

    setTimeout(() => {
      try {
        const exitMsg = { jsonrpc: '2.0', method: 'exit' }
        server.process.stdin?.write(encodeMessage(exitMsg))
      } catch {
        // Process may already be gone
      }
      setTimeout(() => {
        try {
          if (!server.process.killed) server.process.kill('SIGTERM')
        } catch {
          // Already dead
        }
      }, 2000)
    }, 500)
  } catch (err) {
    console.error(`[lsp-manager] Error stopping ${name}:`, err)
    try { server.process.kill('SIGKILL') } catch { /* already dead */ }
  }
  activeServers.delete(name)
}

// ── IPC handlers ─────────────────────────────────────────────────────

let handlersRegistered = false

export function setupLspHandlers(window: BrowserWindow): void {
  mainWindow = window

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('lsp:start', (_event, languageId: string) => {
    const server = getOrStartServer(languageId)
    return server
      ? { serverId: server.config.name, languages: server.config.languages }
      : null
  })

  ipcMain.handle('lsp:send', (_event, serverId: string, message: unknown) => {
    const server = activeServers.get(serverId)
    if (!server) {
      console.warn(`[lsp-manager] No active server: ${serverId}`)
      return false
    }
    try {
      server.process.stdin?.write(encodeMessage(message))
      return true
    } catch (err) {
      console.error(`[lsp-manager] Failed to send to ${serverId}:`, err)
      return false
    }
  })

  ipcMain.handle('lsp:stop', (_event, serverId: string) => {
    stopServer(serverId)
    return true
  })

  ipcMain.handle('lsp:languages', () => {
    return SERVER_CONFIGS.map((c) => ({
      name: c.name,
      languages: c.languages,
      active: activeServers.has(c.name),
    }))
  })
}

export function cleanupLspServers(): void {
  for (const [name] of activeServers) {
    stopServer(name)
  }
}
