import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

/**
 * Simple / Advanced — one per-browser preference shared by Generate Image,
 * Generate Video, Models (spec 2026-10-11-simple-advanced-mode-design §1) and
 * Photo Editing.
 */
export type UiMode = 'simple' | 'advanced'
export const UI_MODE_KEY = 'raccoon-studio:ui-mode'
/** A returning user has one of these; a new install has neither. */
const SAVED_FORM_KEYS = ['raccoon-studio:generate-form', 'raccoon-studio:generate-videos-form:v2']

const valid = (v: unknown): v is UiMode => v === 'simple' || v === 'advanced'

/** The mode a browser starts in: its stored choice, else Advanced for a returning user, else Simple. */
export function firstUiMode(storage: Pick<Storage, 'getItem'>): UiMode {
  const stored = storage.getItem(UI_MODE_KEY)
  if (valid(stored)) return stored
  return SAVED_FORM_KEYS.some((k) => storage.getItem(k) !== null) ? 'advanced' : 'simple'
}

// Decided on the FIRST read — during the first render, before GenerationForm's
// persist effect writes the saved form that would otherwise make every new
// install look like a returning one — and written straight back.
let current: UiMode | null = null
const listeners = new Set<() => void>()

export function readUiMode(): UiMode {
  if (current) return current
  try {
    current = firstUiMode(localStorage)
    localStorage.setItem(UI_MODE_KEY, current)
  } catch {
    current = 'advanced' // no storage: today's page
  }
  return current
}

export function setUiMode(mode: UiMode): void {
  current = mode
  try { localStorage.setItem(UI_MODE_KEY, mode) } catch { /* unavailable */ }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  // Another tab switched: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === UI_MODE_KEY && valid(e.newValue)) {
      current = e.newValue
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

// ponytail: the server renders Advanced, so a new install sees one frame of it
// before hydration switches to Simple; a cookie would fix it if anyone notices.
export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribe, readUiMode, () => 'advanced')
}

/**
 * Params arriving from outside the form (gallery Reuse / Send to, Edit video,
 * Continue, a link) that need Advanced: switch to it and say why. A plain
 * function, not a hook, so the arrival effects need no extra dependency.
 */
export function arriveAdvanced(reasons: string[]): boolean {
  if (reasons.length === 0 || readUiMode() !== 'simple') return false
  setUiMode('advanced')
  toast(`Switched to Advanced — this uses ${reasons.join(', ')}`)
  return true
}
