import { useCallback, useEffect, useRef, useState } from 'react'
import { type PanelId, ALL_PANELS, PANEL_LABELS } from './layout-engine'
import { useAgentStore } from '../../store/agents'
import { useSettingsStore } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'
import {
  SHORTCUTS,
  PANEL_SHORTCUT_ORDER,
  formatShortcut,
} from '../../hooks/useHotkeys'

const PANEL_SHORTCUT_LABELS: Partial<Record<PanelId, string>> = {
  ...Object.fromEntries(
    PANEL_SHORTCUT_ORDER.map((id, idx) => [id, formatShortcut({ key: String(idx + 1), metaOrCtrl: true })])
  ),
  fileSearch: SHORTCUTS.fileSearch.label,
  fileExplorer: SHORTCUTS.fileExplorer.label,
}

export function WorkspaceMenuBar({
  visiblePanels,
  onTogglePanel,
  onOpenFolder,
  onFocusFileSearch,
  onFocusFileExplorer,
  onNewTerminal,
  onCloseActivePanel,
  onFocusChatInput,
  onResetLayout,
}: {
  visiblePanels: Set<PanelId>
  onTogglePanel: (id: PanelId) => void
  onOpenFolder: () => void
  onFocusFileSearch: () => void
  onFocusFileExplorer: () => void
  onNewTerminal: () => void
  onCloseActivePanel: () => void
  onFocusChatInput: () => void
  onResetLayout: () => void
}) {
  const agentCount = useAgentStore((s) => s.agents.length)
  const eventCount = useAgentStore((s) => s.events.length)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const openHelp = useSettingsStore((s) => s.openHelp)
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const recentFolders = useWorkspaceStore((s) => s.recentFolders)
  const openWorkspaceFolder = useWorkspaceStore((s) => s.openFolder)
  const closeWorkspaceFolder = useWorkspaceStore((s) => s.closeFolder)
  const workspaceName = workspaceRoot?.split('/').pop() ?? null
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const modLabel = isMac ? 'Cmd' : 'Ctrl'
  const [timeStr, setTimeStr] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'view' | null>(null)
  const menuRootRef = useRef<HTMLDivElement>(null)
  const recentMenuItems = recentFolders.slice(0, 6)

  const closeMenus = useCallback(() => {
    setOpenMenu(null)
  }, [])

  const toggleMenu = useCallback((menu: 'file' | 'edit' | 'view') => {
    setOpenMenu((current) => (current === menu ? null : menu))
  }, [])

  const runMenuAction = useCallback((action: () => void | Promise<void>) => {
    closeMenus()
    try {
      const result = action()
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).catch((err) => {
          console.error('[TopNav] Menu action failed:', err)
        })
      }
    } catch (err) {
      console.error('[TopNav] Menu action failed:', err)
    }
  }, [closeMenus])

  const runEditCommand = useCallback((command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => {
    const active = document.activeElement

    if (command === 'selectAll') {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        active.focus()
        active.select()
        closeMenus()
        return
      }
      if (active instanceof HTMLElement && active.isContentEditable) {
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(active)
          selection.removeAllRanges()
          selection.addRange(range)
          closeMenus()
          return
        }
      }
    }

    try {
      document.execCommand(command)
    } catch (err) {
      console.error(`[TopNav] Edit command "${command}" failed:`, err)
    }

    closeMenus()
  }, [closeMenus])

  useEffect(() => {
    const tick = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }))
    }, 60_000)
    return () => clearInterval(tick)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target as Node)) {
        closeMenus()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu, closeMenus])

  useEffect(() => {
    if (!openMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenus()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [openMenu, closeMenus])

  return (
    <header
      className="glass-panel"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 36, padding: '0 16px',
        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
        borderBottom: '1px solid rgba(89, 86, 83, 0.2)', flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 16, letterSpacing: 1 }}>&#x2B22;</span>
        {workspaceName && (
          <span style={{ color: '#9A9692', fontSize: 12, fontWeight: 500 }}>{workspaceName}</span>
        )}
        <span style={{ color: '#595653', fontSize: 'inherit' }}>|</span>
        <nav ref={menuRootRef} style={{ display: 'flex', gap: 14, position: 'relative' }}>
          {openMenu && (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
              onClick={closeMenus}
            />
          )}

          <div style={{ position: 'relative', zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu('file')}
              style={{ color: '#74747C', fontSize: 'inherit' }}
            >
              File
            </span>
            {openMenu === 'file' && (
              <>
                <div
                  style={{
                    position: 'absolute', top: 30, left: -8, zIndex: 9999,
                    minWidth: 190, padding: '4px 0', borderRadius: 6,
                    background: '#1A1A19', border: '1px solid rgba(89,86,83,0.3)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    onClick={() => runMenuAction(onOpenFolder)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Open Folder...</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.openFolder.label}
                    </span>
                  </div>

                  {recentMenuItems.length > 0 && (
                    <>
                      <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                      <div style={{ padding: '2px 12px 4px', color: '#595653', fontSize: 10, letterSpacing: 0.6 }}>
                        RECENT
                      </div>
                    </>
                  )}
                  {recentMenuItems.map((folderPath) => (
                    <div
                      key={folderPath}
                      onClick={() => runMenuAction(() => openWorkspaceFolder(folderPath))}
                      className="hover-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                      }}
                      title={folderPath}
                    >
                      <span style={{ color: '#9A9692', flex: 1 }}>
                        {folderPath.split('/').filter(Boolean).pop() ?? folderPath}
                      </span>
                      <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                        recent
                      </span>
                    </div>
                  ))}

                  <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                  <div
                    onClick={() => runMenuAction(onFocusFileSearch)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Search Files</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.fileSearch.label}
                    </span>
                  </div>
                  <div
                    onClick={() => runMenuAction(onFocusFileExplorer)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>File Explorer</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.fileExplorer.label}
                    </span>
                  </div>
                  <div
                    onClick={() => runMenuAction(onNewTerminal)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>New Terminal</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.newTerminal.label}
                    </span>
                  </div>
                  <div
                    onClick={() => runMenuAction(onCloseActivePanel)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Close Active Panel</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.closePanel.label}
                    </span>
                  </div>
                  {workspaceRoot && (
                    <div
                      onClick={() => runMenuAction(closeWorkspaceFolder)}
                      className="hover-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      <span style={{ color: '#9A9692', flex: 1 }}>Close Folder</span>
                    </div>
                  )}
                  <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                  <div
                    onClick={() => runMenuAction(openSettings)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Settings...</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.openSettings.label}
                    </span>
                  </div>
                  <div
                    onClick={() => runMenuAction(openHelp)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Help</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.openHelp.label}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ position: 'relative', zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu('edit')}
              style={{ color: '#74747C', fontSize: 'inherit' }}
            >
              Edit
            </span>
            {openMenu === 'edit' && (
              <>
                <div
                  style={{
                    position: 'absolute', top: 30, left: -8, zIndex: 9999,
                    minWidth: 190, padding: '4px 0', borderRadius: 6,
                    background: '#1A1A19', border: '1px solid rgba(89,86,83,0.3)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    overflow: 'hidden',
                  }}
                >
                  {[
                    { label: 'Undo', shortcut: `${modLabel}+Z`, cmd: 'undo' as const },
                    { label: 'Redo', shortcut: `${modLabel}+Shift+Z`, cmd: 'redo' as const },
                  ].map((item) => (
                    <div
                      key={item.label}
                      onClick={() => runEditCommand(item.cmd)}
                      className="hover-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      <span style={{ color: '#9A9692', flex: 1 }}>{item.label}</span>
                      <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>{item.shortcut}</span>
                    </div>
                  ))}
                  <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                  {[
                    { label: 'Cut', shortcut: `${modLabel}+X`, cmd: 'cut' as const },
                    { label: 'Copy', shortcut: `${modLabel}+C`, cmd: 'copy' as const },
                    { label: 'Paste', shortcut: `${modLabel}+V`, cmd: 'paste' as const },
                    { label: 'Select All', shortcut: `${modLabel}+A`, cmd: 'selectAll' as const },
                  ].map((item) => (
                    <div
                      key={item.label}
                      onClick={() => runEditCommand(item.cmd)}
                      className="hover-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      <span style={{ color: '#9A9692', flex: 1 }}>{item.label}</span>
                      <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>{item.shortcut}</span>
                    </div>
                  ))}
                  <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                  <div
                    onClick={() => runMenuAction(onFocusChatInput)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Focus Chat Input</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.focusChatInput.label}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* View dropdown */}
          <div style={{ position: 'relative', zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu('view')}
              style={{ color: '#74747C', fontSize: 'inherit' }}
            >
              View
            </span>
            {openMenu === 'view' && (
              <>
                <div
                  style={{
                    position: 'absolute', top: 30, left: -8, zIndex: 9999,
                    minWidth: 190, padding: '4px 0', borderRadius: 6,
                    background: '#1A1A19', border: '1px solid rgba(89,86,83,0.3)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    overflow: 'hidden',
                  }}
                >
                  {ALL_PANELS.map((id) => (
                    <div
                      key={id}
                      onClick={() => runMenuAction(() => onTogglePanel(id))}
                      className="hover-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      <span style={{ color: visiblePanels.has(id) ? '#548C5A' : '#595653', fontWeight: 600, width: 14 }}>
                        {visiblePanels.has(id) ? '✓' : ''}
                      </span>
                      <span style={{ color: '#9A9692', flex: 1 }}>{PANEL_LABELS[id]}</span>
                      <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                        {PANEL_SHORTCUT_LABELS[id]}
                      </span>
                    </div>
                  ))}
                  <div style={{ height: 1, margin: '4px 6px', background: 'rgba(89,86,83,0.25)' }} />
                  <div
                    onClick={() => runMenuAction(onResetLayout)}
                    className="hover-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#9A9692', flex: 1 }}>Reset Layout</span>
                    <span style={{ color: '#595653', fontSize: 10, fontWeight: 500 }}>
                      {SHORTCUTS.resetLayout.label}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="nav-item" onClick={openSettings} style={{ color: '#74747C', fontSize: 'inherit' }} title={`Settings (${SHORTCUTS.openSettings.label})`}>
            Settings
          </span>
          <span className="nav-item" onClick={openHelp} style={{ color: '#74747C', fontSize: 'inherit' }} title={`Help (${SHORTCUTS.openHelp.label})`}>
            Help
          </span>
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#74747C', fontSize: 'inherit' }}>
        <span className="glow-amber" style={{ color: '#9A9692' }}>agent-observer</span>
        <span style={{ color: '#595653' }}>|</span>
        <span><strong style={{ color: '#9A9692' }}>{agentCount}</strong> agents</span>
        <span style={{ color: '#595653' }}>|</span>
        <span><strong style={{ color: '#9A9692' }}>{eventCount}</strong> events</span>
        <span style={{ color: '#595653' }}>|</span>
        <span style={{ color: '#9A9692' }}>{timeStr}</span>
      </div>
    </header>
  )
}
