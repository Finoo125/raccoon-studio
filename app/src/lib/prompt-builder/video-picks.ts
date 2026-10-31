/**
 * Pure helpers behind the video Prompt Helper's picture cards. The preset keys
 * come from the ComfyUI node pack (video-presets.json, written by
 * scripts/export-video-presets.py) and are also the values the form stores.
 * No React, no I/O.
 */
import presets from './video-presets.json'
import { PICK_ROWS, surprise, whoOf, type PickRowId } from './picks'
import { parseWriterId } from '@/lib/ai-writers/writer-id'
import type { VideoPromptOptions } from '@/lib/comfyui/video-prompt-options'
import type { EnhanceSettingsValues } from '@/lib/comfyui/enhance-settings'

/** "None — LLM decides" and "🎲 Random — seed picks": the node's own non-picks. */
export function isSentinel(key: string): boolean {
  return key.startsWith('None') || key.startsWith('🎲')
}

// An optional "POV — " / "WTF — " prefix, then the emoji: the prefix stays in the label.
const LEADING_EMOJI = /^((?:[A-Z]+ — )?)(\p{Extended_Pictographic}[\p{Extended_Pictographic}\u{FE0F}\u{200D}]*)\s+/u

export function presetLabel(key: string): { emoji: string; label: string } {
  const m = LEADING_EMOJI.exec(key)
  return m ? { emoji: m[2], label: m[1] + key.slice(m[0].length) } : { emoji: '', label: key }
}

