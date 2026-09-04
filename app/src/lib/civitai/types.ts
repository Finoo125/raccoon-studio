/**
 * The subset of Civitai's responses this app consumes, plus the pure helpers
 * that go with them. Deliberately partial — their payloads carry dozens of
 * fields we neither read nor want to track.
 *
 * ⚠️ **This module must stay free of Node built-ins.** Its sibling `client.ts`
 * imports `oauth.ts`, which reaches `json-store` and therefore `fs`; a client
 * component importing anything from `client.ts` drags `fs` into the browser
 * bundle and the build dies with "Module not found: Can't resolve 'fs'".
 * Anything a component needs lives here instead. Same split, and the same
 * reason, as `lora-family.ts` vs `lora-arch.ts`.
 */
/** Where a Civitai `type` belongs on disk. LoCon, LyCORIS and DoRA are all
 *  adapters by another name and load through the same loader as a LoRA.
 *  Lives here, not in `client.ts`, because the browse pane needs it. */
export function folderForType(type: string): 'loras' | 'checkpoints' {
  return ['lora', 'locon', 'lycoris', 'dora'].includes(type.toLowerCase())
    ? 'loras'
    : 'checkpoints'
}

export interface CivitaiFile { name: string; sizeKB: number; type: string }

/** `type` matters: roughly 4% of previews are mp4 clips, and an `<img>` cannot
 *  decode one. Civitai sends the discriminator; dropping it from this interface
 *  is what put video URLs into image tags. */
export interface CivitaiImage { url: string; type?: 'image' | 'video' }

export interface CivitaiVersion {
  id: number
  name: string
  baseModel: string
  publishedAt: string
  files: CivitaiFile[]
  images: CivitaiImage[]
  downloadUrl: string
}

/**
 * The previews an `<img>` can actually render, with video previews converted
 * rather than discarded.
 *
 * Measured 2026-08-28: 10 of 244 previews on one page are `.mp4`, and **3 of 24
 * cards** had a video first — each an empty grey tile, with no HTTP error to
 * explain it (the bytes arrive fine; the tag simply cannot decode them).
 *
 * Civitai's CDN will render a still from a video if the transform segment of
 * the path asks for one: swapping `original=true` for `anim=false,width=450`
 * turns a 922 KB `video/webm` into a 102 KB `image/jpeg`. Only that segment may
 * change — renaming the file to `.jpeg` is ignored and still serves the video.
 * Dropping them instead left blank tiles, which the dense grid made obvious.
 */
export const stillImages = (images: CivitaiImage[]): CivitaiImage[] =>
  images.flatMap((i) => {
    if (i.type !== 'video') return [i]
    const still = i.url.replace(/\/[^/]*=[^/]*\/(?=[^/]+$)/, '/anim=false,width=450/')
    // No transform segment to rewrite means no still can be asked for, and an
    // <img> cannot decode the video — drop it rather than render an empty tile.
    return still === i.url ? [] : [{ ...i, url: still }]
  })

/**
 * Civitai's sort values, exactly as their API spells them.
 *
 * All seven verified live 2026-08-28; `Relevancy` — the obvious eighth guess —
 * is a 400.
 */
export const CIVITAI_SORTS = [
  'Most Downloaded', 'Newest', 'Highest Rated', 'Most Liked', 'Most Collected',
  'Most Images', 'Oldest',
] as const

/**
 * Base models offered in the browse filter, grouped by whether Raccoon Studio
 * can actually run them.
 *
 * ⚠️ **These strings must match Civitai's spelling exactly.** `baseModels` with
 * an unknown value returns `200` and **zero items** — no error — so a typo here
 * is a filter that silently finds nothing, the same trap as a comma-joined
 * `types`. Every value below was taken from live results and re-probed against
 * the filter (2026-08-28); the counts are how often each appeared in a
 * 200-model sample, which is what the ordering follows.
 */
export const CIVITAI_BASE_MODELS: { group: string; models: string[] }[] = [
  {
    group: 'Runs in Raccoon Studio',
    models: [
      'Illustrious', 'SDXL 1.0', 'Pony', 'NoobAI',
      'Krea 2', 'Anima', 'ZImageTurbo', 'ZImageBase', 'Ernie',
      'MiniMax H3', 'LTXV 2.3',
    ],
  },
  {
    group: 'Other',
    models: ['SD 1.5', 'Flux.1 D', 'Flux.1 S', 'Qwen', 'Wan Video 2.2 I2V-A14B', 'Chroma'],
  },
]

export interface CivitaiModel {
  id: number
  name: string
  /** HTML, authored by a third party. Render as text, never with
   *  dangerouslySetInnerHTML. */
  description: string | null
  type: string
  nsfw: boolean
  creator?: { username: string }
  stats?: { downloadCount: number; thumbsUpCount: number }
  modelVersions: CivitaiVersion[]
}
