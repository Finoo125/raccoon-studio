import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

let store: ReturnType<typeof memory>
beforeEach(() => {
  store = memory()
  vi.stubGlobal('localStorage', store)
  vi.resetModules() // the module caches the mode; every test starts fresh
})
afterEach(() => vi.unstubAllGlobals())

describe('firstUiMode', () => {
  it('a new install (no saved form) starts in Simple', async () => {
    const { firstUiMode } = await import('./ui-mode')
    expect(firstUiMode(store)).toBe('simple')
  })
  it('an existing user (a saved image or video form) starts in Advanced', async () => {
    const { firstUiMode } = await import('./ui-mode')
    store.setItem('raccoon-studio:generate-videos-form:v2', '{}')
    expect(firstUiMode(store)).toBe('advanced')
  })
  it('a stored choice wins; garbage is ignored', async () => {
    const { firstUiMode, UI_MODE_KEY } = await import('./ui-mode')
    store.setItem('raccoon-studio:generate-form', '{}')
    store.setItem(UI_MODE_KEY, 'simple')
    expect(firstUiMode(store)).toBe('simple')
    store.setItem(UI_MODE_KEY, 'expert')
    expect(firstUiMode(store)).toBe('advanced')
  })
})

describe('readUiMode / setUiMode', () => {
  it('decided once: a saved form written after the first read does not flip it', async () => {
    const { readUiMode, UI_MODE_KEY } = await import('./ui-mode')
    expect(readUiMode()).toBe('simple')
    // GenerationForm's persist effect runs right after the first render
    store.setItem('raccoon-studio:generate-form', '{}')
    expect(readUiMode()).toBe('simple')
    expect(store.getItem(UI_MODE_KEY)).toBe('simple')
  })
  it('setUiMode persists and is read back', async () => {
    const { readUiMode, setUiMode, UI_MODE_KEY } = await import('./ui-mode')
    setUiMode('advanced')
    expect(readUiMode()).toBe('advanced')
    expect(store.getItem(UI_MODE_KEY)).toBe('advanced')
  })
  it('no localStorage at all reads as Advanced and does not throw', async () => {
    vi.stubGlobal('localStorage', undefined)
    const { readUiMode, setUiMode } = await import('./ui-mode')
    expect(readUiMode()).toBe('advanced')
    expect(() => setUiMode('simple')).not.toThrow()
  })
})

describe('arriveAdvanced', () => {
  it('switches a Simple page to Advanced when something needs it', async () => {
    vi.doMock('sonner', () => ({ toast: vi.fn() }))
    const { arriveAdvanced, readUiMode } = await import('./ui-mode')
    expect(readUiMode()).toBe('simple')
    expect(arriveAdvanced(['LoRAs'])).toBe(true)
    expect(readUiMode()).toBe('advanced')
  })
  it('does nothing with no reasons, or when already Advanced', async () => {
    vi.doMock('sonner', () => ({ toast: vi.fn() }))
    const { arriveAdvanced, readUiMode, setUiMode } = await import('./ui-mode')
    expect(arriveAdvanced([])).toBe(false)
    expect(readUiMode()).toBe('simple')
    setUiMode('advanced')
    expect(arriveAdvanced(['LoRAs'])).toBe(false)
  })
})
