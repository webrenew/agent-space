import { useEffect, lazy, Suspense } from 'react'
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FirstRunOnboarding } from './components/FirstRunOnboarding'
import { useSettingsStore, loadSettings } from './store/settings'
import { useWorkspaceStore } from './store/workspace'
import { syncPluginCatalogFromProfiles } from './plugins/runtime'

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

  return (
    <div className="w-full h-full">
      <ErrorBoundary fallbackLabel="WorkspaceLayout">
        <WorkspaceLayout />
      </ErrorBoundary>
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
