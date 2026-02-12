import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Office } from './scene/Office'
import { HUD } from './hud/HUD'
import { TerminalPanel } from './components/TerminalPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useAgentStore } from './store/agents'
import { useSettingsStore, loadSettings } from './store/settings'

export function App() {
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const openSettings = useSettingsStore((s) => s.openSettings)

  useEffect(() => {
    loadSettings()
    const unsub = window.electronAPI.settings.onOpenSettings(() => {
      openSettings()
    })
    return unsub
  }, [openSettings])

  return (
    <div className="flex flex-col w-full h-full">
      {/* 3D scene fills remaining space */}
      <div className="flex-1 relative min-h-0">
        <Canvas
          shadows
          camera={{
            position: [8, 7, 8],
            fov: 45,
            near: 0.1,
            far: 100
          }}
          onPointerMissed={() => selectAgent(null)}
        >
          <Office />
        </Canvas>
        <HUD />
      </div>

      {/* Terminal panel at bottom */}
      <TerminalPanel />

      {/* Settings modal */}
      <SettingsPanel />
    </div>
  )
}
