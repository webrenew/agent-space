import type { ChatMessage, ChatRunReward, WorkspaceContextSnapshot } from '../../types'
import { buildWorkspaceContextPrompt } from '../../lib/workspaceContext'

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tiff', 'psd',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'mkv', 'flac',
  'exe', 'dll', 'so', 'dylib', 'wasm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'dmg', 'iso', 'bin',
])
const MENTION_PATTERN = /(?:^|\s)@{([^}\n]+)}|(?:^|\s)@([^\s@]+)/g
const MAX_REFERENCED_FILES = 12
const MAX_HISTORY_MESSAGES = 14
const MAX_HISTORY_CHARS = 12_000

export interface SlashCommandInput {
  name: string
  argsRaw: string
  args: string[]
}

export interface MentionLookupHit {
  path: string
  name: string
  isDirectory: boolean
}

export interface ResolvedMentionedFile {
  mention: string
  path: string
  relPath: string
}

export interface MentionResolutionResult {
  resolved: ResolvedMentionedFile[]
  unresolved: string[]
}

export interface MentionReferencesStageResult {
  prompt: string
  referenceNotes: string[]
  resolvedMentionCount: number
  unresolvedMentionCount: number
}

export interface PrepareChatPromptInput {
  message: string
  workingDirectory: string
  mentions?: string[]
  files?: File[]
  historyMessages?: ChatMessage[]
  officeContext?: OfficePromptContext
}

export interface PrepareChatPromptResult {
  prompt: string
  mentionTokens: string[]
  workspaceSnapshot: WorkspaceContextSnapshot | null
  resolvedMentionCount: number
  unresolvedMentionCount: number
}

export interface PrepareChatPromptDependencies {
  getWorkspaceSnapshot: (workingDirectory: string) => Promise<WorkspaceContextSnapshot>
  upsertWorkspaceSnapshot: (snapshot: WorkspaceContextSnapshot) => void
  onWorkspaceSnapshotError?: (error: unknown) => void
  resolveMentionedFiles: (
    rootDir: string,
    mentions: string[]
  ) => Promise<MentionResolutionResult>
  readReferencedFile: (path: string) => Promise<{ content: string; truncated?: boolean }>
}

export interface OfficeRewardContext {
  rewardScore: number
  status: ChatRunReward['status']
  notes: string[]
}

export interface OfficePromptContext {
  recentFeedback: string[]
  latestReward: OfficeRewardContext | null
}

function roleLabel(role: ChatMessage['role'], toolName?: string): string {
  if (role === 'user') return 'User'
  if (role === 'assistant') return 'Assistant'
  if (role === 'tool') return toolName ? `Tool (${toolName})` : 'Tool'
  if (role === 'error') return 'System'
  return 'Assistant'
}

export function normalizeMentionPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function toRelativePathIfInside(rootDir: string, absolutePath: string): string | null {
  const normalizedRoot = toForwardSlashes(rootDir).replace(/\/+$/, '')
  const normalizedPath = toForwardSlashes(absolutePath)
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return null
}

export function extractMentionPaths(message: string): string[] {
  const mentions: string[] = []
  const seen = new Set<string>()
  for (const match of message.matchAll(MENTION_PATTERN)) {
    const raw = match[1] ?? match[2] ?? ''
    const normalized = normalizeMentionPath(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    mentions.push(normalized)
  }
  return mentions
}

export function resolveMentionTokens(message: string, mentions?: string[]): string[] {
  if (mentions && mentions.length > 0) return mentions
  return extractMentionPaths(message)
}

export function parseSlashCommandInput(message: string): SlashCommandInput | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  const firstSpace = trimmed.indexOf(' ')
  const token = firstSpace >= 0 ? trimmed.slice(1, firstSpace) : trimmed.slice(1)
  const name = token.trim()
  if (!name) return null
  const argsRaw = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : ''
  return {
    name,
    argsRaw,
    args: argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [],
  }
}