export function presetSlug(key: string): string {
  return presetLabel(key)
    .label.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The card picture under public/, or undefined (sentinels have none; a missing file falls back to the emoji card). */
export function presetThumb(row: 'where' | 'happens', key: string): string | undefined {
  return isSentinel(key) ? undefined : `/prompt-helper/video/${row}/${presetSlug(key)}.webp`
}

const NSFW_SCENARIOS = new Set(presets.scenarios.filter((s) => s.tag === 'NSFW').map((s) => s.key))
const SFW_SCENARIOS = new Set(presets.scenarios.filter((s) => s.tag === 'SFW').map((s) => s.key))

/** NSFW, or a key this build doesn't know (the node got ahead of the export): hidden unless 18+ is on. */
export function isAdultScenario(key: string): boolean {
  if (isSentinel(key)) return false
  return NSFW_SCENARIOS.has(key) || !SFW_SCENARIOS.has(key)
}

// Two places whose label is explicit on its own: shown, like the 18+ scenarios, only with 18+ on.
export const ADULT_PLACES: ReadonlySet<string> = new Set(['POV — 🔥 Backroom — she is topless', 'POV — 💃 Lap dance — she strips as she dances'])

// 🎲 Random counts too: the node draws it from a pool that holds the 18+ scenarios and the two places.
const isAdultCard = (row: PresetRowId, key: string) =>
  row === 'happens' ? key.startsWith('🎲') || isAdultScenario(key)
    : row === 'where' && (key.startsWith('🎲') || ADULT_PLACES.has(key))

/**
 * No 18+ card for an animal or robot Who — a Who card's phrase, picked or typed;
 * the user's own words block nothing, as in the image helper (`whoOf`).
 */
const personOk = (idea: string): boolean => {
  const who = whoOf(idea, 'sentences')
  return !who || who.human
}

/** After the idea changes: an animal or robot Who drops an 18+ scenario or place ("a friendly dog" + "Missionary"). */
export function fitWho(s: EnhanceSettingsValues, options: VideoPromptOptions): EnhanceSettingsValues {
  if (personOk(s.userIntent)) return s
  return {
    ...s,
    scenario: isAdultCard('happens', s.scenario) ? options.scenarios[0] : s.scenario,
    environment: isAdultCard('where', s.environment) ? options.environments[0] : s.environment,
  }
}

const MUSIC_EMOJI: [RegExp, string][] = [
  [/^Heavy/, '🤘'],
  [/^Hip-Hop/, '🎤'],
  [/^Classical/, '🎻'],
  [/^Electronic/, '🎛'],
  [/^(Mainstream )?Pop/, '🎙'],
  [/^R&B/, '🎷'],
  [/^Country/, '🤠'],
  [/^Funk/, '🪩'],
  [/^Reggae/, '🌴'],
  [/^(Classic )?Rock/, '🎸'],
]

export function musicEmoji(key: string): string {
  return MUSIC_EMOJI.find(([re]) => re.test(key))?.[1] ?? '🎵'
}

const CAMERA_ANIM: Record<string, string> = {
  'Push in': 'cam-push',
  'Pull back': 'cam-pull',
  'Pan left': 'cam-pan-left',
  'Pan right': 'cam-pan-right',
  'Tilt up': 'cam-tilt-up',
  'Tilt down': 'cam-tilt-down',
  'Truck left': 'cam-truck-left',
  'Truck right': 'cam-truck-right',
  'Handheld sway': 'cam-handheld',
}

export function cameraAnim(key: string): string | null {
  return CAMERA_ANIM[key] ?? null
}

export type PresetRowId = 'where' | 'happens' | 'camera' | 'music' | 'talking' | 'pov'

/** The idea's own scene words: the only image-helper rows the video dialog shows. */
export const VIDEO_SCENE_ROWS: readonly PickRowId[] = ['who', 'hair', 'haircolor', 'wear']

export interface PresetCard { value: string; label: string; emoji: string; thumb?: string; anim?: string }

export function visibleVideoRows({ scene, ltx, simple }: { scene: boolean; ltx: boolean; simple: boolean }):
  { scene: PickRowId[]; presets: PresetRowId[] } {
  const all: PresetRowId[] = ['where', 'happens', 'camera', 'music', 'talking', 'pov']
  const drop: PresetRowId[] = simple && ltx ? ['music', 'talking', 'pov'] : []
  return {
    scene: scene ? [...VIDEO_SCENE_ROWS] : [],
    presets: all.filter((r) => (scene || r !== 'where') && !drop.includes(r)),
  }
}

/**
 * The writer's settings for a write in Simple on LTX, where Music, Talking and
 * POV are hidden (above). Both sides are pinned on purpose and must stay equal:
 * the render by simpleVideoValues (simple-values.ts: no POV, standard talking,
 * music left on the graph's "None" key = no background music) and the writer
 * here — no music, speech as usual, no POV, never the Advanced values saved
 * behind the overlay. A script that wrote music would fight the render's negative.
 */
export function simpleLtxSettings(s: EnhanceSettingsValues, options: VideoPromptOptions): EnhanceSettingsValues {
  return { ...s, music: options.music[0], dialogueTier: 'standard', pov: false, povGender: 'female' }
}

const TALKING: PresetCard[] = [
  { value: 'none', label: 'Silent', emoji: '🤫' },
  { value: 'standard', label: 'Standard', emoji: '💬' },
  { value: 'talkative', label: 'Talkative', emoji: '🗣' },
]
const POV: PresetCard[] = [
  { value: 'off', label: 'Off', emoji: '🎬' },
  { value: 'female', label: 'POV ♀', emoji: '👩' },
  { value: 'male', label: 'POV ♂', emoji: '👨' },
]

/** A row's cards; 18+ ones only with the switch on and a Who that is not an animal or robot (`idea`). */
export function cardsFor(row: PresetRowId, options: VideoPromptOptions, nsfw: boolean, idea = ''): PresetCard[] {
  if (row === 'talking') return TALKING
  if (row === 'pov') return POV
  const list = { where: options.environments, happens: options.scenarios, camera: options.cameras, music: options.music }[row]
  const adult = nsfw && personOk(idea)
  return list
    .filter((k) => adult || !isAdultCard(row, k))
    .map((value) => {
      const { emoji, label } = presetLabel(value)
      const card: PresetCard = { value, label, emoji }
      if (row === 'where' || row === 'happens') card.thumb = presetThumb(row, value)
      if (row === 'music' && !emoji && !isSentinel(value)) card.emoji = musicEmoji(value)
      if (row === 'camera') card.anim = cameraAnim(value) ?? undefined
      return card
    })
}

export function selectedOf(row: PresetRowId, s: EnhanceSettingsValues): string {
  switch (row) {
    case 'where': return s.environment
    case 'happens': return s.scenario
    case 'camera': return s.camera
    case 'music': return s.music
    case 'talking': return s.dialogueTier
    case 'pov': return s.pov ? s.povGender : 'off'
  }
}

function setRow(s: EnhanceSettingsValues, row: PresetRowId, value: string): EnhanceSettingsValues {
  switch (row) {
    case 'where': return { ...s, environment: value }
    case 'happens': return { ...s, scenario: value }
    case 'camera': return { ...s, camera: value }
    case 'music': return { ...s, music: value }
    case 'talking': return { ...s, dialogueTier: value as EnhanceSettingsValues['dialogueTier'] }
    case 'pov': return value === 'off' ? { ...s, pov: false } : { ...s, pov: true, povGender: value as 'female' | 'male' }
  }
}

const defaultOf = (row: PresetRowId, o: VideoPromptOptions): string =>
  ({ where: o.environments[0], happens: o.scenarios[0], camera: o.cameras[0], music: o.music[0], talking: 'standard', pov: 'off' })[row]

/** Click a card; clicking the lit one puts the row back to its default. */
export function pickPreset(s: EnhanceSettingsValues, row: PresetRowId, value: string, options: VideoPromptOptions): EnhanceSettingsValues {
  return setRow(s, row, selectedOf(row, s) === value ? defaultOf(row, options) : value)
}

/** Any card but a "None"/"Random" one, and not the one already lit when another exists. */
export function rerollPreset(s: EnhanceSettingsValues, row: PresetRowId, options: VideoPromptOptions, nsfw: boolean,
  rand: () => number = Math.random): EnhanceSettingsValues {
  const now = selectedOf(row, s)
  const all = cardsFor(row, options, nsfw, s.userIntent).map((c) => c.value).filter((v) => !isSentinel(v) && v !== 'off')
  const pool = all.filter((v) => v !== now)
  const from = pool.length ? pool : all
  if (!from.length) return s
  return setRow(s, row, from[Math.min(from.length - 1, Math.floor(rand() * from.length))])
}

/**
 * Surprise me: with `scene`, the idea's scene words first, then every unkept row
 * against THAT idea's Who; a kept 18+ card goes too under an animal Who.
 */
export function surpriseVideo(s: EnhanceSettingsValues,
  ctx: { rows: PresetRowId[]; keep: ReadonlySet<string>; nsfw: boolean; options: VideoPromptOptions; scene?: boolean },
  rand: () => number = Math.random): EnhanceSettingsValues {
  const start = ctx.scene ? { ...s, userIntent: surpriseIdea(s.userIntent, ctx.keep, ctx.nsfw, rand) } : s
  const out = ctx.rows.reduce((acc, row) => (ctx.keep.has(row) ? acc : rerollPreset(acc, row, ctx.options, ctx.nsfw, rand)), start)
  return fitWho(out, ctx.options)
}

/** Re-roll the idea's scene words only; every image-helper row outside VIDEO_SCENE_ROWS is kept. */
export function surpriseIdea(idea: string, keep: ReadonlySet<string>, nsfw: boolean, rng?: () => number): string {
  const kept = new Set<PickRowId>(PICK_ROWS.map((r) => r.id).filter((id) => !VIDEO_SCENE_ROWS.includes(id)))
  for (const k of keep) kept.add(k as PickRowId)
  return surprise(idea, 'sentences', { keep: kept, nsfw, rng })
}

export function summaryLine(s: EnhanceSettingsValues): string {
  const ref = parseWriterId(s.model)
  const name = s.model ? (ref && ref.kind !== 'builtin' ? ref.model : s.model) : 'No writer'
  return [name, s.dialogueTier, s.pov ? 'POV' : null, `energy ${s.energy}`].filter(Boolean).join(' · ')
}

/** A saved form from before the picker: "None" / a bare Ollama name become a writer id. */
export function migrateWriterId(saved: string): string {
  if (!saved || saved === 'None') return ''
  return parseWriterId(saved) ? saved : `ollama:${saved}`
}
