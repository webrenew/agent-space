import { useEffect, lazy, Suspense } from 'react'
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FirstRunOnboarding } from './components/FirstRunOnboarding'
import { useSettingsStore, loadSettings } from './store/settings'
import { useWorkspaceStore } from './store/workspace'

const LazySettingsPanel = lazy(async () => {
  const mod = await import('./components/SettingsPanel')
  return { default: mod.SettingsPanel }
})

export function App() {
  const openSettings = useSettingsStore((s) => s.openSettings)
  const isSettingsOpen = useSettingsStore((s) => s.isOpen)
  const fontFamily = useSettingsStore((s) => s.settings.appearance.fontFamily)
  const fontSize = useSettingsStore((s) => s.settings.appearance.fontSize)

  useEffect(() => {
    void (async () => {
      await loadSettings()
      await useWorkspaceStore.getState().initializeStartupWorkspace()
    })()
    const unsub = window.electronAPI.settings.onOpenSettings(() => {
      openSettings()
    })
    return unsub
  }, [openSettings])

  // Sync appearance settings to CSS custom properties so all UI inherits them
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-font-family', fontFamily)
    root.style.setProperty('--app-font-size', `${fontSize}px`)
  }, [fontFamily, fontSize])

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
      <FirstRunOnboarding />
    </div>
  )
}