export async function resolveMentionedFilesWithSearch(
  rootDir: string,
  mentions: string[],
  search: (rootDir: string, query: string, limit: number) => Promise<MentionLookupHit[]>,
  onLookupError?: (mention: string, error: unknown) => void
): Promise<MentionResolutionResult> {
  const normalizedMentions = Array.from(
    new Set(mentions.map((mention) => normalizeMentionPath(mention).toLowerCase()))
  )
    .filter(Boolean)
    .slice(0, MAX_REFERENCED_FILES)

  if (normalizedMentions.length === 0) {
    return { resolved: [], unresolved: [] }
  }

  const lookups = await Promise.all(
    normalizedMentions.map(async (mention) => {
      try {
        const hits = await search(rootDir, mention, 25)
        return { mention, hits }
      } catch (error) {
        onLookupError?.(mention, error)
        return { mention, hits: [] as MentionLookupHit[] }
      }
    })
  )

  const resolved: ResolvedMentionedFile[] = []
  const unresolved: string[] = []
  const seenPaths = new Set<string>()

  for (const { mention, hits } of lookups) {
    let bestMatch: { path: string; relPath: string; score: number } | null = null

    for (let index = 0; index < hits.length; index += 1) {
      const hit = hits[index]
      if (hit.isDirectory) continue

      const relPathRaw = toRelativePathIfInside(rootDir, hit.path) ?? hit.name
      const relPath = normalizeMentionPath(relPathRaw)
      if (!relPath) continue

      const relLower = relPath.toLowerCase()
      const nameLower = hit.name.toLowerCase()
      let score = 0

      if (relLower === mention) score += 500
      if (relLower.endsWith(`/${mention}`)) score += 320
      if (nameLower === mention) score += 220
      if (relLower.includes(mention)) score += 100
      score += Math.max(0, 30 - index)

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { path: hit.path, relPath, score }
      }
    }

    if (!bestMatch) {
      unresolved.push(mention)
      continue
    }

    if (seenPaths.has(bestMatch.path)) continue
    seenPaths.add(bestMatch.path)
    resolved.push({
      mention,
      path: bestMatch.path,
      relPath: bestMatch.relPath,
    })
  }

  return { resolved, unresolved }
}

export async function loadWorkspaceSnapshotStage(
  workingDirectory: string,
  deps: Pick<PrepareChatPromptDependencies, 'getWorkspaceSnapshot' | 'upsertWorkspaceSnapshot' | 'onWorkspaceSnapshotError'>
): Promise<WorkspaceContextSnapshot | null> {
  try {
    const workspaceSnapshot = await deps.getWorkspaceSnapshot(workingDirectory)
    deps.upsertWorkspaceSnapshot(workspaceSnapshot)
    return workspaceSnapshot
  } catch (error) {
    deps.onWorkspaceSnapshotError?.(error)
    return null
  }
}

export async function applyMentionReferencesStage(input: {
  prompt: string
  mentionTokens: string[]
  workingDirectory: string
  resolveMentionedFiles: PrepareChatPromptDependencies['resolveMentionedFiles']
  readReferencedFile: PrepareChatPromptDependencies['readReferencedFile']
}): Promise<MentionReferencesStageResult> {
  const { prompt, mentionTokens, workingDirectory, resolveMentionedFiles, readReferencedFile } = input
  if (mentionTokens.length === 0) {
    return {
      prompt,
      referenceNotes: [],
      resolvedMentionCount: 0,
      unresolvedMentionCount: 0,
    }
  }

  const { resolved, unresolved } = await resolveMentionedFiles(workingDirectory, mentionTokens)
  const referenceNotes: string[] = []
  const referencedContents: string[] = []

  for (const ref of resolved) {
    try {
      const fileData = await readReferencedFile(ref.path)
      const safeText = fileData.content.replace(/\0/g, '')
      referencedContents.push(`\n--- Referenced file: ${ref.relPath} ---\n${safeText}\n--- End: ${ref.relPath} ---`)
      if (fileData.truncated) {
        referenceNotes.push(`${ref.relPath} (truncated to 2MB preview)`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      referenceNotes.push(`${ref.relPath} (failed to read: ${errorMessage})`)
    }
  }

  let nextPrompt = prompt
  if (referencedContents.length > 0) {
    nextPrompt = `${nextPrompt}\n\nReferenced files via @:${referencedContents.join('\n')}`
  }

  if (unresolved.length > 0) {
    referenceNotes.push(`Unresolved @ references: ${unresolved.map((entry) => `@${entry}`).join(', ')}`)
  }

  return {
    prompt: nextPrompt,
    referenceNotes,
    resolvedMentionCount: resolved.length,
    unresolvedMentionCount: unresolved.length,
  }
}

export async function applyAttachmentFilesStage(input: {
  prompt: string
  files?: File[]
}): Promise<string> {
  const { files } = input
  if (!files || files.length === 0) {
    return input.prompt
  }

  const fileContents: string[] = []
  const binaryFiles: string[] = []

  for (const file of files) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (BINARY_EXTENSIONS.has(ext)) {
        binaryFiles.push(file.name)
        continue
      }
      const text = await file.text()
      const safeText = text.replace(/\0/g, '')
      fileContents.push(`\n--- File: ${file.name} ---\n${safeText}\n--- End: ${file.name} ---`)
    } catch {
      // Best effort only: failures should not block sending the prompt.
    }
  }

  let nextPrompt = input.prompt
  if (fileContents.length > 0) {
    nextPrompt = `${nextPrompt}\n\nAttached files:${fileContents.join('\n')}`
  }
  if (binaryFiles.length > 0) {
    nextPrompt = `${nextPrompt}\n\n[Attached binary files: ${binaryFiles.join(', ')} — binary content cannot be sent via CLI]`
  }
  return nextPrompt
}

