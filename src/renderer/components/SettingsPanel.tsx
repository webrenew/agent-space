import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore, saveSettings } from '../store/settings'
import type {
  AppSettings,
  ClaudePermissionMode,
  ClaudeProfile,
  ClaudeSettingSource,
  ClaudeWorkspaceProfileRule,
  CursorStyle,
  SchedulerTaskInput,
  TodoRunnerJobInput,
  Scope,
  SubscriptionType,
  TerminalThemeName,
} from '../types'
import { DEFAULT_SETTINGS, SUBSCRIPTION_OPTIONS } from '../types'
import { THEME_NAMES, THEME_LABELS, getTheme } from '../lib/terminalThemes'
import { usePluginCatalog } from '../plugins/usePluginCatalog'
import { SchedulerTab } from './settings/SchedulerTab'
import { TodoRunnerTab } from './settings/TodoRunnerTab'
import {
  NumberInput,
  Row,
  Section,
  Select,
  Toggle,
} from './settings/common'
import { parseCsv, todoItemsFromText, todoItemsToText } from './settings/utils'
import type { SchedulerTaskDraft, TodoRunnerJobDraft } from './settings/types'
import { useSettingsDraft } from './settings/useSettingsDraft'
import { useJobAction } from './settings/useJobAction'

type Tab = 'general' | 'appearance' | 'terminal' | 'scopes' | 'schedules' | 'todoRunner' | 'subscription'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'scopes', label: 'Scopes' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'todoRunner', label: 'Todo Runner' },
  { id: 'subscription', label: 'Plan' }
]

const FONT_OPTIONS = [
  'Menlo, Monaco, "Courier New", monospace',
  '"SF Mono", Menlo, monospace',
  '"JetBrains Mono", monospace',
  '"Fira Code", monospace',
  '"Source Code Pro", monospace',
  '"IBM Plex Mono", monospace',
  'Consolas, monospace'
]

const FONT_LABELS: Record<string, string> = {
  'Menlo, Monaco, "Courier New", monospace': 'Menlo',
  '"SF Mono", Menlo, monospace': 'SF Mono',
  '"JetBrains Mono", monospace': 'JetBrains Mono',
  '"Fira Code", monospace': 'Fira Code',
  '"Source Code Pro", monospace': 'Source Code Pro',
  '"IBM Plex Mono", monospace': 'IBM Plex Mono',
  'Consolas, monospace': 'Consolas'
}

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' }
]

const SCOPE_COLOR_PRESETS = [
  '#4ade80', '#60a5fa', '#a78bfa', '#f87171', '#fbbf24',
  '#22d3ee', '#e879f9', '#fb923c', '#34d399', '#f472b6',
]

