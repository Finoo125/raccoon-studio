import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import presets from './video-presets.json'
import {
  cameraAnim,
  isAdultScenario,
  musicEmoji,
  presetLabel,
  presetSlug,
  presetThumb,
  isSentinel,
  visibleVideoRows,
  cardsFor,
  pickPreset,
  rerollPreset,
  surpriseVideo,
  summaryLine,
  migrateWriterId,
  simpleLtxSettings,
  surpriseIdea,
  VIDEO_SCENE_ROWS,
  ADULT_PLACES,
  fitWho,
} from './video-picks'
import { PICK_ROWS, litPick, togglePick, whoOf } from './picks'
import type { EnhanceSettingsValues } from '@/lib/comfyui/enhance-settings'

describe('video presets', () => {
  it('carries every preset family', () => {
    expect(presets.environments.length).toBeGreaterThanOrEqual(80)
    expect(presets.scenarios.every((s) => s.tag === 'SFW' || s.tag === 'NSFW')).toBe(true)
    expect(presets.cameras).toHaveLength(11)
    expect(presets.music).toHaveLength(11)
  })
  it('splits a key into emoji and label', () => {
    expect(presetLabel('🏖 Beach — golden hour')).toEqual({ emoji: '🏖', label: 'Beach — golden hour' })
    expect(presetLabel('None — LLM decides')).toEqual({ emoji: '', label: 'None — LLM decides' })
  })
  it('slugs and finds thumbnails', () => {
    expect(presetSlug('🏖 Beach — golden hour')).toBe('beach-golden-hour')
    expect(presetThumb('where', '🏖 Beach — golden hour')).toBe('/prompt-helper/video/where/beach-golden-hour.webp')
    expect(presetThumb('where', 'None — LLM decides')).toBeUndefined()
    expect(presetThumb('happens', '🎲 Random — seed picks')).toBeUndefined()
  })
  it('treats NSFW and unknown scenarios as 18+, sentinels never', () => {
    const nsfw = presets.scenarios.find((s) => s.tag === 'NSFW')!.key
    const sfw = presets.scenarios.find((s) => s.tag === 'SFW')!.key
    expect(isAdultScenario(nsfw)).toBe(true)
    expect(isAdultScenario(sfw)).toBe(false)
    expect(isAdultScenario('🆕 Something the node added later')).toBe(true)
    expect(isAdultScenario("None — user's prompt decides")).toBe(false)
    expect(isAdultScenario('🎲 Random — seed picks')).toBe(false)
  })
  it('gives every music style its own emoji and every moving camera an animation', () => {
    for (const m of presets.music.slice(1)) expect(musicEmoji(m)).not.toBe('🎵')
    const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8')
    for (const c of presets.cameras) {
      if (c === 'None' || c === 'Static hold') expect(cameraAnim(c)).toBeNull()
      else {
        expect(cameraAnim(c)).toMatch(/^cam-/)
        expect(css, `@keyframes ${cameraAnim(c)}`).toContain(`@keyframes ${cameraAnim(c)} {`)
      }
    }
  })
})

const NSFW_KEY = presets.scenarios.find((s) => s.tag === 'NSFW')!.key
const opts = {
  environments: ['None — LLM decides', '🎲 Random — seed picks', '🏖 Beach — golden hour'],
  scenarios: ["None — user's prompt decides", '🚶 Walk in and stop', NSFW_KEY],
  cameras: ['None', 'Push in'],
  music: ['None — LLM decides', 'Classic Rock — driving guitars & pounding drums'],
}
const DEFAULTS: EnhanceSettingsValues = {
  userIntent: 'x', model: 'ollama:m', environment: opts.environments[0], scenario: opts.scenarios[0],
  camera: 'None', music: opts.music[0], dialogueTier: 'standard', energy: 5, pov: false, povGender: 'female',
}

