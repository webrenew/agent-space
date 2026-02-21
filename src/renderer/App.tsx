import { useEffect, lazy, Suspense, useMemo, useState, useCallback } from 'react'
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FirstRunOnboarding } from './components/FirstRunOnboarding'
import { useSettingsStore, loadSettings } from './store/settings'
import { useWorkspaceStore } from './store/workspace'
import { syncPluginCatalogFromProfiles } from './plugins/runtime'
import type { AppUpdateStatusResult } from '../shared/electron-api'

const LazySettingsPanel = lazy(async () => {
  const mod = await import('./components/SettingsPanel')
  return { default: mod.SettingsPanel }
})

const LazyHelpPanel = lazy(async () => {
  const mod = await import('./components/HelpPanel')
  return { default: mod.HelpPanel }
})

export function App() {
  const openSettings = useSettingsStore((s) => s.openSettings)
  const openHelp = useSettingsStore((s) => s.openHelp)
  const isSettingsOpen = useSettingsStore((s) => s.isOpen)
  const isHelpOpen = useSettingsStore((s) => s.isHelpOpen)
  const fontFamily = useSettingsStore((s) => s.settings.appearance.fontFamily)
  const fontSize = useSettingsStore((s) => s.settings.appearance.fontSize)
  const claudeProfiles = useSettingsStore((s) => s.settings.claudeProfiles)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatusResult | null>(null)
  const [installingUpdate, setInstallingUpdate] = useState(false)

  useEffect(() => {
    void (async () => {
      await loadSettings()
      await useWorkspaceStore.getState().initializeStartupWorkspace()
    })()
    const unsubs: Array<() => void> = []
    unsubs.push(window.electronAPI.settings.onOpenSettings(() => {
      openSettings()
    }))
    unsubs.push(window.electronAPI.settings.onOpenHelp(() => {
      openHelp()
    }))
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [openHelp, openSettings])

  // Sync appearance settings to CSS custom properties so all UI inherits them
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-font-family', fontFamily)
    root.style.setProperty('--app-font-size', `${fontSize}px`)
  }, [fontFamily, fontSize])

  // Keep plugin catalog in sync with profile plugin directories.
  useEffect(() => {
    void syncPluginCatalogFromProfiles(claudeProfiles)
  }, [claudeProfiles])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.electronAPI.updates.onStatus((status) => {
      if (cancelled) return
      setUpdateStatus(status)
    })

    void (async () => {
      try {
        const status = await window.electronAPI.updates.getStatus()
        if (!cancelled) setUpdateStatus(status)
      } catch (err) {
        console.warn('[App] update status check failed:', err)
      }
    })()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const updateDownloadUrl = useMemo(() => (
    updateStatus?.releaseUrl || 'https://github.com/webrenew/agent-observer/releases/latest'
  ), [updateStatus?.releaseUrl])

  const openUpdateDownloadPage = useCallback(() => {
    window.open(updateDownloadUrl, '_blank', 'noopener,noreferrer')
  }, [updateDownloadUrl])

  const handleInstallUpdate = useCallback(() => {
    if (installingUpdate) return
    setInstallingUpdate(true)
    void (async () => {
      try {
        const accepted = await window.electronAPI.updates.installAndRestart()
        if (!accepted) {
          setInstallingUpdate(false)
          openUpdateDownloadPage()
        }
      } catch (err) {
        setInstallingUpdate(false)
        console.warn('[App] install update failed:', err)
        openUpdateDownloadPage()
      }
    })()
  }, [installingUpdate, openUpdateDownloadPage])

  const normalizedLatestVersion = updateStatus?.latestVersion
    ? updateStatus.latestVersion.replace(/^v/i, '')
    : null

  const updateBannerMessage = useMemo(() => {
    if (!updateStatus) return null
    const versionSuffix = normalizedLatestVersion ? ` (v${normalizedLatestVersion})` : ''
    if (updateStatus.canInstall) return `Update ready${versionSuffix}.`
    if (!updateStatus.updateAvailable) return null

    if (updateStatus.phase === 'downloading') {
      const progress = updateStatus.downloadPercent
      const progressText = typeof progress === 'number' && Number.isFinite(progress)
        ? ` ${Math.round(progress)}%`
        : ''
      return `Update available${versionSuffix}. Downloading…${progressText}`
    }

    return `Update available${versionSuffix}.`
  }, [normalizedLatestVersion, updateStatus])

  return (
    <div className="w-full h-full" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ErrorBoundary fallbackLabel="WorkspaceLayout">
          <WorkspaceLayout />
        </ErrorBoundary>
      </div>
      {updateBannerMessage ? (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid rgba(84, 140, 90, 0.45)',
            background: 'linear-gradient(180deg, rgba(22, 28, 23, 0.95), rgba(12, 16, 13, 0.95))',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
            color: '#d8dfd3',
            fontSize: 12,
          }}
        >
          <span>{updateBannerMessage}</span>
          {updateStatus?.canInstall ? (
            <button
              type="button"
              onClick={handleInstallUpdate}
              disabled={installingUpdate}
              style={{
                border: '1px solid rgba(84, 140, 90, 0.6)',
                background: installingUpdate ? '#2a2f2a' : '#1E2920',
                color: installingUpdate ? '#9A9692' : '#d8dfd3',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: '6px 10px',
                cursor: installingUpdate ? 'default' : 'pointer',
                opacity: installingUpdate ? 0.75 : 1,
              }}
            >
              {installingUpdate ? 'Restarting…' : 'Install update and restart'}
            </button>
          ) : (
            <button
              type="button"
              onClick={openUpdateDownloadPage}
              style={{
                border: '1px solid rgba(84, 140, 90, 0.6)',
                background: '#1E2920',
                color: '#d8dfd3',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              Open release
            </button>
          )}
        </div>
      ) : null}
      {isSettingsOpen ? (
        <Suspense fallback={null}>
          <LazySettingsPanel />
        </Suspense>
      ) : null}
      {isHelpOpen ? (
        <Suspense fallback={null}>
          <LazyHelpPanel />
        </Suspense>
      ) : null}
      <FirstRunOnboarding />
    </div>
  )
}
