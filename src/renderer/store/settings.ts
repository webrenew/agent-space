import { create } from 'zustand'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'

interface SettingsStore {
  settings: AppSettings
  isOpen: boolean
  setSettings: (settings: AppSettings) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  isOpen: false,
  setSettings: (settings) => set({ settings }),
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false })
}))

export async function loadSettings(): Promise<void> {
  const settings = await window.electronAPI.settings.get()
  useSettingsStore.getState().setSettings(settings)
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await window.electronAPI.settings.set(settings)
  useSettingsStore.getState().setSettings(settings)
  useSettingsStore.getState().closeSettings()
}