export function applyReferenceNotesStage(prompt: string, referenceNotes: string[]): string {
  if (referenceNotes.length === 0) return prompt
  return `${prompt}\n\n[Reference notes: ${referenceNotes.join(' | ')}]`
}

export function applyConversationHistoryStage(input: {
  prompt: string
  historyMessages?: ChatMessage[]
  maxMessages?: number
  maxChars?: number
}): string {
  const history = input.historyMessages ?? []
  if (history.length === 0) return input.prompt

  const maxMessages = Math.max(1, input.maxMessages ?? MAX_HISTORY_MESSAGES)
  const maxChars = Math.max(800, input.maxChars ?? MAX_HISTORY_CHARS)
  const candidates = history
    .filter((message) => message.role !== 'thinking')
    .slice(-Math.max(maxMessages * 3, maxMessages))
  if (candidates.length === 0) return input.prompt

  const selected: string[] = []
  let consumedChars = 0
  let omitted = false

  for (let index = candidates.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = candidates[index]
    const normalizedContent = message.content.replace(/\0/g, '').trim()
    if (!normalizedContent) continue
    const serialized = `[${roleLabel(message.role, message.toolName)}] ${normalizedContent}`
    if (consumedChars + serialized.length > maxChars) {
      omitted = true
      break
    }
    selected.push(serialized)
    consumedChars += serialized.length + 1
  }

  if (selected.length === 0) return input.prompt

  selected.reverse()
  if (candidates.length > selected.length) {
    omitted = true
  }

  const header = [
    '[Conversation context]',
    'Use this transcript as established context from earlier turns in this same chat.',
  ]
  if (omitted) {
    header.push('Earlier turns were omitted for brevity.')
  }

  return `${header.join('\n')}\n${selected.join('\n')}\n\n[Current user request]\n${input.prompt}`
}

export function applyWorkspaceContextStage(
  prompt: string,
  workspaceSnapshot: WorkspaceContextSnapshot | null
): string {
  if (!workspaceSnapshot) return prompt
  return `${prompt}\n\n${buildWorkspaceContextPrompt(workspaceSnapshot)}`
}

export function applyOfficeContextStage(
  prompt: string,
  officeContext?: OfficePromptContext
): string {
  const lines: string[] = [
    '[Office collaboration context]',
    'You are in the shared office with the user right now.',
    'The user can watch your activity live and can give direct in-office feedback.',
    'Treat office feedback as immediate coaching and adapt your behavior accordingly.',
  ]

  if (officeContext?.latestReward) {
    lines.push(`latest_office_reward: ${officeContext.latestReward.rewardScore} (${officeContext.latestReward.status})`)
    if (officeContext.latestReward.notes.length > 0) {
      lines.push(`latest_reward_notes: ${officeContext.latestReward.notes.slice(0, 3).join(' | ')}`)
    }
  }

  if (officeContext && officeContext.recentFeedback.length > 0) {
    lines.push('recent_office_feedback:')
    for (const feedback of officeContext.recentFeedback.slice(0, 6)) {
      lines.push(`- ${feedback}`)
    }
  }

  return `${prompt}\n\n${lines.join('\n')}`
}

export async function prepareChatPrompt(
  input: PrepareChatPromptInput,
  deps: PrepareChatPromptDependencies
): Promise<PrepareChatPromptResult> {
  const mentionTokens = resolveMentionTokens(input.message, input.mentions)
  const workspaceSnapshot = await loadWorkspaceSnapshotStage(input.workingDirectory, deps)
  const withConversationHistory = applyConversationHistoryStage({
    prompt: input.message,
    historyMessages: input.historyMessages,
  })
  const mentionStage = await applyMentionReferencesStage({
    prompt: withConversationHistory,
    mentionTokens,
    workingDirectory: input.workingDirectory,
    resolveMentionedFiles: deps.resolveMentionedFiles,
    readReferencedFile: deps.readReferencedFile,
  })

  const withAttachments = await applyAttachmentFilesStage({
    prompt: mentionStage.prompt,
    files: input.files,
  })
  const withReferenceNotes = applyReferenceNotesStage(withAttachments, mentionStage.referenceNotes)
  const withWorkspaceContext = applyWorkspaceContextStage(withReferenceNotes, workspaceSnapshot)
  const prompt = applyOfficeContextStage(withWorkspaceContext, input.officeContext)

  return {
    prompt,
    mentionTokens,
    workspaceSnapshot,
    resolvedMentionCount: mentionStage.resolvedMentionCount,
    unresolvedMentionCount: mentionStage.unresolvedMentionCount,
  }
}
