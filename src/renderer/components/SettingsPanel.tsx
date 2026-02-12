import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore, saveSettings } from '../store/settings'
import type { AppSettings, CursorStyle } from '../types'
import { DEFAULT_SETTINGS } from '../types'

type Tab = 'general' | 'appearance' | 'terminal'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' }
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
