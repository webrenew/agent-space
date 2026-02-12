import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore, saveSettings } from '../store/settings'
import type { AppSettings, CursorStyle, SubscriptionType, Scope, SoundEventType, SystemSound, TerminalThemeName } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_SOUND_EVENTS, DEFAULT_SCOPE, SUBSCRIPTION_OPTIONS } from '../types'
import { THEME_NAMES, THEME_LABELS, getTheme } from '../lib/terminalThemes'
import { SYSTEM_SOUND_NAMES, playSystemSound } from '../lib/soundPlayer'

type Tab = 'general' | 'appearance' | 'terminal' | 'scopes' | 'subscription'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'scopes', label: 'Scopes' },
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

const SOUND_EVENT_LABELS: Record<SoundEventType, string> = {
  commit: 'Git Commit',
  push: 'Git Push',
  test_pass: 'Tests Passed',
  test_fail: 'Tests Failed',
  build_pass: 'Build Passed',
  build_fail: 'Build Failed',
  agent_done: 'Agent Done',
  error: 'Error',
}

const SCOPE_COLOR_PRESETS = [
  '#4ade80', '#60a5fa', '#a78bfa', '#f87171', '#fbbf24',
  '#22d3ee', '#e879f9', '#fb923c', '#34d399', '#f472b6',
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-white/20'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  )
}