describe('prefixed keys and slugs (R5)', () => {
  it('drops the emoji after a WORD prefix and keeps the prefix', () => {
    expect(presetLabel('POV — 💃 Strip club — main floor')).toEqual({ emoji: '💃', label: 'POV — Strip club — main floor' })
    expect(presetLabel('WTF — ✈️ Plane')).toMatchObject({ emoji: '✈️', label: 'WTF — Plane' })
  })
  it('has a picture for every place and every action (video-helper-thumbs.live.test.ts)', () => {
    const pub = path.resolve(__dirname, '../../../public')
    const rows = [['where', presets.environments], ['happens', presets.scenarios]] as const
    const missing = rows.flatMap(([row, list]) =>
      list.map((e) => presetThumb(row, e.key)!).filter((p) => !fs.existsSync(path.join(pub, p))))
    expect(missing).toEqual([])
  })
  it('has unique non-empty slugs per row', () => {
    for (const list of [presets.environments, presets.scenarios]) {
      const slugs = list.filter((e) => !isSentinel(e.key)).map((e) => presetSlug(e.key))
      expect(slugs.every(Boolean)).toBe(true)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })
})

describe('video helper rows', () => {
  it('shows scene rows only for text to video and hides LTX sound rows in Simple', () => {
    expect(visibleVideoRows({ scene: true, ltx: false, simple: false })).toEqual({ scene: ['who', 'hair', 'haircolor', 'wear'], presets: ['where', 'happens', 'camera', 'music', 'talking', 'pov'] })
    expect(visibleVideoRows({ scene: false, ltx: false, simple: true }).presets).toEqual(['happens', 'camera', 'music', 'talking', 'pov'])
    expect(visibleVideoRows({ scene: false, ltx: true, simple: true }).presets).toEqual(['happens', 'camera'])
  })
  it('hides 18+ scenarios until the switch is on', () => {
    expect(cardsFor('happens', opts, false).map((c) => c.value)).not.toContain(NSFW_KEY)
    expect(cardsFor('happens', opts, true).map((c) => c.value)).toContain(NSFW_KEY)
  })
  it('gives talking and pov fixed cards', () => {
    expect(cardsFor('talking', opts, false).map((c) => [c.value, c.label])).toEqual([['none', 'Silent'], ['standard', 'Standard'], ['talkative', 'Talkative']])
    expect(cardsFor('pov', opts, false).map((c) => c.value)).toEqual(['off', 'female', 'male'])
  })
  it('picks, un-picks and maps POV', () => {
    const s0 = { ...DEFAULTS, environment: opts.environments[0] }
    const s1 = pickPreset(s0, 'where', '🏖 Beach — golden hour', opts)
    expect(s1.environment).toBe('🏖 Beach — golden hour')
    expect(pickPreset(s1, 'where', '🏖 Beach — golden hour', opts).environment).toBe('None — LLM decides')
    expect(pickPreset(s0, 'pov', 'male', opts)).toMatchObject({ pov: true, povGender: 'male' })
    expect(pickPreset({ ...s0, pov: true, povGender: 'male' }, 'pov', 'male', opts).pov).toBe(false)
    expect(pickPreset(s0, 'talking', 'none', opts).dialogueTier).toBe('none')
  })
  it('leaves kept rows alone on Surprise me', () => {
    const s = surpriseVideo({ ...DEFAULTS, camera: 'Push in' }, { rows: ['camera', 'music'], keep: new Set(['camera']), nsfw: false, options: opts }, () => 0.99)
    expect(s.camera).toBe('Push in')
    expect(s.music).toBe('Classic Rock — driving guitars & pounding drums')
  })
  it('never rolls a sentinel and rerolls to a different value', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const s = surpriseVideo(DEFAULTS, { rows: ['where', 'happens', 'camera'], keep: new Set(), nsfw: false, options: opts }, () => r)
      expect(s.environment).toBe('🏖 Beach — golden hour')
      expect(s.scenario).toBe('🚶 Walk in and stop')
      const again = rerollPreset({ ...DEFAULTS, camera: 'Push in' }, 'camera', { ...opts, cameras: [...opts.cameras, 'Pull back'] }, false, () => r)
      expect(again.camera).not.toBe('Push in')
    }
  })
  it('reads like the old collapsed bar', () => {
    expect(summaryLine({ ...DEFAULTS, model: 'ollama:qwen3.5:9b', dialogueTier: 'standard', pov: true, energy: 5 })).toBe('qwen3.5:9b · standard · POV · energy 5')
    expect(summaryLine({ ...DEFAULTS, model: '' })).toMatch(/^No writer · /)
  })
  it('Surprise me changes only the scene words in the idea', () => {
    const row = (id: string) => PICK_ROWS.find((r) => r.id === id)!
    const add = (idea: string, id: string) => togglePick(idea, row(id), row(id).picks[0], 'sentences')
    const idea = ['who', 'body', 'where', 'time', 'light'].reduce(add, '')
    const lit = (text: string, id: string) => litPick(text, row(id), 'sentences')?.id
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const out = surpriseIdea(idea, new Set(), false, () => r)
      for (const { id } of PICK_ROWS) if (!VIDEO_SCENE_ROWS.includes(id)) expect(lit(out, id), id).toBe(lit(idea, id))
      expect(VIDEO_SCENE_ROWS.some((id) => lit(out, id) !== lit(idea, id))).toBe(true)
    }
  })
  it('migrates saved Ollama names to writer ids', () => {
    expect(migrateWriterId('None')).toBe('')
    expect(migrateWriterId('')).toBe('')
    expect(migrateWriterId('qwen3.8-heretic:latest')).toBe('ollama:qwen3.8-heretic:latest')
    expect(migrateWriterId('ollama:qwen3.5:9b')).toBe('ollama:qwen3.5:9b')
    expect(migrateWriterId('lmstudio:C:/m/x.gguf')).toBe('lmstudio:C:/m/x.gguf')
  })
  // Final review: "a friendly dog" + "🔥 Missionary" came out of Surprise me on ~15% of clicks.
  it('never pairs an animal or robot Who with an 18+ scenario', () => {
    const who = PICK_ROWS[0]
    const dog = togglePick('', who, who.picks.find((p) => p.id === 'dog')!, 'sentences')
    const woman = togglePick('', who, who.picks.find((p) => p.id === 'woman')!, 'sentences')
    const values = (idea: string) => cardsFor('happens', opts, true, idea).map((c) => c.value)
    expect(values(dog)).not.toContain(NSFW_KEY)
    expect(values(woman)).toContain(NSFW_KEY)
    expect(values('my neighbour, dancing')).toContain(NSFW_KEY) // the user's own words block nothing
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const s = { ...DEFAULTS, userIntent: dog }
      expect(rerollPreset(s, 'happens', opts, true, () => r).scenario).not.toBe(NSFW_KEY)
      expect(surpriseVideo(s, { rows: ['happens'], keep: new Set(), nsfw: true, options: opts }, () => r).scenario).not.toBe(NSFW_KEY)
    }
    // A Who click (or a typed card phrase) that lands on an animal clears one already picked; a person keeps it.
    expect(fitWho({ ...DEFAULTS, userIntent: dog, scenario: NSFW_KEY }, opts).scenario).toBe(opts.scenarios[0])
    expect(fitWho({ ...DEFAULTS, userIntent: woman, scenario: NSFW_KEY }, opts).scenario).toBe(NSFW_KEY)
    // ...also when the row is kept: Surprise me never leaves the pair behind.
    expect(surpriseVideo({ ...DEFAULTS, userIntent: dog, scenario: NSFW_KEY },
      { rows: ['happens'], keep: new Set(['happens']), nsfw: true, options: opts }).scenario).toBe(opts.scenarios[0])
  })
  // Re-review: the node draws 🎲 Random from a pool that holds the 18+ scenarios (and the two explicit places).
  it('shows the 🎲 Random card only with 18+ on and a person Who, and drops it under an animal', () => {
    const RANDOM = '🎲 Random — seed picks'
    const withRandom = { ...opts, scenarios: [opts.scenarios[0], RANDOM, ...opts.scenarios.slice(1)] }
    const who = PICK_ROWS[0]
    const dog = togglePick('', who, who.picks.find((p) => p.id === 'dog')!, 'sentences')
    const woman = togglePick('', who, who.picks.find((p) => p.id === 'woman')!, 'sentences')
    for (const row of ['where', 'happens'] as const) {
      const shown = (nsfw: boolean, idea = '') => cardsFor(row, withRandom, nsfw, idea).map((c) => c.value)
      expect(shown(false), row).not.toContain(RANDOM)
      expect(shown(true, dog), row).not.toContain(RANDOM)
      expect(shown(true, woman), row).toContain(RANDOM)
      expect(shown(true), row).toContain(RANDOM)
    }
    expect(fitWho({ ...DEFAULTS, userIntent: dog, scenario: RANDOM, environment: RANDOM }, withRandom))
      .toMatchObject({ scenario: withRandom.scenarios[0], environment: withRandom.environments[0] })
    expect(fitWho({ ...DEFAULTS, userIntent: woman, scenario: RANDOM, environment: RANDOM }, withRandom))
      .toMatchObject({ scenario: RANDOM, environment: RANDOM })
    // A form saved before this fix (dog + an 18+ scenario + an explicit place) opens cleaned: the dialog starts from fitWho.
    const saved = { ...DEFAULTS, userIntent: dog, scenario: NSFW_KEY, environment: [...ADULT_PLACES][0] }
    expect(fitWho(saved, withRandom)).toEqual({ ...saved, scenario: withRandom.scenarios[0], environment: withRandom.environments[0] })
  })
  it('rolls the presets against the NEW idea\'s Who on Surprise me', () => {
    let seed = 1
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    let animals = 0
    for (let i = 0; i < 400; i++) {
      const s = surpriseVideo({ ...DEFAULTS, userIntent: '' },
        { rows: ['happens'], keep: new Set(), nsfw: true, options: opts, scene: true }, rng)
      const who = whoOf(s.userIntent, 'sentences')
      if (who && !who.human) { animals++; expect(s.scenario, s.userIntent).not.toBe(NSFW_KEY) }
    }
    expect(animals).toBeGreaterThan(0)
  })
  it('hides the two explicit places until 18+ is on, and keeps a saved one', () => {
    const where = presets.environments.map((e) => e.key)
    for (const k of ADULT_PLACES) expect(where).toContain(k)
    const withPlaces = { ...opts, environments: where }
    const shown = (nsfw: boolean) => cardsFor('where', withPlaces, nsfw).map((c) => c.value)
    for (const k of ADULT_PLACES) {
      expect(shown(false)).not.toContain(k)
      expect(shown(true)).toContain(k)
    }
    expect(shown(false)).toContain('POV — 💃 Strip club — main floor')
    const saved = { ...DEFAULTS, environment: [...ADULT_PLACES][0] }
    expect(rerollPreset(saved, 'camera', opts, false).environment).toBe(saved.environment)
  })
  it('tells a Simple LTX write what the render uses, not the hidden Advanced values (R8)', () => {
    const saved = { ...DEFAULTS, music: opts.music[1], dialogueTier: 'none' as const, pov: true, povGender: 'male' as const }
    const s = simpleLtxSettings(saved, opts)
    // negatives.build(): music only plays without a "None" key; speech is muted only by none/silent/off.
    expect(s.music.startsWith('None')).toBe(true)
    expect(['none', 'silent', 'off']).not.toContain(s.dialogueTier)
    expect(s).toMatchObject({ pov: false, povGender: 'female' })
    // Everything the dialog still shows in Simple is the user's.
    expect({ ...s, music: saved.music, dialogueTier: saved.dialogueTier, pov: saved.pov, povGender: saved.povGender }).toEqual(saved)
  })
})
