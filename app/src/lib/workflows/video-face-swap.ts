import type { ComfyUIPrompt } from '@/types/comfyui'
import { appendVideoPost, type VideoPostParams } from './minimax-h3'

/**
 * Post-render face swap for video: replace up to four characters' faces in a
 * finished clip without re-rendering it.
 *
 * The fallback for when H3's `ref2v` conditions on a reference and still does
 * not land the exact face. See
 * `docs/superpowers/specs/2026-09-07-video-face-swap-design.md`.
 */

/** Character slots. Four, matching the node and the app's LoRA-slot convention. */
export const MAX_SWAP_CHARACTERS = 4

/**
 * The node classes the UI probes via `/object_info` before offering the feature.
 *
 * Same doctrine as `FACE_SWAP_NODE` / `PIXEL_BOOST_NODE` in `face-swap.ts`: a
 * probe for a class the builder no longer emits would report a working feature
 * and then fail at queue time with a bare "Generation failed" — which is exactly
 * how a broken `RaccoonSwapNodes` import once cost a user their face swap with
 * no visible error. Tests below assert the builders really emit both.
 */
export const VIDEO_SWAP_NODE = 'RaccoonVideoFaceSwap'
export const DETECT_FACES_NODE = 'RaccoonDetectFaces'

/** Where a clip lives, as core `LoadVideo` has to be told about it. */
export interface VideoSource {
  /** Filename, or output-relative path including subfolders. */
  file: string
  /**
   * `'output'` appends the ` [output]` annotation that makes core `LoadVideo`
   * read from ComfyUI's output dir instead of its input dir — the same
   * mechanism H3 continuation uses, so an app-rendered clip needs no copy and no
   * re-upload. `'input'` is a plain filename, for video the user imported and
   * the app uploaded.
   */
  location: 'input' | 'output'
}

export interface SwapCharacter {
  /**
   * Reference crop filename in ComfyUI's input dir, as written by
   * `RaccoonDetectFaces`. This is the character **as the clip rendered them** —
   * it says which face to replace, and cannot be the replacement photo: the
   * rendered face not looking like the source is the whole problem being fixed.
   */
  reference: string
  /** Saved ReActor face model (`models/reactor/faces/`). Wins over `sourceImage`. */
  faceModel?: string
  /** Uploaded replacement photo in ComfyUI's input dir. */
  sourceImage?: string
}

export interface VideoFaceSwapOptions {
  /**
   * Defaults to whatever the node picks, which is a 256px swapper. Pixel boost
   * runs `(boost / model_size)^2` passes per face per frame, so a 256px model at
   * 512 boost costs 4 against `inswapper_128`'s 16 — on every frame.
   */
  swapModel?: string
  pixelBoost?: '512x512' | '768x768' | '1024x1024'
  /** Identity dial, 0.5 = neutral (and the maximum-likeness point). */
  identity?: number
  /** Cosine floor for matching a detected face to a character reference. */
  matchThreshold?: number
  /** Detector score floor. Lower catches three-quarter turns. */
  minScore?: number
  /** Landmark EMA weight on the previous frame; 0 disables smoothing. */
  smooth?: number
  /**
   * False: a clip where no face matched comes back unswapped with a note instead
   * of failing the job. For swaps spliced into a longer render (H3 Edit). Sent
   * only when set, so every other swap graph keeps the node's strict default.
   */
  strict?: boolean
  /**
   * Occlusion segmenter filename, so a hand or a mic in front of the face stays
   * in front. `OCCLUSION_OFF` (the default) skips the mask entirely.
   *
   * A filename rather than a flag because the node's `occlusion` input is a
   * combo of what is installed in `models/facefusion/` — which means
   * `/object_info` answers "is the occluder downloaded?" through the same
   * mechanism the app already uses for swap models and face models, instead of
   * needing a disk probe of its own. Read the options with
   * `comboOptions(data, VIDEO_SWAP_NODE, 'occlusion')`; anything past
   * `OCCLUSION_OFF` is an installed model. The node raises rather than
   * degrading if handed a name that is not on disk, on the same doctrine as the
   * Turbo tiers.
   */
  occluder?: string
  /**
   * Finishing passes to run AFTER the swap, for a clip rendered with
   * `params.swapFaces` — that render skipped them so this job could do the swap
   * on raw frames and then finish over the top.
   *
   * Present only on that path. Absent means "this clip is already finished",
   * which is the gallery and imported-video case: running grain a second time
   * would stack it, and an upscale would take a delivered clip to 2.25x.
   */
  post?: VideoPostParams
}

/** The node's "no occlusion mask" choice — first entry of its `occlusion` combo. */
export const OCCLUSION_OFF = 'off'

export interface VideoFaceSwapRefs extends VideoFaceSwapOptions {
  clip: VideoSource
  characters: SwapCharacter[]
}