function Select({
  value,
  options,
  labels,
  onChange
}: {
  value: string
  options: string[]
  labels?: Record<string, string>
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/10 border border-white/15 rounded-md px-2 py-1.5 text-sm text-white outline-none focus:border-green-400/50 min-w-[160px]"
    >
      {options.map((opt) => (
        <option key={opt} value={opt} className="bg-[#1a1a2e]">
          {labels?.[opt] ?? opt}
        </option>
      ))}
    </select>
  )
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const parsed = Number(e.target.value)
        if (!isNaN(parsed) && parsed >= (min ?? 0) && parsed <= (max ?? Infinity)) {
          onChange(parsed)
        }
      }}
      className="bg-white/10 border border-white/15 rounded-md px-2 py-1.5 text-sm text-white outline-none focus:border-green-400/50 w-20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-300">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{title}</div>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  )
}

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const currentSettings = useSettingsStore((s) => s.settings)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<AppSettings>(currentSettings)

  // Sync draft when modal opens
  useEffect(() => {
    if (isOpen) setDraft(currentSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

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

  const updateScopes = useCallback(
    (scopes: Scope[]) => {
      setDraft((d) => ({ ...d, scopes }))
    },
    []
  )

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

  const updateScopeSoundEvent = useCallback((scopeId: string, event: SoundEventType, value: SystemSound | 'none' | '') => {
    setDraft((d) => ({
      ...d,
      scopes: d.scopes.map((s) => {
        if (s.id !== scopeId) return s
        const soundEvents = { ...s.soundEvents }
        if (value === '') {
          delete soundEvents[event]
        } else {
          soundEvents[event] = value
        }
        return { ...s, soundEvents }
      }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeSettings} />

      {/* Panel */}
      <div className="relative w-[600px] max-h-[80vh] bg-black/90 backdrop-blur-md rounded-xl border border-white/15 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <button
            onClick={closeSettings}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-5 mt-3 border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-400 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {activeTab === 'general' && (
            <>
              <Section title="Starting Directory">
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
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={draft.general.customDirectory}
                        onChange={(e) => updateGeneral({ customDirectory: e.target.value })}
                        placeholder="/path/to/directory"
                        className="bg-white/10 border border-white/15 rounded-md px-2 py-1.5 text-sm text-white outline-none focus:border-green-400/50 w-48"
                      />
                      <button
                        onClick={handleBrowse}
                        className="px-2.5 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/15 border border-white/15 rounded-md text-gray-300 transition-colors"
                      >
                        Browse...
                      </button>
                    </div>
                  </Row>
                )}
              </Section>
              <Section title="Shell">
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
                      className="bg-white/10 border border-white/15 rounded-md px-2 py-1.5 text-sm text-white outline-none focus:border-green-400/50 w-48"
                    />
                  </Row>
                )}
              </Section>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <Section title="Theme">
                <Row label="Terminal theme">
                  <Select
                    value={draft.appearance.terminalTheme}
                    options={THEME_NAMES as unknown as string[]}
                    labels={THEME_LABELS as unknown as Record<string, string>}
                    onChange={(v) => updateAppearance({ terminalTheme: v as TerminalThemeName })}
                  />
                </Row>
                <div className="flex gap-1.5 py-2">
                  {(() => {
                    const t = getTheme(draft.appearance.terminalTheme)
                    return [t.background, t.foreground, t.red, t.green, t.blue, t.yellow, t.magenta, t.cyan].map((c, i) => (
                      <span key={i} className="w-5 h-5 rounded" style={{ backgroundColor: c as string }} />
                    ))
                  })()}
                </div>
              </Section>
              <Section title="Font">
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
              <Section title="Cursor">
                <Row label="Cursor style">
                  <div className="flex gap-1">
                    {CURSOR_STYLES.map((cs) => (
                      <button
                        key={cs.value}
                        onClick={() => updateAppearance({ cursorStyle: cs.value })}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                          draft.appearance.cursorStyle === cs.value
                            ? 'bg-green-500/20 border-green-400/50 text-green-400'
                            : 'bg-white/5 border-white/15 text-gray-400 hover:text-white'
                        }`}
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
              <Section title="Scrollback">
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
              <Section title="Behavior">
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
              <Section title="Bell">
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
              <Section title="Notification Sounds">
                <Row label="Enable sounds">
                  <Toggle
                    checked={draft.soundsEnabled}
                    onChange={(v) => setDraft((d) => ({ ...d, soundsEnabled: v }))}
                  />
                </Row>
              </Section>

              <Section title="Scopes">
                {draft.scopes.length === 0 && (
                  <div className="text-xs text-white/40 py-3">
                    No scopes configured. Add a scope to group terminals by project.
                  </div>
                )}
                {draft.scopes.map((scope) => (
                  <div key={scope.id} className="py-3 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={scope.name}
                        onChange={(e) => updateScope(scope.id, { name: e.target.value })}
                        className="bg-white/10 border border-white/15 rounded-md px-2 py-1 text-sm text-white outline-none focus:border-green-400/50 flex-1"
                      />
                      <input
                        type="text"
                        value={scope.color}
                        onChange={(e) => updateScope(scope.id, { color: e.target.value })}
                        className="bg-white/10 border border-white/15 rounded-md px-2 py-1 text-sm text-white outline-none focus:border-green-400/50 w-20 font-mono"
                        placeholder="#hex"
                      />
                      <span className="w-5 h-5 rounded" style={{ backgroundColor: scope.color }} />
                      <button
                        onClick={() => removeScope(scope.id)}
                        className="text-gray-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-red-400/10 transition-colors"
                      >
                        Remove
                      </button>
                    </div>

                    {/* Color presets */}
                    <div className="flex gap-1 mb-2">
                      {SCOPE_COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          onClick={() => updateScope(scope.id, { color })}
                          className={`w-4 h-4 rounded-full border transition-all ${
                            scope.color === color ? 'border-white scale-125' : 'border-transparent hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>

                    {/* Directories */}
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 mt-3">
                      Directories
                    </div>
                    {scope.directories.length === 0 && (
                      <div className="text-xs text-white/30 mb-1">No directories</div>
                    )}
                    {scope.directories.map((dir, i) => (
                      <div key={i} className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs text-gray-400 font-mono truncate flex-1">{dir}</span>
                        <button
                          onClick={() => removeDirectoryFromScope(scope.id, i)}
                          className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addDirectoryToScope(scope.id)}
                      className="text-xs text-green-400 hover:text-green-300 transition-colors mt-1"
                    >
                      + Add directory
                    </button>

                    {/* Per-scope sounds */}
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 mt-3">
                      Sound Overrides
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {(Object.keys(SOUND_EVENT_LABELS) as SoundEventType[]).map((evt) => (
                        <div key={evt} className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 flex-1">{SOUND_EVENT_LABELS[evt]}</span>
                          <select
                            value={scope.soundEvents[evt] ?? ''}
                            onChange={(e) => updateScopeSoundEvent(scope.id, evt, e.target.value as SystemSound | 'none' | '')}
                            className="bg-white/10 border border-white/15 rounded px-1 py-0.5 text-[11px] text-white outline-none w-20"
                          >
                            <option value="" className="bg-[#1a1a2e]">Default</option>
                            <option value="none" className="bg-[#1a1a2e]">None</option>
                            {SYSTEM_SOUND_NAMES.map((s) => (
                              <option key={s} value={s} className="bg-[#1a1a2e]">{s}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sound = scope.soundEvents[evt] || DEFAULT_SOUND_EVENTS[evt]
                              if (sound && sound !== 'none') playSystemSound(sound as SystemSound)
                            }}
                            className="text-gray-500 hover:text-white text-xs transition-colors"
                            title="Preview"
                          >
                            ▶
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <button
                  onClick={addScope}
                  className="mt-2 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/15 border border-white/15 rounded-md text-gray-300 transition-colors"
                >
                  + Add Scope
                </button>
              </Section>

              <Section title="Default Scope">
                <Row label="Color for unmatched terminals">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draft.defaultScope.color}
                      onChange={(e) => setDraft((d) => ({ ...d, defaultScope: { ...d.defaultScope, color: e.target.value } }))}
                      className="bg-white/10 border border-white/15 rounded-md px-2 py-1 text-sm text-white outline-none focus:border-green-400/50 w-20 font-mono"
                    />
                    <span className="w-5 h-5 rounded" style={{ backgroundColor: draft.defaultScope.color }} />
                  </div>
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'subscription' && (
            <>
              <Section title="Subscription Plan">
                <div className="space-y-2 py-2">
                  {(Object.entries(SUBSCRIPTION_OPTIONS) as [SubscriptionType, { label: string; monthlyCost: number }][]).map(([key, opt]) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer py-1">
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
                        className="accent-emerald-400"
                      />
                      <span className="text-sm text-gray-300">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </Section>
              <Section title="About">
                <div className="text-xs text-white/40 py-2 space-y-1">
                  <p>Subscription plan affects cost display in StatsBar and Observability panel.</p>
                  <p>Claude Max users see estimated savings instead of API costs.</p>
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
          >
            Reset to Defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={closeSettings}
              className="px-4 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/15 border border-white/15 rounded-md text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-sm font-medium bg-green-500 hover:bg-green-400 rounded-md text-black transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
