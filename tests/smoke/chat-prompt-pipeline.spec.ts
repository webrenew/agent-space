import { expect, test } from '@playwright/test'
import type { WorkspaceContextSnapshot } from '../../src/renderer/types'
import {
  applyAttachmentFilesStage,
  applyConversationHistoryStage,
  applyOfficeContextStage,
  applyMentionReferencesStage,
  loadWorkspaceSnapshotStage,
  parseSlashCommandInput,
  prepareChatPrompt,
  resolveMentionTokens,
} from '../../src/renderer/components/chat/chatPromptPipeline'

function createTextFile(name: string, content: string): File {
  if (typeof File !== 'undefined') {
    return new File([content], name, { type: 'text/plain' })
  }
  return {
    name,
    text: async () => content,
  } as File
}

function createSnapshot(overrides: Partial<WorkspaceContextSnapshot> = {}): WorkspaceContextSnapshot {
  return {
    directory: '/tmp/workspace',
    generatedAt: 123,
    gitBranch: 'main',
    gitDirtyFiles: 2,
    topLevelDirectories: ['src'],
    topLevelFiles: ['README.md'],
    keyFiles: ['README.md'],
    npmScripts: ['build'],
    techHints: ['typescript'],
    readmeSnippet: 'Project summary',
    ...overrides,
  }
}

test('parseSlashCommandInput parses command name and args while ignoring // comments', () => {
  expect(parseSlashCommandInput('/plan alpha beta')).toEqual({
    name: 'plan',
    argsRaw: 'alpha beta',
    args: ['alpha', 'beta'],
  })
  expect(parseSlashCommandInput('//not-a-command')).toBeNull()
})

test('applyMentionReferencesStage appends referenced content and unresolved notes', async () => {
  const stage = await applyMentionReferencesStage({
    prompt: 'Please inspect @README',
    mentionTokens: ['README', 'missing-file'],
    workingDirectory: '/tmp/workspace',
    resolveMentionedFiles: async () => ({
      resolved: [{ mention: 'readme', path: '/tmp/workspace/README.md', relPath: 'README.md' }],
      unresolved: ['missing-file'],
    }),
    readReferencedFile: async () => ({ content: 'line\0two', truncated: true }),
  })

  expect(stage.prompt).toContain('Referenced files via @:')
  expect(stage.prompt).toContain('--- Referenced file: README.md ---')
  expect(stage.prompt).toContain('linetwo')
  expect(stage.referenceNotes).toContain('README.md (truncated to 2MB preview)')
  expect(stage.referenceNotes.some((note) => note.includes('Unresolved @ references: @missing-file'))).toBe(true)
  expect(stage.resolvedMentionCount).toBe(1)
  expect(stage.unresolvedMentionCount).toBe(1)
})

test('applyAttachmentFilesStage appends text and binary attachment context', async () => {
  const prompt = await applyAttachmentFilesStage({
    prompt: 'Base prompt',
    files: [
      createTextFile('notes.txt', 'hello world'),
      createTextFile('image.png', 'not-used'),
    ],
  })

  expect(prompt).toContain('Attached files:')
  expect(prompt).toContain('--- File: notes.txt ---')
  expect(prompt).toContain('hello world')
  expect(prompt).toContain('[Attached binary files: image.png')
})

test('applyConversationHistoryStage injects bounded transcript context', () => {
  const prompt = applyConversationHistoryStage({
    prompt: 'Please continue from where we left off',
    historyMessages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Summarize the auth refactor plan',
        timestamp: 1,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'We should migrate middleware first, then handlers.',
        timestamp: 2,
      },
      {
        id: 'm3',
        role: 'thinking',
        content: 'hidden',
        timestamp: 3,
      },
    ],
  })

  expect(prompt).toContain('[Conversation context]')
  expect(prompt).toContain('[User] Summarize the auth refactor plan')
  expect(prompt).toContain('[Assistant] We should migrate middleware first, then handlers.')
  expect(prompt).not.toContain('hidden')
  expect(prompt).toContain('[Current user request]')
})

test('prepareChatPrompt runs staged pipeline and injects workspace context', async () => {
  const snapshot = createSnapshot({ gitBranch: 'feature/pipeline' })
  const prepared = await prepareChatPrompt(
    {
      message: 'Need context for @README',
      historyMessages: [
        {
          id: 'h1',
          role: 'user',
          content: 'What changed in the README parser?',
          timestamp: 1,
        },
        {
          id: 'h2',
          role: 'assistant',
          content: 'It now validates frontmatter keys before rendering.',
          timestamp: 2,
        },
      ],
      mentions: undefined,
      files: [createTextFile('note.md', 'draft')],
      workingDirectory: '/tmp/workspace',
    },
    {
      getWorkspaceSnapshot: async () => snapshot,
      upsertWorkspaceSnapshot: () => {},
      resolveMentionedFiles: async (_rootDir, mentions) => ({
        resolved: mentions.includes('README')
          ? [{ mention: 'readme', path: '/tmp/workspace/README.md', relPath: 'README.md' }]
          : [],
        unresolved: [],
      }),
      readReferencedFile: async () => ({ content: 'readme body', truncated: false }),
    }
  )

  expect(resolveMentionTokens('Need context for @README')).toEqual(['README'])
  expect(prepared.prompt).toContain('[Conversation context]')
  expect(prepared.prompt).toContain('[Current user request]')
  expect(prepared.prompt).toContain('Referenced files via @:')
  expect(prepared.prompt).toContain('Attached files:')
  expect(prepared.prompt).toContain('[Workspace context snapshot]')
  expect(prepared.prompt).toContain('[Office collaboration context]')
  expect(prepared.prompt).toContain('You are in the shared office with the user right now.')
  expect(prepared.prompt).toContain('git_branch: feature/pipeline')
  expect(prepared.mentionTokens).toEqual(['README'])
})

test('applyOfficeContextStage includes reward and feedback injection', () => {
  const prompt = applyOfficeContextStage('Base prompt', {
    recentFeedback: ['Manual celebration: Pizza Party', 'Rewarded +10 morale (Pizza Party)'],
    latestReward: {
      rewardScore: 87,
      status: 'success',
      notes: ['Used 3 context files', 'Low unresolved mentions'],
    },
  })

  expect(prompt).toContain('[Office collaboration context]')
  expect(prompt).toContain('latest_office_reward: 87 (success)')
  expect(prompt).toContain('recent_office_feedback:')
  expect(prompt).toContain('- Manual celebration: Pizza Party')
  expect(prompt).toContain('- Rewarded +10 morale (Pizza Party)')
})

test('loadWorkspaceSnapshotStage swallows snapshot errors and reports them via callback', async () => {
  let capturedError: string | null = null
  const snapshot = await loadWorkspaceSnapshotStage('/tmp/workspace', {
    getWorkspaceSnapshot: async () => {
      throw new Error('snapshot failed')
    },
    upsertWorkspaceSnapshot: () => {
      throw new Error('should not be called')
    },
    onWorkspaceSnapshotError: (error) => {
      capturedError = error instanceof Error ? error.message : String(error)
    },
  })

  expect(snapshot).toBeNull()
  expect(capturedError).toBe('snapshot failed')
})