/**
 * The finishing passes a render held back for the swap, or null if it held none.
 *
 * The one place that decides, so the canvas and the dialog cannot disagree.
 * `swapFaces` is what makes a clip unfinished; without it the clip already has
 * its grain and its upscale, and handing them to the swap job would grain it
 * twice and upscale it to 2.25x.
 */
export function pendingPost(
  params: (VideoPostParams & { swapFaces?: boolean }) | undefined | null,
): VideoPostParams | null {
  if (!params?.swapFaces) return null
  const { rife, upscale, sharpen, filmGrain } = params
  return { rife, upscale, sharpen, filmGrain }
}

/** `LoadVideo`'s `file` value for a clip, annotated when it lives in output/. */
function videoFile(clip: VideoSource): string {
  return clip.location === 'output' ? `${clip.file} [output]` : clip.file
}

/**
 * The clip behind a player URL, for entry points that only hold one.
 *
 * The app serves finished clips from two different routes —
 * `/api/comfyui/view?…` for a fresh render and `/api/gallery/video?…` for the
 * gallery — and only the first carries a `type`. Both carry `filename` and
 * `subfolder`, which is what makes one parser work for both; anything the
 * gallery serves lives in the output dir, which is also ComfyUI's own default,
 * so an absent `type` means output rather than "unknown".
 *
 * Backslashes are normalised because a Windows subfolder arrives with them and
 * this string ends up in a ComfyUI node input, not on a filesystem call.
 */
export function clipFromUrl(url: string): VideoSource | null {
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const filename = q.get('filename')
  if (!filename) return null
  const subfolder = (q.get('subfolder') ?? '').replace(/\\/g, '/')
  return {
    file: subfolder ? `${subfolder}/${filename}` : filename,
    location: q.get('type') === 'input' ? 'input' : 'output',
  }
}

/**
 * Validates the character list against the node's contract, so a
 * misconfiguration surfaces in the UI instead of as a red node mid-queue.
 *
 * A character with a reference but no replacement (or the reverse) is rejected
 * rather than skipped: skipping renders a clip that looks finished and still has
 * the wrong face in it, and the only way to notice is to watch the whole thing.
 */
export function validateCharacters(characters: SwapCharacter[]): void {
  if (characters.length === 0) {
    throw new Error('Pick at least one face to replace')
  }
  if (characters.length > MAX_SWAP_CHARACTERS) {
    throw new Error(`At most ${MAX_SWAP_CHARACTERS} faces can be replaced in one pass`)
  }
  characters.forEach((c, i) => {
    if (!c.reference) throw new Error(`Face ${i + 1} has no reference crop`)
    if (!c.faceModel && !c.sourceImage) {
      throw new Error(`Face ${i + 1} has no replacement — pick a face model or a photo`)
    }
  })
}

/**
 * Wires the swap node over a node that produces video frames, and returns its
 * id. Shared by the post-process graph and the in-render splice so both paths
 * can never drift on defaults.
 */
export function appendVideoFaceSwap(
  wf: ComfyUIPrompt,
  framesRef: [string, number],
  refs: Omit<VideoFaceSwapRefs, 'clip'>,
  prefix = 'vfs',
): string {
  validateCharacters(refs.characters)

  const slots: Record<string, unknown> = {}
  refs.characters.forEach((c, i) => {
    const n = i + 1
    const refId = `${prefix}:ref${n}`
    wf[refId] = { class_type: 'LoadImage', inputs: { image: c.reference } }
    slots[`reference_${n}`] = [refId, 0]

    // A face model is an average over several photos, so it carries less of any
    // one shot's lighting and expression. It wins where both are set, which is
    // also what the node does — but only one is ever wired.
    if (c.faceModel) {
      const srcId = `${prefix}:model${n}`
      wf[srcId] = { class_type: 'ReActorLoadFaceModel', inputs: { face_model: c.faceModel } }
      slots[`face_model_${n}`] = [srcId, 0]
    } else {
      const srcId = `${prefix}:photo${n}`
      wf[srcId] = { class_type: 'LoadImage', inputs: { image: c.sourceImage } }
      slots[`source_image_${n}`] = [srcId, 0]
    }
  })

  const swapId = `${prefix}:swap`
  wf[swapId] = {
    class_type: VIDEO_SWAP_NODE,
    _meta: { title: 'Video face swap' },
    inputs: {
      image: framesRef,
      // Every option is written explicitly rather than left to the node's
      // widget defaults: a graph posted through the API carries no widget
      // values, so an omitted input is a missing argument, not a default.
      ...(refs.swapModel ? { swap_model: refs.swapModel } : {}),
      pixel_boost: refs.pixelBoost ?? '512x512',
      identity: refs.identity ?? 0.5,
      match_threshold: refs.matchThreshold ?? 0.3,
      min_score: refs.minScore ?? 0.4,
      smooth: refs.smooth ?? 0.4,
      occlusion: refs.occluder || OCCLUSION_OFF,
      ...(refs.strict !== undefined ? { strict: refs.strict } : {}),
      ...slots,
    },
  }
  return swapId
}

