import type { AgentStatus } from '../types'

export interface ClaudeUpdate {
  status?: AgentStatus
  currentTask?: string
  model?: string
  tokensInput?: number
  tokensOutput?: number
  fileModified?: string
  commitDetected?: boolean
}

const BUFFER_MAX = 4000

// Patterns to detect Claude CLI output states
const PATTERNS = {
  thinking: /(?:Thinking|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)/,
  streaming: /[│┃┆┇┊┋╎╏║▎▏]/,
  toolCall: /(?:Read|Write|Edit|Bash|Grep|Glob|WebFetch|WebSearch|Task)\s*[:(]/,
  error: /(?:Error:|ERROR:|Failed:|✗|✘)/i,
  done: /(?:Task completed|✓ Done|✔|completed successfully)/i,
  model: /(?:claude-[\w.-]+|gpt-[\w.-]+)/,
  taskLine: /(?:>[→>]?\s*(.{5,80})$)/m,
  // Activity tracking patterns
  tokens: /(\d[\d,]*)\s*input.*?(\d[\d,]*)\s*output/i,
  tokensAlt: /Tokens:\s*(\d[\d,]*).*?(\d[\d,]*)/i,
  fileModified: /(?:Wrote|Created|Updated|Edited)\s+.*?([^\s"']+\.\w+)/i,
  commitSuccess: /\[(?:main|master|[\w/-]+)\s+[\da-f]{7,}\]/
} as const

function parseTokenCount(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10) || 0
}

export class ClaudeDetector {
  private buffer = ''

  /** Feed new terminal output into the detector */
  feed(data: string): ClaudeUpdate | null {
    this.buffer += data
    if (this.buffer.length > BUFFER_MAX) {
      this.buffer = this.buffer.slice(-BUFFER_MAX)
    }

    // Check recent chunk for patterns (last ~500 chars is enough for per-frame detection)
    const recent = data.length > 500 ? data.slice(-500) : data

    const update: ClaudeUpdate = {}
    let hasUpdate = false

    // Priority order: error > done > tool_calling > streaming > thinking
    if (PATTERNS.error.test(recent)) {
      update.status = 'error'
      hasUpdate = true
    } else if (PATTERNS.done.test(recent)) {
      update.status = 'done'
      hasUpdate = true
    } else if (PATTERNS.toolCall.test(recent)) {
      update.status = 'tool_calling'
      hasUpdate = true
    } else if (PATTERNS.streaming.test(recent)) {
      update.status = 'streaming'
      hasUpdate = true
    } else if (PATTERNS.thinking.test(recent)) {
      update.status = 'thinking'
      hasUpdate = true
    }

    // Try to extract model name from buffer
    const modelMatch = this.buffer.match(PATTERNS.model)
    if (modelMatch) {
      update.model = modelMatch[0]
      hasUpdate = true
    }

    // Try to extract current task from recent output
    const taskMatch = recent.match(PATTERNS.taskLine)
    if (taskMatch?.[1]) {
      const task = taskMatch[1].trim()
      if (task.length > 5 && !/^[─━═┈┄]+$/.test(task)) {
        update.currentTask = task
        hasUpdate = true
      }
    }

    // Token usage detection (CLI reports cumulative totals)
    const tokenMatch = recent.match(PATTERNS.tokens) || recent.match(PATTERNS.tokensAlt)
    if (tokenMatch) {
      update.tokensInput = parseTokenCount(tokenMatch[1])
      update.tokensOutput = parseTokenCount(tokenMatch[2])
      hasUpdate = true
    }

    // File modification detection
    const fileMatch = recent.match(PATTERNS.fileModified)
    if (fileMatch?.[1]) {
      update.fileModified = fileMatch[1]
      hasUpdate = true
    }

    // Git commit detection
    if (PATTERNS.commitSuccess.test(recent)) {
      update.commitDetected = true
      hasUpdate = true
    }

    return hasUpdate ? update : null
  }

  /** Reset buffer when Claude exits */
  reset(): void {
    this.buffer = ''
  }
}
