import type { Scope, SoundEventType, SystemSound } from '../types'
import { DEFAULT_SOUND_EVENTS } from '../types'

const SYSTEM_SOUNDS_PATH = '/System/Library/Sounds'

const audioCache = new Map<string, HTMLAudioElement>()

export const SYSTEM_SOUND_NAMES: SystemSound[] = [
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk',
  'Glass', 'Hero', 'Morse', 'Ping', 'Pop',
  'Purr', 'Sosumi', 'Submarine', 'Tink',
]

function getAudio(sound: SystemSound): HTMLAudioElement {
  let audio = audioCache.get(sound)
  if (!audio) {
    audio = new Audio(`file://${SYSTEM_SOUNDS_PATH}/${sound}.aiff`)
    audioCache.set(sound, audio)
  }
  return audio
}

export function playSystemSound(sound: SystemSound): void {
  try {
    const original = getAudio(sound)
    const clone = original.cloneNode(true) as HTMLAudioElement
    clone.volume = 0.7
    clone.play().catch(() => {
      // Audio play can fail if user hasn't interacted with page yet
    })
  } catch {
    // Ignore audio errors
  }
}

export function playSoundForEvent(
  eventType: SoundEventType,
  scope: Scope,
  globalEnabled: boolean
): void {
  if (!globalEnabled) return

  // Check scope-specific override first
  const scopeSound = scope.soundEvents[eventType]
  if (scopeSound === 'none') return
  if (scopeSound) {
    playSystemSound(scopeSound)
    return
  }

  // Fall back to default sound mapping
  const defaultSound = DEFAULT_SOUND_EVENTS[eventType]
  if (defaultSound) {
    playSystemSound(defaultSound)
  }
}

export function preloadSounds(): void {
  for (const name of SYSTEM_SOUND_NAMES) {
    getAudio(name)
  }
}
