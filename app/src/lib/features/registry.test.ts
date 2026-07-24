import { describe, it, expect } from 'vitest'
import {
  coreFeatures, addonIds,
  visibleNav, isAddonRoute, featureForApiPath, navGroups,
} from './registry'

describe('feature registry', () => {
  it('marks exactly Photo Editor, Movie Maker and Prompt Builder as add-ons', () => {
    expect(addonIds().sort()).toEqual(['movie-maker', 'photo-editor', 'prompt-builder'])
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
      'generate', 'generate-videos', 'gallery', 'tools', 'models', 'logs', 'settings',
    ])
  })

  it('visibleNav with nothing unlocked = core only, original order', () => {
    expect(visibleNav([]).map((f) => f.id)).toEqual([
      'generate', 'generate-videos', 'gallery', 'tools', 'models', 'logs', 'settings',
    ])
  })

  it('visibleNav includes an unlocked add-on in registry order', () => {
    expect(visibleNav(['photo-editor']).map((f) => f.id)).toEqual([
      'generate', 'generate-videos', 'gallery', 'photo-editor', 'tools', 'models', 'logs', 'settings',
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
      .toEqual(['generate', 'generate-videos', 'gallery'])
    expect(groups.find((g) => g.group === 'manage')!.items.map((f) => f.id))
      .toEqual(['tools', 'models', 'logs', 'settings'])
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