/**
 * The whole post-process job: load a finished clip, swap the faces, write a new
 * one beside it.
 *
 * Core ComfyUI apart from our node and `ReActorLoadFaceModel` — no VHS, no new
 * pinned pack. Audio and frame rate ride through `GetVideoComponents`, so the
 * swapped clip keeps H3's jointly-generated soundtrack in sync; taking either
 * from anywhere else is how a clip ends up playing at the wrong speed.
 */
export function buildVideoFaceSwapPrompt(refs: VideoFaceSwapRefs): ComfyUIPrompt {
  const wf: ComfyUIPrompt = {}
  wf['vfs:load'] = { class_type: 'LoadVideo', inputs: { file: videoFile(refs.clip) } }
  wf['vfs:parts'] = { class_type: 'GetVideoComponents', inputs: { video: ['vfs:load', 0] } }

  const swapId = appendVideoFaceSwap(wf, ['vfs:parts', 0], refs)
  // "Swap faces first" clips only (owner, 2026-10-26): the node keeps the original
  // face where the swap cannot work — a turned head, something in front of the face.
  if (refs.post) wf[swapId].inputs.gate = true

  wf['vfs:video'] = {
    class_type: 'CreateVideo',
    inputs: { images: [swapId, 0], fps: ['vfs:parts', 2], audio: ['vfs:parts', 1] },
  }
  // The finishing chain the render held back, now over the swapped frames.
  // Rewrites `vfs:video`'s images (and its fps, if interpolation is on), so it
  // has to run after that node exists and before anything reads it.
  if (refs.post) {
    let n = 0
    appendVideoPost(wf, 'vfs:video', refs.post, () => `vfs:post${n++}`)
  }

  wf['vfs:save'] = {
    class_type: 'SaveVideo',
    inputs: {
      video: ['vfs:video', 0],
      filename_prefix: 'video/FaceSwap/%year%-%month%-%day%/%hour%%minute%%second%-FaceSwap_',
      format: 'auto',
      codec: 'auto',
    },
  }
  return wf
}

export interface DetectFacesRefs {
  clip: VideoSource
  /**
   * Where in the clip to look, 0..1 — the scrubber's `currentTime / duration`.
   *
   * A fraction rather than a frame number because the app cannot see the frame
   * rate: H3 pins 24, RIFE takes it to 36, LTX varies, and an mp4 does not carry
   * the graph that made it. The node clamps and resolves it against the real
   * batch length.
   */
  position: number
  /**
   * Stem for the crop files the node writes into ComfyUI's input dir. Scope it
   * per clip so a re-detect overwrites rather than accumulating; the node
   * strips anything that is not `[A-Za-z0-9_-]` before using it as a path.
   */
  namePrefix: string
  maxFaces?: number
  minScore?: number
}

/**
 * The picker's "Find faces": pull one frame out of the clip and write each face
 * in it as a crop.
 *
 * The crops are read back from `/history` as this node's `ui.images`, shown as
 * thumbnails, and then fed straight back in as `reference_N` — so the face a
 * human clicked on is literally the one the matcher embeds.
 */
export function buildDetectFacesPrompt(refs: DetectFacesRefs): ComfyUIPrompt {
  return {
    'det:load': { class_type: 'LoadVideo', inputs: { file: videoFile(refs.clip) } },
    'det:parts': { class_type: 'GetVideoComponents', inputs: { video: ['det:load', 0] } },
    'det:detect': {
      class_type: DETECT_FACES_NODE,
      inputs: {
        image: ['det:parts', 0],
        // Clamped here too, so a NaN from an unloaded <video> lands on the
        // middle of the clip instead of reaching the node as a bad float.
        position: Number.isFinite(refs.position) ? Math.min(Math.max(refs.position, 0), 1) : 0.5,
        name_prefix: refs.namePrefix,
        max_faces: refs.maxFaces ?? MAX_SWAP_CHARACTERS,
        min_score: refs.minScore ?? 0.4,
      },
    },
  }
}

/**
 * The detector over one still picture. Edit's Person picture is checked with it
 * before the in-graph swap is offered: the swap node raises on a reference with
 * no face, and in an edit that would fail the render at its very last step.
 */
export function buildDetectPictureFacesPrompt(image: string, namePrefix: string): ComfyUIPrompt {
  return {
    'det:load': { class_type: 'LoadImage', inputs: { image } },
    'det:detect': {
      class_type: DETECT_FACES_NODE,
      // 0.5 = the analyzer default the swap itself finds reference and source
      // faces at; a lower floor would pass a picture the render then fails on.
      inputs: { image: ['det:load', 0], position: 0, name_prefix: namePrefix, max_faces: 1, min_score: 0.5 },
    },
  }
}

/**
 * `RaccoonDetectFaces` answers "no face" by raising, not with an empty result,
 * so a picture without a face arrives as a failed prompt. This reads that one
 * refusal as the answer it is.
 */
export const isNoFaceError = (e: unknown): boolean =>
  e instanceof Error && /no face found/i.test(e.message)
