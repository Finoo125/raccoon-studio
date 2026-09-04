import { describe, it, expect } from 'vitest'
import {
  coreFeatures, addonIds, sellableAddonIds, listedAddons,
  visibleNav, isAddonRoute, featureForApiPath, navGroups,
} from './registry'

describe('feature registry', () => {
  it('marks exactly the five paid features as add-ons', () => {
    expect(addonIds().sort()).toEqual([
      'civitai-browser', 'ltx-director', 'movie-maker', 'photo-editor', 'prompt-builder',
    ])
  })

  it('ltx-director is entitlement-only — never a nav tab, even unlocked', () => {
    // It is a mode inside Generate Video, so a tab for it would lead nowhere.
    expect(visibleNav([]).map((f) => f.id)).not.toContain('ltx-director')
    expect(visibleNav(['ltx-director']).map((f) => f.id)).not.toContain('ltx-director')
    // ...but it must still be sold on the Add-ons page.
    expect(addonIds()).toContain('ltx-director')
  })

  it('ltx-director does not gate the whole Generate Video page', () => {
    // Its href points at the page it lives inside. Matching that in
    // isAddonRoute would lock a core page behind an add-on entitlement.
    expect(isAddonRoute('/generate-videos')).toBeNull()
    expect(isAddonRoute('/generate-videos/anything')).toBeNull()
    // Real add-on routes still resolve.
    expect(isAddonRoute('/movie')).toBe('movie-maker')
  })

  it('prompt-builder is an add-on: hidden when locked, visible when unlocked', () => {
    expect(visibleNav([]).map((f) => f.id)).not.toContain('prompt-builder')
    expect(visibleNav(['prompt-builder']).map((f) => f.id)).toContain('prompt-builder')
  })

  it('featureForApiPath maps the prompt-builder API prefix', () => {
    expect(featureForApiPath('/api/prompt-builder/generate')).toBe('prompt-builder')
  })

  it('core features are everything else', () => {
    expect(coreFeatures().map((f) => f.id)).toEqual([
      'generate', 'generate-videos', 'gallery', 'models', 'tools', 'backup', 'logs', 'settings',
    ])
  })

  it('visibleNav with nothing unlocked = core only, original order', () => {
    expect(visibleNav([]).map((f) => f.id)).toEqual([
      'generate', 'generate-videos', 'gallery', 'models', 'tools', 'backup', 'logs', 'settings',
    ])
  })

  it('visibleNav includes an unlocked add-on in registry order', () => {
    expect(visibleNav(['photo-editor']).map((f) => f.id)).toEqual([
      'generate', 'generate-videos', 'gallery', 'models', 'photo-editor', 'tools', 'backup', 'logs', 'settings',
    ])
  })

  it('isAddonRoute maps add-on paths (incl. nested) to feature ids', () => {
    expect(isAddonRoute('/photo-editing')).toBe('photo-editor')
    expect(isAddonRoute('/movie')).toBe('movie-maker')
    expect(isAddonRoute('/movie/123')).toBe('movie-maker')
    expect(isAddonRoute('/gallery')).toBeNull()
  })

  it('navGroups clusters the nav into create · studio · manage in order', () => {
    const groups = navGroups([])
    expect(groups.map((g) => g.group)).toEqual(['create', 'studio', 'manage'])
    expect(groups.find((g) => g.group === 'create')!.items.map((f) => f.id))
      .toEqual(['generate', 'generate-videos', 'gallery', 'models'])
    expect(groups.find((g) => g.group === 'manage')!.items.map((f) => f.id))
      .toEqual(['tools', 'backup', 'logs', 'settings'])
  })

  it('navGroups always emits the studio group (Add-ons link lives there), even with no add-on unlocked', () => {
    const studio = navGroups([]).find((g) => g.group === 'studio')!
    expect(studio).toBeDefined()
    expect(studio.items).toEqual([]) // no unlocked add-ons → empty, but group present
  })

  it('navGroups places an unlocked add-on in the studio group', () => {
    const studio = navGroups(['photo-editor']).find((g) => g.group === 'studio')!
    expect(studio.items.map((f) => f.id)).toEqual(['photo-editor'])
  })

  it('featureForApiPath maps add-on API prefixes to feature ids', () => {
    expect(featureForApiPath('/api/photo-edit/save')).toBe('photo-editor')
    expect(featureForApiPath('/api/movies/123/export')).toBe('movie-maker')
    expect(featureForApiPath('/api/director/abc/beat')).toBe('movie-maker')
    expect(featureForApiPath('/api/gallery')).toBeNull()
  })
})

describe('release gating', () => {
  it('Photo Editing, LTX 2.3 Director and Civitai Browser are on sale', () => {
    expect(sellableAddonIds()).toEqual(['photo-editor', 'ltx-director', 'civitai-browser'])
  })

  it('the Add-ons page lists exactly the three released add-ons, in registry order', () => {
    expect(listedAddons().map((f) => f.id))
      .toEqual(['photo-editor', 'ltx-director', 'civitai-browser'])
  })

  // navHidden keeps it out of the top bar — it is a tab inside the Models page,
  // so a nav entry would lead somewhere that looks identical. It must still be
  // sold, which is the same pairing ltx-director has.
  it('Civitai Browser is sold but never a nav tab', () => {
    expect(sellableAddonIds()).toContain('civitai-browser')
    expect(visibleNav(['civitai-browser']).map((f) => f.id)).not.toContain('civitai-browser')
  })

  // Released 2026-08-22. Keys minted while it was held back listed photo-editor
  // all along and were filtered down to nothing; removing the marker is what
  // makes them grant it, with no re-mint. That is the property worth pinning:
  // a regression here silently un-sells an add-on people have already paid for.
  it('Photo Editing carries no release marker, so a key unlocks it', () => {
    expect(listedAddons().find((f) => f.id === 'photo-editor')!.release).toBeUndefined()
    expect(sellableAddonIds()).toContain('photo-editor')
  })

  it('held-back add-ons keep gating their own routes and APIs', () => {
    // Held back, not deleted: dropping off the store page must not make
    // /movie or /prompt-builder free to anyone who types the URL.
    for (const id of ['movie-maker', 'prompt-builder']) {
      expect(sellableAddonIds()).not.toContain(id)
    }
    expect(isAddonRoute('/movie')).toBe('movie-maker')
    expect(isAddonRoute('/prompt-builder')).toBe('prompt-builder')
    expect(featureForApiPath('/api/movies/1')).toBe('movie-maker')
    expect(featureForApiPath('/api/photo-edit/save')).toBe('photo-editor')
  })
})
