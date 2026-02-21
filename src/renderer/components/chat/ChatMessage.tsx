import { useState, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType } from '../../types'

interface Props {
  message: ChatMessageType
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Collapsible tool-call task card — orchid style with progress bar */
function ToolTaskCard({ message }: { message: ChatMessageType }) {
  const [expanded, setExpanded] = useState(false)
  const toolLabel = message.toolName ?? 'Tool'
  const isError = message.isError === true
  const isDone = !isError && message.role === 'tool'

  return (
    <div
      className="task-card glass-panel"
      onClick={() => setExpanded((v) => !v)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 4,
        padding: '6px 12px',
        marginBottom: 6,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ color: '#595653' }}>&#9474;</span>
          <span className="glow-amber" style={{ color: '#d4a040', fontWeight: 600, fontSize: 'inherit' }}>
            {toolLabel}
          </span>
          {message.toolInput && (
            <span
              style={{
                color: '#74747C',
                fontSize: 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {summarizeToolInput(message.toolInput)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isDone && (
            <span
              className="glow-green"
              style={{
                background: '#1a3a1a',
                color: '#548C5A',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 3,
              }}
            >
              DONE
            </span>
          )}
          {isError && (
            <span
              style={{
                background: '#3a1a1a',
                color: '#c45050',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 3,
              }}
            >
              ERROR
            </span>
          )}
          <span style={{ color: '#595653', fontSize: 12 }}>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </div>

      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: isDone ? '100%' : isError ? '30%' : '60%' }}
        />
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {message.toolInput && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: '#595653', fontSize: 10, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2 }}>
                INPUT
              </div>
              <pre style={{ color: '#74747C', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 150, overflow: 'auto', margin: 0 }}>
                {JSON.stringify(message.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {message.content && (
            <div>
              <div style={{ color: '#595653', fontSize: 10, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2 }}>
                {message.role === 'tool' ? 'RESULT' : 'OUTPUT'}
              </div>
              <pre
                style={{
                  color: isError ? '#c45050' : '#9A9692',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 150,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {message.content.slice(0, 2000)}
                {message.content.length > 2000 ? '\n... (truncated)' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Extract a short summary from tool input for the card label */
function summarizeToolInput(input: Record<string, unknown>): string {
  // Common Claude Code tool patterns
  const filePath = input.file_path ?? input.path ?? input.filename ?? input.target
  if (typeof filePath === 'string') {
    const short = filePath.split('/').slice(-2).join('/')
    return short
  }
  const command = input.command ?? input.cmd
  if (typeof command === 'string') {
    return command.length > 60 ? `${command.slice(0, 57)}...` : command
  }
  const query = input.query ?? input.search ?? input.pattern
  if (typeof query === 'string') {
    return query.length > 60 ? `${query.slice(0, 57)}...` : query
  }
  return ''
}

const EXTERNAL_URL_PROTOCOLS = new Set(['http:', 'https:'])
const INLINE_SPECIAL_TOKEN_PATTERN = /\*\*|__|\[|https?:\/\//g
const PLAIN_URL_PATTERN = /^https?:\/\/[^\s<>"'`]+/
const TRAILING_URL_PUNCTUATION_PATTERN = /[.,!?;:]+$/

function toSafeExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (!EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function splitTrailingUrlPunctuation(rawUrl: string): { url: string; trailing: string } {
  const match = rawUrl.match(TRAILING_URL_PUNCTUATION_PATTERN)
  if (!match) {
    return { url: rawUrl, trailing: '' }
  }
  const cutIndex = rawUrl.length - match[0].length
  return {
    url: rawUrl.slice(0, cutIndex),
    trailing: rawUrl.slice(cutIndex),
  }
}

function findNextInlineSpecialToken(text: string, startAt: number): number {
  INLINE_SPECIAL_TOKEN_PATTERN.lastIndex = startAt
  const match = INLINE_SPECIAL_TOKEN_PATTERN.exec(text)
  return match ? match.index : -1
}

function renderInlineAssistantText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let nodeIndex = 0

  const pushPlainText = (value: string) => {
    if (!value) return
    nodes.push(
      <span key={`${keyPrefix}-text-${nodeIndex++}`} style={{ color: '#9A9692' }}>
        {value}
      </span>
    )
  }

  while (cursor < text.length) {
    const boldMarker = text.startsWith('**', cursor)
      ? '**'
      : text.startsWith('__', cursor)
        ? '__'
        : null

    if (boldMarker) {
      const end = text.indexOf(boldMarker, cursor + boldMarker.length)
      if (end > cursor + boldMarker.length) {
        const boldContent = text.slice(cursor + boldMarker.length, end)
        nodes.push(
          <strong key={`${keyPrefix}-bold-${nodeIndex++}`} style={{ color: '#d8d3cf', fontWeight: 700 }}>
            {renderInlineAssistantText(boldContent, `${keyPrefix}-bold-${nodeIndex}`)}
          </strong>
        )
        cursor = end + boldMarker.length
        continue
      }
    }

    if (text[cursor] === '[') {
      const closeBracket = text.indexOf(']', cursor + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen !== -1 && closeParen > closeBracket + 2) {
          const label = text.slice(cursor + 1, closeBracket).trim()
          const rawUrl = text.slice(closeBracket + 2, closeParen).trim()
          const safeUrl = toSafeExternalUrl(rawUrl)
          if (safeUrl) {
            nodes.push(
              <a
                key={`${keyPrefix}-md-link-${nodeIndex++}`}
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#76a8f5', textDecoration: 'underline' }}
              >
                {label || safeUrl}
              </a>
            )
            cursor = closeParen + 1
            continue
          }
        }
      }
    }

    const plainUrlMatch = PLAIN_URL_PATTERN.exec(text.slice(cursor))
    if (plainUrlMatch && plainUrlMatch.index === 0) {
      const rawUrl = plainUrlMatch[0]
      const { url, trailing } = splitTrailingUrlPunctuation(rawUrl)
      const safeUrl = toSafeExternalUrl(url)
      if (safeUrl) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${nodeIndex++}`}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#76a8f5', textDecoration: 'underline' }}
          >
            {url}
          </a>
        )
        if (trailing) {
          pushPlainText(trailing)
        }
        cursor += rawUrl.length
        continue
      }
    }

    const nextSpecialToken = findNextInlineSpecialToken(text, cursor + 1)
    if (nextSpecialToken === -1) {
      pushPlainText(text.slice(cursor))
      break
    }
    if (nextSpecialToken === cursor) {
      pushPlainText(text[cursor] ?? '')
      cursor += 1
      continue
    }

    pushPlainText(text.slice(cursor, nextSpecialToken))
    cursor = nextSpecialToken
  }

  return nodes
}

/** Render assistant text as orchid-style content (plain text, bullets, code blocks) */
function AssistantContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Bullet points (- or * or •)
    if (/^[-*•]\s/.test(trimmed)) {
      const bulletText = trimmed.replace(/^[-*•]\s+/, '')
      elements.push(
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
          <span style={{ color: '#595653' }}>&#8226;</span>
          <span style={{ color: '#9A9692' }}>
            {renderInlineAssistantText(bulletText, `assistant-bullet-${i}`)}
          </span>
        </div>
      )
    }
    // Empty lines
    else if (trimmed === '') {
      elements.push(<div key={i} style={{ height: 6 }} />)
    }
    // Regular text
    else {
      elements.push(
        <p key={i} style={{ color: '#9A9692', margin: '4px 0', fontSize: 'inherit' }}>
          {renderInlineAssistantText(trimmed, `assistant-line-${i}`)}
        </p>
      )
    }
  }

  return <>{elements}</>
}

export function ChatMessageBubble({ message }: Props) {
  // Tool calls and results get a task card
  if (message.role === 'tool' || (message.role === 'assistant' && message.toolName)) {
    return (
      <div style={{ paddingLeft: 8 }}>
        <ToolTaskCard message={message} />
      </div>
    )
  }

  // Thinking gets a subtle indicator
  if (message.role === 'thinking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 4px 8px' }}>
        <span style={{ color: '#74747C', fontSize: 12 }}>&#x2726;</span>
        <span
          style={{
            color: '#74747C',
            fontSize: 'inherit',
            fontStyle: 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 400,
          }}
        >
          {message.content || 'Thinking...'}
        </span>
      </div>
    )
  }

  // Error messages
  if (message.role === 'error') {
    return (
      <div style={{ padding: '4px 0' }}>
        <div
          className="glass-panel"
          style={{
            borderColor: 'rgba(196, 80, 80, 0.3)',
            borderRadius: 4,
            padding: '6px 12px',
            color: '#c45050',
            fontSize: 'inherit',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  return (
    <div className="chat-msg" style={{ marginBottom: 16 }}>
      {/* Header: icon + name + time */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isAssistant && <span style={{ fontSize: 14 }}>👾</span>}
          {isUser && (
            <span style={{ color: '#595653', fontSize: 10 }}>&#9654;</span>
          )}
          <span
            className={isAssistant ? 'glow-amber' : ''}
            style={{
              color: isAssistant ? '#d4a040' : '#74747C',
              fontWeight: 600,
              fontSize: 'inherit',
            }}
          >
            {isAssistant ? 'claude' : 'you'}
          </span>
        </div>
        <span style={{ color: '#595653', fontSize: 12 }}>{formatTime(message.timestamp)}</span>
      </div>

      {/* Content */}
      <div style={{ paddingLeft: isAssistant ? 8 : 16 }}>
        {isUser ? (
          <p className="glow-green" style={{ color: '#548C5A', margin: '4px 0', fontSize: 'inherit' }}>
            {message.content}
          </p>
        ) : (
          <AssistantContent text={message.content} />
        )}
      </div>
    </div>
  )
}