const CLAUDE_SETTING_SOURCE_OPTIONS: ClaudeSettingSource[] = ['user', 'project', 'local']
const CLAUDE_PERMISSION_MODE_OPTIONS: ClaudePermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'delegate',
  'dontAsk',
  'plan',
]

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const currentSettings = useSettingsStore((s) => s.settings)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [draft, setDraft] = useSettingsDraft(isOpen, currentSettings)
  const [scheduleDrafts, setScheduleDrafts] = useState<SchedulerTaskDraft[]>([])
  const [schedulerLoading, setSchedulerLoading] = useState(false)
  const [schedulerError, setSchedulerError] = useState<string | null>(null)
  const [schedulerBusyId, setSchedulerBusyId] = useState<string | null>(null)
  const [todoRunnerDrafts, setTodoRunnerDrafts] = useState<TodoRunnerJobDraft[]>([])
  const [todoRunnerLoading, setTodoRunnerLoading] = useState(false)
  const [todoRunnerError, setTodoRunnerError] = useState<string | null>(null)
  const [todoRunnerBusyId, setTodoRunnerBusyId] = useState<string | null>(null)
  const pluginCatalog = usePluginCatalog()

  const loadSchedules = useCallback(async () => {
    setSchedulerLoading(true)
    setSchedulerError(null)
    try {
      const schedules = await window.electronAPI.scheduler.list()
      setScheduleDrafts(schedules.map((schedule) => ({ ...schedule, isDraft: false })))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSchedulerError(message)
    } finally {
      setSchedulerLoading(false)
    }
  }, [])

  const loadTodoRunnerJobs = useCallback(async () => {
    setTodoRunnerLoading(true)
    setTodoRunnerError(null)
    try {
      const jobs = await window.electronAPI.todoRunner.list()
      setTodoRunnerDrafts(
        jobs.map((job) => ({
          ...job,
          isDraft: false,
          todoItemsText: todoItemsToText(job.todoItems),
        }))
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setTodoRunnerError(message)
    } finally {
      setTodoRunnerLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadSchedules()
    const unsubscribe = window.electronAPI.scheduler.onUpdated(() => {
      void loadSchedules()
    })
    return unsubscribe
  }, [isOpen, loadSchedules])

  useEffect(() => {
    if (!isOpen) return
    void loadTodoRunnerJobs()
    const unsubscribe = window.electronAPI.todoRunner.onUpdated(() => {
      void loadTodoRunnerJobs()
    })
    return unsubscribe
  }, [isOpen, loadTodoRunnerJobs])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, closeSettings])

  const updateGeneral = useCallback(
    (updates: Partial<AppSettings['general']>) => {
      setDraft((d) => ({ ...d, general: { ...d.general, ...updates } }))
    },
    []
  )

  const updateAppearance = useCallback(
    (updates: Partial<AppSettings['appearance']>) => {
      setDraft((d) => ({ ...d, appearance: { ...d.appearance, ...updates } }))
    },
    []
  )

  const updateTerminal = useCallback(
    (updates: Partial<AppSettings['terminal']>) => {
      setDraft((d) => ({ ...d, terminal: { ...d.terminal, ...updates } }))
    },
    []
  )

  const updateClaudeProfile = useCallback((profileId: string, updates: Partial<ClaudeProfile>) => {
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        profiles: d.claudeProfiles.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, ...updates } : profile
        ),
      },
    }))
  }, [])

  const toggleClaudeProfileSettingSource = useCallback((profileId: string, source: ClaudeSettingSource) => {
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        profiles: d.claudeProfiles.profiles.map((profile) => {
          if (profile.id !== profileId) return profile
          const hasSource = profile.settingSources.includes(source)
          const nextSources = hasSource
            ? profile.settingSources.filter((entry) => entry !== source)
            : [...profile.settingSources, source]
          return {
            ...profile,
            settingSources: nextSources.length > 0 ? nextSources : ['user', 'project', 'local'],
          }
        }),
      },
    }))
  }, [])

  const addClaudeProfile = useCallback(() => {
    const id = `profile-${Date.now()}`
    const profile: ClaudeProfile = {
      id,
      name: `Profile ${draft.claudeProfiles.profiles.length + 1}`,
      settingsPath: '',
      mcpConfigPath: '',
      pluginDirs: [],
      settingSources: ['user', 'project', 'local'],
      agent: '',
      permissionMode: 'default',
      strictMcpConfig: false,
    }
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        profiles: [...d.claudeProfiles.profiles, profile],
      },
    }))
  }, [draft.claudeProfiles.profiles.length])

  const removeClaudeProfile = useCallback((profileId: string) => {
    setDraft((d) => {
      if (d.claudeProfiles.profiles.length <= 1) return d
      const profiles = d.claudeProfiles.profiles.filter((profile) => profile.id !== profileId)
      const defaultProfileId = d.claudeProfiles.defaultProfileId === profileId
        ? (profiles[0]?.id ?? 'default')
        : d.claudeProfiles.defaultProfileId
      const workspaceRules = d.claudeProfiles.workspaceRules.filter((rule) => rule.profileId !== profileId)
      return {
        ...d,
        claudeProfiles: {
          ...d.claudeProfiles,
          profiles,
          defaultProfileId,
          workspaceRules,
        },
      }
    })
  }, [])

  const addClaudeWorkspaceRule = useCallback(() => {
    const firstProfile = draft.claudeProfiles.profiles[0]
    if (!firstProfile) return
    const rule: ClaudeWorkspaceProfileRule = {
      id: `rule-${Date.now()}`,
      pathPrefix: '',
      profileId: firstProfile.id,
    }
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        workspaceRules: [...d.claudeProfiles.workspaceRules, rule],
      },
    }))
  }, [draft.claudeProfiles.profiles])

  const updateClaudeWorkspaceRule = useCallback((ruleId: string, updates: Partial<ClaudeWorkspaceProfileRule>) => {
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        workspaceRules: d.claudeProfiles.workspaceRules.map((rule) =>
          rule.id === ruleId ? { ...rule, ...updates } : rule
        ),
      },
    }))
  }, [])

  const removeClaudeWorkspaceRule = useCallback((ruleId: string) => {
    setDraft((d) => ({
      ...d,
      claudeProfiles: {
        ...d.claudeProfiles,
        workspaceRules: d.claudeProfiles.workspaceRules.filter((rule) => rule.id !== ruleId),
      },
    }))
  }, [])

  const runSchedulerAction = useJobAction<SchedulerTaskDraft>({
    setBusyId: setSchedulerBusyId,
    setError: setSchedulerError,
    reload: loadSchedules,
  })

  const runTodoRunnerAction = useJobAction<TodoRunnerJobDraft>({
    setBusyId: setTodoRunnerBusyId,
    setError: setTodoRunnerError,
    reload: loadTodoRunnerJobs,
  })

  const updateScheduleDraft = useCallback((taskId: string, updates: Partial<SchedulerTaskDraft>) => {
    setScheduleDrafts((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...updates } : task)))
  }, [])

  const addScheduleDraft = useCallback(() => {
    const id = `draft-${Date.now()}`
    const fallbackDirectory = draft.general.customDirectory.trim()
    const now = Date.now()
    const task: SchedulerTaskDraft = {
      id,
      name: `Schedule ${scheduleDrafts.length + 1}`,
      cron: '0 9 * * 1-5',
      prompt: '',
      workingDirectory: fallbackDirectory,
      enabled: true,
      yoloMode: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: null,
      isRunning: false,
      lastRunAt: null,
      lastStatus: 'idle',
      lastError: null,
      lastDurationMs: null,
      lastRunTrigger: null,
      isDraft: true,
    }
    setScheduleDrafts((prev) => [...prev, task])
  }, [draft.general.customDirectory, scheduleDrafts.length])

  const removeSchedule = useCallback(async (task: SchedulerTaskDraft) => {
    if (task.isDraft) {
      setScheduleDrafts((prev) => prev.filter((entry) => entry.id !== task.id))
      return
    }

    await runSchedulerAction(task, async () => {
      await window.electronAPI.scheduler.delete(task.id)
    })
  }, [runSchedulerAction])

  const saveSchedule = useCallback(async (task: SchedulerTaskDraft) => {
    const payload: SchedulerTaskInput = {
      id: task.isDraft ? undefined : task.id,
      name: task.name,
      cron: task.cron,
      prompt: task.prompt,
      workingDirectory: task.workingDirectory,
      enabled: task.enabled,
      yoloMode: task.yoloMode,
    }

    await runSchedulerAction(task, async () => {
      await window.electronAPI.scheduler.upsert(payload)
    })
  }, [runSchedulerAction])

  const runScheduleNow = useCallback(async (task: SchedulerTaskDraft) => {
    if (task.isDraft) return

    await runSchedulerAction(task, async () => {
      await window.electronAPI.scheduler.runNow(task.id)
    })
  }, [runSchedulerAction])

  const browseScheduleDirectory = useCallback(async (taskId: string) => {
    const selected = await window.electronAPI.settings.selectDirectory()
    if (!selected) return
    updateScheduleDraft(taskId, { workingDirectory: selected })
  }, [updateScheduleDraft])

  const updateTodoRunnerDraft = useCallback((jobId: string, updates: Partial<TodoRunnerJobDraft>) => {
    setTodoRunnerDrafts((prev) => prev.map((job) => (job.id === jobId ? { ...job, ...updates } : job)))
  }, [])

  const addTodoRunnerDraft = useCallback(() => {
    const id = `todo-draft-${Date.now()}`
    const fallbackDirectory = draft.general.customDirectory.trim()
    const now = Date.now()
    const job: TodoRunnerJobDraft = {
      id,
      name: `Todo Run ${todoRunnerDrafts.length + 1}`,
      prompt: '',
      workingDirectory: fallbackDirectory,
      runnerCommand: '',
      enabled: true,
      yoloMode: false,
      todoItems: [],
      createdAt: now,
      updatedAt: now,
      isRunning: false,
      lastRunAt: null,
      lastStatus: 'idle',
      lastError: null,
      lastDurationMs: null,
      lastRunTrigger: null,
      totalTodos: 0,
      completedTodos: 0,
      failedTodos: 0,
      blockedTodos: 0,
      currentTodoIndex: null,
      nextTodoText: null,
      isDraft: true,
      todoItemsText: '',
    }
    setTodoRunnerDrafts((prev) => [...prev, job])
  }, [draft.general.customDirectory, todoRunnerDrafts.length])

  const removeTodoRunnerJob = useCallback(async (job: TodoRunnerJobDraft) => {
    if (job.isDraft) {
      setTodoRunnerDrafts((prev) => prev.filter((entry) => entry.id !== job.id))
      return
    }

    await runTodoRunnerAction(job, async () => {
      await window.electronAPI.todoRunner.delete(job.id)
    })
  }, [runTodoRunnerAction])

  const saveTodoRunnerJob = useCallback(async (job: TodoRunnerJobDraft) => {
    const payload: TodoRunnerJobInput = {
      id: job.isDraft ? undefined : job.id,
      name: job.name,
      prompt: job.prompt,
      workingDirectory: job.workingDirectory,
      runnerCommand: job.runnerCommand,
      enabled: job.enabled,
      yoloMode: job.yoloMode,
      todoItems: todoItemsFromText(job.todoItemsText),
    }

    await runTodoRunnerAction(job, async () => {
      await window.electronAPI.todoRunner.upsert(payload)
    })
  }, [runTodoRunnerAction])

  const startTodoRunnerJob = useCallback(async (job: TodoRunnerJobDraft) => {
    if (job.isDraft) return

    await runTodoRunnerAction(job, async () => {
      await window.electronAPI.todoRunner.start(job.id)
    })
  }, [runTodoRunnerAction])

  const pauseTodoRunnerJob = useCallback(async (job: TodoRunnerJobDraft) => {
    if (job.isDraft) return

    await runTodoRunnerAction(job, async () => {
      await window.electronAPI.todoRunner.pause(job.id)
    })
  }, [runTodoRunnerAction])

  const resetTodoRunnerJob = useCallback(async (job: TodoRunnerJobDraft) => {
    if (job.isDraft) return

    await runTodoRunnerAction(job, async () => {
      await window.electronAPI.todoRunner.reset(job.id)
    })
  }, [runTodoRunnerAction])

  const browseTodoRunnerDirectory = useCallback(async (jobId: string) => {
    const selected = await window.electronAPI.settings.selectDirectory()
    if (!selected) return
    updateTodoRunnerDraft(jobId, { workingDirectory: selected })
  }, [updateTodoRunnerDraft])

  const addScope = useCallback(() => {
    const id = `scope-${Date.now()}`
    const newScope: Scope = {
      id,
      name: 'New Scope',
      color: SCOPE_COLOR_PRESETS[draft.scopes.length % SCOPE_COLOR_PRESETS.length],
      directories: [],
      soundEvents: {},
    }
    setDraft((d) => ({ ...d, scopes: [...d.scopes, newScope] }))
  }, [draft.scopes.length])

  const removeScope = useCallback((scopeId: string) => {
    setDraft((d) => ({ ...d, scopes: d.scopes.filter((s) => s.id !== scopeId) }))
  }, [])

  const updateScope = useCallback((scopeId: string, updates: Partial<Scope>) => {
    setDraft((d) => ({
      ...d,
      scopes: d.scopes.map((s) => (s.id === scopeId ? { ...s, ...updates } : s)),
    }))
  }, [])

  const addDirectoryToScope = useCallback(async (scopeId: string) => {
    const dir = await window.electronAPI.settings.selectDirectory()
    if (!dir) return
    setDraft((d) => ({
      ...d,
      scopes: d.scopes.map((s) =>
        s.id === scopeId ? { ...s, directories: [...s.directories, dir] } : s
      ),
    }))
  }, [])

  const removeDirectoryFromScope = useCallback((scopeId: string, dirIndex: number) => {
    setDraft((d) => ({
      ...d,
      scopes: d.scopes.map((s) =>
        s.id === scopeId
          ? { ...s, directories: s.directories.filter((_, i) => i !== dirIndex) }
          : s
      ),
    }))
  }, [])

  const handleBrowse = useCallback(async () => {
    const dir = await window.electronAPI.settings.selectDirectory()
    if (dir) updateGeneral({ customDirectory: dir })
  }, [updateGeneral])

  const handleSave = useCallback(() => {
    saveSettings(draft)
  }, [draft])

  const handleReset = useCallback(() => {
    setDraft(DEFAULT_SETTINGS)
  }, [])

  if (!isOpen) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={closeSettings} />

      {/* Panel */}
      <div
        className="glass-panel"
        style={{
          position: 'relative', width: 600, maxHeight: '80vh',
          borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 0' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#9A9692', margin: 0 }}>Settings</h2>
          <button
            onClick={closeSettings}
            style={{ background: 'transparent', border: 'none', color: '#595653', fontSize: 18, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            &times;
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, padding: '0 18px', marginTop: 10, borderBottom: '1px solid rgba(89,86,83,0.2)' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="nav-item"
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
                background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                color: activeTab === tab.id ? '#548C5A' : '#595653',
                borderBottom: activeTab === tab.id ? '2px solid #548C5A' : '2px solid transparent',
                textShadow: activeTab === tab.id ? '0 0 8px rgba(84,140,90,0.4)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', minHeight: 0 }}>
          {activeTab === 'general' && (
            <>
              <Section title="STARTING DIRECTORY">
                <Row label="Open new terminals in">
                  <Select
                    value={draft.general.startingDirectory}
                    options={['home', 'custom']}
                    labels={{ home: 'Home Directory', custom: 'Custom Path' }}
                    onChange={(v) => updateGeneral({ startingDirectory: v as 'home' | 'custom' })}
                  />
                </Row>
                {draft.general.startingDirectory === 'custom' && (
                  <Row label="Custom path">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="text"
                        value={draft.general.customDirectory}
                        onChange={(e) => updateGeneral({ customDirectory: e.target.value })}
                        placeholder="/path/to/directory"
                        style={{
                          background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6, padding: '5px 8px', fontSize: 13, color: '#9A9692',
                          outline: 'none', fontFamily: 'inherit', width: 180,
                        }}
                      />
                      <button
                        onClick={handleBrowse}
                        style={{
                          padding: '5px 10px', fontSize: 12, fontWeight: 500,
                          background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6, color: '#9A9692', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Browse...
                      </button>
                    </div>
                  </Row>
                )}
              </Section>
              <Section title="SHELL">
                <Row label="Shell program">
                  <Select
                    value={draft.general.shell}
                    options={['default', 'custom']}
                    labels={{ default: 'Login Shell', custom: 'Custom' }}
                    onChange={(v) => updateGeneral({ shell: v as 'default' | 'custom' })}
                  />
                </Row>
                {draft.general.shell === 'custom' && (
                  <Row label="Custom shell">
                    <input
                      type="text"
                      value={draft.general.customShell}
                      onChange={(e) => updateGeneral({ customShell: e.target.value })}
                      placeholder="/bin/zsh"
                      style={{
                        background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                        borderRadius: 6, padding: '5px 8px', fontSize: 13, color: '#9A9692',
                        outline: 'none', fontFamily: 'inherit', width: 180,
                      }}
                    />
                  </Row>
                )}
              </Section>
              <Section title="DIAGNOSTICS">
                <Row label="Crash & health telemetry">
                  <Toggle
                    checked={draft.telemetry.enabled}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, telemetry: { ...d.telemetry, enabled: v } }))
                    }
                  />
                </Row>
                <div style={{ fontSize: 11, color: '#595653', lineHeight: 1.5 }}>
                  Stores local crash and startup diagnostics in <code>~/.agent-observer/telemetry.ndjson</code>.
                </div>
              </Section>
              <Section title="CLAUDE PROFILES">
                <Row label="Default profile">
                  <Select
                    value={draft.claudeProfiles.defaultProfileId}
                    options={draft.claudeProfiles.profiles.map((profile) => profile.id)}
                    labels={Object.fromEntries(
                      draft.claudeProfiles.profiles.map((profile) => [profile.id, profile.name || profile.id])
                    )}
                    onChange={(value) =>
                      setDraft((d) => ({
                        ...d,
                        claudeProfiles: {
                          ...d.claudeProfiles,
                          defaultProfileId: value,
                        },
                      }))
                    }
                  />
                </Row>

                <div style={{ fontSize: 11, color: '#595653', lineHeight: 1.5, marginBottom: 8 }}>
                  Profiles let you isolate Claude settings, MCP config, and plugin dirs per workspace.
                </div>
                <div style={{ fontSize: 11, color: '#74747C', lineHeight: 1.5, marginBottom: 8 }}>
                  Runtime discovery: {pluginCatalog.plugins.length} plugin{pluginCatalog.plugins.length === 1 ? '' : 's'}
                  {' '}across {pluginCatalog.directories.length} dir{pluginCatalog.directories.length === 1 ? '' : 's'}.
                </div>
                <div style={{ fontSize: 11, color: '#74747C', lineHeight: 1.5, marginBottom: 8 }}>
                  Runtime commands: {pluginCatalog.commands.length} registered.
                </div>
                {pluginCatalog.commands.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {pluginCatalog.commands.slice(0, 6).map((command) => (
                      <span
                        key={`${command.pluginId}:${command.name}`}
                        title={`${command.description ?? 'No description'} (${command.pluginId})`}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          border: '1px solid rgba(76,137,217,0.35)',
                          background: 'rgba(76,137,217,0.12)',
                          color: '#4C89D9',
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: 0.3,
                        }}
                      >
                        /{command.name}
                      </span>
                    ))}
                    {pluginCatalog.commands.length > 6 && (
                      <span style={{ fontSize: 10, color: '#595653', alignSelf: 'center' }}>
                        +{pluginCatalog.commands.length - 6} more
                      </span>
                    )}
                  </div>
                )}
                {pluginCatalog.plugins.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {pluginCatalog.plugins.slice(0, 6).map((plugin) => (
                      (() => {
                        const isLoaded = plugin.loadState === 'loaded'
                        const isFailed = plugin.loadState === 'failed'
                        const border = isLoaded
                          ? '1px solid rgba(84,140,90,0.35)'
                          : isFailed
                            ? '1px solid rgba(200,120,48,0.45)'
                            : '1px solid rgba(116,116,124,0.35)'
                        const background = isLoaded
                          ? 'rgba(84,140,90,0.12)'
                          : isFailed
                            ? 'rgba(200,120,48,0.12)'
                            : 'rgba(116,116,124,0.12)'
                        const color = isLoaded ? '#7FB887' : isFailed ? '#c87830' : '#9A9692'
                        return (
                          <span
                            key={plugin.manifestPath}
                            title={`${plugin.rootDir} (${plugin.source})${plugin.loadError ? `\n${plugin.loadError}` : ''}`}
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              border,
                              background,
                              color,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: 0.3,
                            }}
                          >
                            {plugin.name}
                          </span>
                        )
                      })()
                    ))}
                    {pluginCatalog.plugins.length > 6 && (
                      <span style={{ fontSize: 10, color: '#595653', alignSelf: 'center' }}>
                        +{pluginCatalog.plugins.length - 6} more
                      </span>
                    )}
                  </div>
                )}
                {pluginCatalog.warnings.length > 0 && (
                  <div style={{ fontSize: 11, color: '#c87830', lineHeight: 1.5, marginBottom: 10 }}>
                    {pluginCatalog.warnings.slice(0, 2).join(' • ')}
                    {pluginCatalog.warnings.length > 2
                      ? ` • +${pluginCatalog.warnings.length - 2} more`
                      : ''}
                  </div>
                )}

                {draft.claudeProfiles.profiles.map((profile) => (
                  <div
                    key={profile.id}
                    style={{
                      border: '1px solid rgba(89,86,83,0.25)',
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 10,
                      background: 'rgba(14,14,13,0.35)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 12, color: '#74747C' }}>{profile.id}</span>
                        <input
                          type="text"
                          value={profile.name}
                          onChange={(e) => updateClaudeProfile(profile.id, { name: e.target.value })}
                          placeholder="Profile name"
                          style={{
                            width: 180,
                            background: 'rgba(89,86,83,0.15)',
                            border: '1px solid rgba(89,86,83,0.3)',
                            borderRadius: 6,
                            padding: '5px 8px',
                            fontSize: 13,
                            color: '#9A9692',
                            outline: 'none',
                            fontFamily: 'inherit',
                          }}
                        />
                      </div>
                      <button
                        onClick={() => removeClaudeProfile(profile.id)}
                        disabled={draft.claudeProfiles.profiles.length <= 1}
                        style={{
                          padding: '5px 10px',
                          fontSize: 12,
                          fontWeight: 500,
                          background: 'rgba(196,80,80,0.12)',
                          border: '1px solid rgba(196,80,80,0.32)',
                          borderRadius: 6,
                          color: '#c45050',
                          cursor: draft.claudeProfiles.profiles.length <= 1 ? 'default' : 'pointer',
                          fontFamily: 'inherit',
                          opacity: draft.claudeProfiles.profiles.length <= 1 ? 0.45 : 1,
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <Row label="Settings file">
                      <input
                        type="text"
                        value={profile.settingsPath}
                        onChange={(e) => updateClaudeProfile(profile.id, { settingsPath: e.target.value })}
                        placeholder="~/.agent-observer/claude-profiles/work/settings.json"
                        style={{
                          width: 320,
                          background: 'rgba(89,86,83,0.15)',
                          border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 12,
                          color: '#9A9692',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                    </Row>

                    <Row label="MCP config">
                      <input
                        type="text"
                        value={profile.mcpConfigPath}
                        onChange={(e) => updateClaudeProfile(profile.id, { mcpConfigPath: e.target.value })}
                        placeholder="~/.agent-observer/claude-profiles/work/mcp.json"
                        style={{
                          width: 320,
                          background: 'rgba(89,86,83,0.15)',
                          border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 12,
                          color: '#9A9692',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                    </Row>

                    <Row label="Plugin dirs (csv)">
                      <input
                        type="text"
                        value={profile.pluginDirs.join(', ')}
                        onChange={(e) => updateClaudeProfile(profile.id, { pluginDirs: parseCsv(e.target.value) })}
                        placeholder="~/profile/plugins, /path/to/other/plugins"
                        style={{
                          width: 320,
                          background: 'rgba(89,86,83,0.15)',
                          border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 12,
                          color: '#9A9692',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                    </Row>

                    <Row label="Agent alias">
                      <input
                        type="text"
                        value={profile.agent}
                        onChange={(e) => updateClaudeProfile(profile.id, { agent: e.target.value })}
                        placeholder="reviewer"
                        style={{
                          width: 160,
                          background: 'rgba(89,86,83,0.15)',
                          border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 12,
                          color: '#9A9692',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                    </Row>

                    <Row label="Permission mode">
                      <Select
                        value={profile.permissionMode}
                        options={CLAUDE_PERMISSION_MODE_OPTIONS}
                        onChange={(value) => updateClaudeProfile(profile.id, { permissionMode: value as ClaudePermissionMode })}
                      />
                    </Row>

                    <Row label="Strict MCP config">
                      <Toggle
                        checked={profile.strictMcpConfig}
                        onChange={(strictMcpConfig) => updateClaudeProfile(profile.id, { strictMcpConfig })}
                      />
                    </Row>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: '#74747C', marginBottom: 4, letterSpacing: 0.8 }}>
                        SETTING SOURCES
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {CLAUDE_SETTING_SOURCE_OPTIONS.map((source) => {
                          const active = profile.settingSources.includes(source)
                          return (
                            <button
                              key={source}
                              onClick={() => toggleClaudeProfileSettingSource(profile.id, source)}
                              style={{
                                padding: '3px 8px',
                                fontSize: 11,
                                fontWeight: 600,
                                borderRadius: 999,
                                border: `1px solid ${active ? 'rgba(84,140,90,0.45)' : 'rgba(89,86,83,0.3)'}`,
                                color: active ? '#548C5A' : '#74747C',
                                background: active ? 'rgba(84,140,90,0.12)' : 'rgba(89,86,83,0.1)',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {source}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addClaudeProfile}
                  style={{
                    marginBottom: 10,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'rgba(89,86,83,0.15)',
                    border: '1px solid rgba(89,86,83,0.3)',
                    borderRadius: 6,
                    color: '#9A9692',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add Profile
                </button>

                <div style={{ fontSize: 10, color: '#74747C', marginBottom: 6, letterSpacing: 0.8 }}>
                  WORKSPACE RULES
                </div>
                {draft.claudeProfiles.workspaceRules.length === 0 && (
                  <div style={{ fontSize: 12, color: '#595653', marginBottom: 8 }}>
                    No workspace rules. Default profile applies everywhere.
                  </div>
                )}
                {draft.claudeProfiles.workspaceRules.map((rule) => (
                  <div
                    key={rule.id}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
                  >
                    <input
                      type="text"
                      value={rule.pathPrefix}
                      onChange={(e) => updateClaudeWorkspaceRule(rule.id, { pathPrefix: e.target.value })}
                      placeholder="/Users/tradecraft/dev/work-project"
                      style={{
                        flex: 1,
                        background: 'rgba(89,86,83,0.15)',
                        border: '1px solid rgba(89,86,83,0.3)',
                        borderRadius: 6,
                        padding: '5px 8px',
                        fontSize: 12,
                        color: '#9A9692',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    <Select
                      value={rule.profileId}
                      options={draft.claudeProfiles.profiles.map((profile) => profile.id)}
                      labels={Object.fromEntries(
                        draft.claudeProfiles.profiles.map((profile) => [profile.id, profile.name || profile.id])
                      )}
                      onChange={(profileId) => updateClaudeWorkspaceRule(rule.id, { profileId })}
                    />
                    <button
                      onClick={() => removeClaudeWorkspaceRule(rule.id)}
                      style={{
                        padding: '5px 10px',
                        fontSize: 12,
                        fontWeight: 500,
                        background: 'rgba(196,80,80,0.12)',
                        border: '1px solid rgba(196,80,80,0.32)',
                        borderRadius: 6,
                        color: '#c45050',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={addClaudeWorkspaceRule}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'rgba(89,86,83,0.15)',
                    border: '1px solid rgba(89,86,83,0.3)',
                    borderRadius: 6,
                    color: '#9A9692',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add Rule
                </button>
              </Section>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <Section title="THEME">
                <Row label="Theme">
                  <Select
                    value={draft.appearance.terminalTheme}
                    options={THEME_NAMES as unknown as string[]}
                    labels={THEME_LABELS as unknown as Record<string, string>}
                    onChange={(v) => updateAppearance({ terminalTheme: v as TerminalThemeName })}
                  />
                </Row>
                <div style={{ display: 'flex', gap: 5, padding: '8px 0' }}>
                  {(() => {
                    const t = getTheme(draft.appearance.terminalTheme)
                    return [t.background, t.foreground, t.red, t.green, t.blue, t.yellow, t.magenta, t.cyan].map((c, i) => (
                      <span key={i} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c as string }} />
                    ))
                  })()}
                </div>
              </Section>
              <Section title="FONT">
                <Row label="Font family">
                  <Select
                    value={draft.appearance.fontFamily}
                    options={FONT_OPTIONS}
                    labels={FONT_LABELS}
                    onChange={(v) => updateAppearance({ fontFamily: v })}
                  />
                </Row>
                <Row label="Font size">
                  <NumberInput
                    value={draft.appearance.fontSize}
                    min={8}
                    max={32}
                    step={1}
                    onChange={(v) => updateAppearance({ fontSize: v })}
                  />
                </Row>
              </Section>
              <Section title="CURSOR">
                <Row label="Cursor style">
                  <div style={{ display: 'flex', gap: 4 }}>
                    {CURSOR_STYLES.map((cs) => (
                      <button
                        key={cs.value}
                        onClick={() => updateAppearance({ cursorStyle: cs.value })}
                        style={{
                          padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
                          fontFamily: 'inherit', transition: 'all 0.2s ease',
                          background: draft.appearance.cursorStyle === cs.value ? 'rgba(84,140,90,0.2)' : 'rgba(89,86,83,0.1)',
                          border: `1px solid ${draft.appearance.cursorStyle === cs.value ? 'rgba(84,140,90,0.5)' : 'rgba(89,86,83,0.3)'}`,
                          color: draft.appearance.cursorStyle === cs.value ? '#548C5A' : '#74747C',
                        }}
                      >
                        {cs.label}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Cursor blink">
                  <Toggle
                    checked={draft.appearance.cursorBlink}
                    onChange={(v) => updateAppearance({ cursorBlink: v })}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'terminal' && (
            <>
              <Section title="SCROLLBACK">
                <Row label="Scrollback lines">
                  <NumberInput
                    value={draft.terminal.scrollbackLines}
                    min={100}
                    max={100000}
                    step={500}
                    onChange={(v) => updateTerminal({ scrollbackLines: v })}
                  />
                </Row>
              </Section>
              <Section title="BEHAVIOR">
                <Row label="Copy on select">
                  <Toggle
                    checked={draft.terminal.copyOnSelect}
                    onChange={(v) => updateTerminal({ copyOnSelect: v })}
                  />
                </Row>
                <Row label="Option as Meta key">
                  <Toggle
                    checked={draft.terminal.optionAsMeta}
                    onChange={(v) => updateTerminal({ optionAsMeta: v })}
                  />
                </Row>
              </Section>
              <Section title="BELL">
                <Row label="Visual bell">
                  <Toggle
                    checked={draft.terminal.visualBell}
                    onChange={(v) => updateTerminal({ visualBell: v })}
                  />
                </Row>
                <Row label="Audible bell">
                  <Toggle
                    checked={draft.terminal.audibleBell}
                    onChange={(v) => updateTerminal({ audibleBell: v })}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'scopes' && (
            <>
              <Section title="CHAT COMPLETION DING">
                <Row label="Play system ding">
                  <Toggle
                    checked={draft.soundsEnabled}
                    onChange={(v) => setDraft((d) => ({ ...d, soundsEnabled: v }))}
                  />
                </Row>
              </Section>

              <Section title="SCOPES">
                {draft.scopes.length === 0 && (
                  <div style={{ fontSize: 12, color: '#595653', padding: '10px 0' }}>
                    No scopes configured. Add a scope to group terminals by project.
                  </div>
                )}
                {draft.scopes.map((scope) => (
                  <div key={scope.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(89,86,83,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        value={scope.name}
                        onChange={(e) => updateScope(scope.id, { name: e.target.value })}
                        style={{
                          flex: 1, background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6, padding: '4px 8px', fontSize: 13, color: '#9A9692',
                          outline: 'none', fontFamily: 'inherit',
                        }}
                      />
                      <input
                        type="text"
                        value={scope.color}
                        onChange={(e) => updateScope(scope.id, { color: e.target.value })}
                        placeholder="#hex"
                        style={{
                          width: 72, background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                          borderRadius: 6, padding: '4px 8px', fontSize: 13, color: '#9A9692',
                          outline: 'none', fontFamily: 'inherit',
                        }}
                      />
                      <span style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: scope.color }} />
                      <button
                        onClick={() => removeScope(scope.id)}
                        style={{
                          background: 'transparent', border: 'none', color: '#595653', fontSize: 12,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Color presets */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      {SCOPE_COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          onClick={() => updateScope(scope.id, { color })}
                          style={{
                            width: 16, height: 16, borderRadius: '50%', backgroundColor: color, cursor: 'pointer',
                            border: scope.color === color ? '2px solid #9A9692' : '2px solid transparent',
                            transform: scope.color === color ? 'scale(1.25)' : 'scale(1)',
                            transition: 'all 0.15s ease',
                          }}
                        />
                      ))}
                    </div>

                    {/* Directories */}
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: '#74747C', marginBottom: 4, marginTop: 10 }}>
                      DIRECTORIES
                    </div>
                    {scope.directories.length === 0 && (
                      <div style={{ fontSize: 12, color: '#595653', marginBottom: 4 }}>No directories</div>
                    )}
                    {scope.directories.map((dir, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: '#74747C', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{dir}</span>
                        <button
                          onClick={() => removeDirectoryFromScope(scope.id, i)}
                          style={{ background: 'transparent', border: 'none', color: '#595653', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addDirectoryToScope(scope.id)}
                      style={{ background: 'transparent', border: 'none', color: '#548C5A', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}
                    >
                      + Add directory
                    </button>

                  </div>
                ))}

                <button
                  onClick={addScope}
                  style={{
                    marginTop: 8, padding: '5px 12px', fontSize: 12, fontWeight: 500,
                    background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                    borderRadius: 6, color: '#9A9692', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  + Add Scope
                </button>
              </Section>

              <Section title="DEFAULT SCOPE">
                <Row label="Color for unmatched terminals">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="text"
                      value={draft.defaultScope.color}
                      onChange={(e) => setDraft((d) => ({ ...d, defaultScope: { ...d.defaultScope, color: e.target.value } }))}
                      style={{
                        width: 72, background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                        borderRadius: 6, padding: '4px 8px', fontSize: 13, color: '#9A9692',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                    <span style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: draft.defaultScope.color }} />
                  </div>
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'schedules' && (
            <SchedulerTab
              schedulerError={schedulerError}
              schedulerLoading={schedulerLoading}
              schedulerBusyId={schedulerBusyId}
              scheduleDrafts={scheduleDrafts}
              updateScheduleDraft={updateScheduleDraft}
              browseScheduleDirectory={browseScheduleDirectory}
              runScheduleNow={runScheduleNow}
              saveSchedule={saveSchedule}
              removeSchedule={removeSchedule}
              addScheduleDraft={addScheduleDraft}
            />
          )}

          {activeTab === 'todoRunner' && (
            <TodoRunnerTab
              todoRunnerError={todoRunnerError}
              todoRunnerLoading={todoRunnerLoading}
              todoRunnerBusyId={todoRunnerBusyId}
              todoRunnerDrafts={todoRunnerDrafts}
              updateTodoRunnerDraft={updateTodoRunnerDraft}
              browseTodoRunnerDirectory={browseTodoRunnerDirectory}
              startTodoRunnerJob={startTodoRunnerJob}
              pauseTodoRunnerJob={pauseTodoRunnerJob}
              resetTodoRunnerJob={resetTodoRunnerJob}
              saveTodoRunnerJob={saveTodoRunnerJob}
              removeTodoRunnerJob={removeTodoRunnerJob}
              addTodoRunnerDraft={addTodoRunnerDraft}
            />
          )}

          {activeTab === 'subscription' && (
            <>
              <Section title="SUBSCRIPTION PLAN">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
                  {(Object.entries(SUBSCRIPTION_OPTIONS) as [SubscriptionType, { label: string; monthlyCost: number }][]).map(([key, opt]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
                      <input
                        type="radio"
                        name="subscription"
                        value={key}
                        checked={draft.subscription.type === key}
                        onChange={() =>
                          setDraft((d) => ({
                            ...d,
                            subscription: { type: key, monthlyCost: opt.monthlyCost }
                          }))
                        }
                        style={{ accentColor: '#548C5A' }}
                      />
                      <span style={{ fontSize: 13, color: '#9A9692' }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </Section>
              <Section title="ABOUT">
                <div style={{ fontSize: 12, color: '#595653', padding: '8px 0', lineHeight: 1.6 }}>
                  <p style={{ margin: '4px 0' }}>Subscription plan affects cost display in StatsBar and Observability panel.</p>
                  <p style={{ margin: '4px 0' }}>Claude Max users see estimated savings instead of API costs.</p>
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 18px', borderTop: '1px solid rgba(89,86,83,0.2)',
        }}>
          <button
            onClick={handleReset}
            style={{ background: 'transparent', border: 'none', color: '#595653', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Reset to Defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={closeSettings}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
                background: 'rgba(89,86,83,0.15)', border: '1px solid rgba(89,86,83,0.3)',
                borderRadius: 6, color: '#9A9692', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="glow-green"
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                background: '#548C5A', border: 'none',
                borderRadius: 6, color: '#0E0E0D', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
