import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAddonStore } from './store'

beforeEach(() => {
  useAddonStore.setState({ unlocked: [], loaded: false })
  vi.restoreAllMocks()
})

describe('useAddonStore', () => {
  it('setUnlocked replaces the unlocked list', () => {
    useAddonStore.getState().setUnlocked(['photo-editor'])
    expect(useAddonStore.getState().unlocked).toEqual(['photo-editor'])
  })

  it('load() fetches /api/addons and stores unlocked ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ unlocked: ['movie-maker'], addons: [] }),
    })) as unknown as typeof fetch)
    await useAddonStore.getState().load()
    expect(useAddonStore.getState().unlocked).toEqual(['movie-maker'])
    expect(useAddonStore.getState().loaded).toBe(true)
  })
})
