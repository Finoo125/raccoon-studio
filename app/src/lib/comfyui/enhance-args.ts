import { isLtxWorkflow } from '@/lib/workflows/video-index'
import {
  compactRefRoles, compactRefs, h3ClampDuration, h3FrameCount, h3Keyframes, h3RefCount, h3Task, H3_FPS,
} from '@/lib/workflows/minimax-h3'
import type { EnhanceArgs } from './useCinematicEnhance'
import type { EnhanceSettingsValues } from './enhance-settings'
import type { H3KeyframeSlot, VideoGenerationParams } from '@/types/video-workflow'

/**
 * Everything the enhance call is built from. Plain data on purpose: the two
 * async parts — reading the timeline and fetching each shot's picture — happen
 * in the form hook, so the decisions below stay pure and testable.
 */
export interface EnhanceArgsInput {
  settings: EnhanceSettingsValues
  params: VideoGenerationParams
  /** The selected video workflow's id (`workflow.id`). */
  workflowId: string
  /** The one image the i2v and reference slots hold, already base64. */
  imageB64: string
  /** MiniMax H3 only: the end-frame slot's picture, already base64. */
  endImageB64?: string
  /** MiniMax H3 only: the last frame of the clip being continued, already base64. */
  continueFrameB64?: string
  /** Director only: every shot's picture, in play order, already fetched. */
  directorImages?: string[]
  /**
   * MiniMax H3 reference mode: the keyframe pictures, already fetched. A slot
   * whose picture failed to read is simply absent — and then not named either.
   */
  keyframeImages?: { slot: H3KeyframeSlot; b64: string }[]
}

/**
 * What the prompt enhancer is told about this job.
 *
 * Three of these fields are decisions rather than passthroughs, and each one
 * has been wrong at some point:
 *
 * - **`imageB64`** — what the vision pass gets to look at. Director hands over
 *   every shot's picture, because the brief describes a whole timeline and one
 *   frame of it anchors nothing. Reference mode sends the FIRST reference only
 *   (`ReferenceImages` is the only slot that sets `imageB64`). t2v owns no image
 *   at all: `imageB64` survives a mode switch, so passing it on would start a
 *   vision pass on a picture the user has moved away from.
 * - **`videoMode`** — passed through, including `director`. It used to be
 *   rewritten to `t2v`, which asks the node for a doctrine that swears there is
 *   no reference image while the pictures sit on the timeline.
 *
 *   On H3 it is the derived *task* rather than the picked mode: filling the end
 *   frame slot turns `i2v` into `fl2v` or `l2v`, each of which has its own
 *   mandatory alignment line in MiniMax's guide. LTX keeps the raw mode — it has
 *   no last-frame input and its brain knows only t2v/i2v/director.
 * - **`videoModel`** — picks the doctrine node-side. Director enhances against
 *   the LTX brain and renders on the LTX graph, so it reports the LTX id rather
 *   than its own.
 */
export function buildEnhanceArgs({
  settings, params, workflowId, imageB64, endImageB64 = '', continueFrameB64 = '', directorImages = [],
  keyframeImages = [],
}: EnhanceArgsInput): EnhanceArgs {
  // `edit` is H3-only and Enhance is off in it; LTX can never be handed one,
  // so the narrowing is for the type, not a reachable path.
  const task = isLtxWorkflow(workflowId) ? (params.mode === 'edit' ? 't2v' : params.mode) : h3Task(params)
  // Reference mode can carry two things the writer must SEE: the clip it
  // continues (its last frame) and keyframes it must hit. Only keyframes whose
  // picture was actually read are named, so the node's numbering always
  // matches what it was shown — it refuses on a mismatch rather than write blind.
  const len = h3FrameCount(h3ClampDuration(params.durationSeconds))
  const rendered = isLtxWorkflow(workflowId) ? [] : h3Keyframes(params, len)
  const shown = rendered.flatMap((k) => {
    const b64 = keyframeImages.find((i) => i.slot === k.slot)?.b64
    return b64 ? [{ ...k, b64 }] : []
  })
  const refContinuing = task === 'ref2v' && Boolean(params.continueFrom)
  return {
    model: settings.model,
    videoMode: task,
    // The vision pass has to see every frame the doctrine talks about, in the
    // order the doctrine numbers them: fl2v's head calls them Picture 1 and
    // Picture 2, so start must come first. l2v sends the end frame alone — it
    // is the only image that exists, and its head says so.
    // A continuation is shown the previous clip's last frame and nothing else:
    // the start-frame slot may still hold another project's picture (Continue
    // merges over the form), and it is not what the render opens on.
    imageB64:
      params.mode === 'director' ? directorImages
      : task === 'ref2v' && (shown.length || refContinuing)
        ? [refContinuing ? continueFrameB64 : '', ...shown.map((k) => k.b64)].filter(Boolean)
      : task === 'continue' ? continueFrameB64
      : task === 'fl2v' ? [imageB64, endImageB64].filter(Boolean)
      : task === 'l2v' ? endImageB64
      : params.mode === 't2v' ? ''
      : imageB64,
    // Which reference types are attached, so the H3 ref2va doctrine names only
    // those. Told about a type that is not there, the model invents a role for
    // a reference H3 never receives. Undefined outside reference mode.
    refCounts:
      params.mode === 'ref2v'
        ? {
            images: compactRefs(params.refImages).length,
            videos: compactRefs(params.refVideos).length,
            audios: compactRefs(params.refAudios).length,
            // Rides inside ref_counts rather than as a body field of its own:
            // every forwarder of ref_counts — the route, the doctrine, the A/B
            // harness — then carries roles with no second signature to update.
            // snake_case because ref_counts is passed to the node verbatim.
            image_roles: compactRefRoles(params.refImages, params.refImageRoles),
            // Spread only when present, so a plain reference render's body is
            // exactly what it was.
            ...(shown.length
              ? { keyframes: shown.map((k) => ({ slot: k.slot, at_s: Math.round((k.frame / H3_FPS) * 100) / 100 })) }
              : {}),
            ...(refContinuing ? { continuing: true as const } : {}),
          }
        : undefined,
    environment: settings.environment,
    scenario: settings.scenario,
    camera: settings.camera,
    music: settings.music,
    pov: settings.pov,
    povGender: settings.povGender,
    dialogueTier: settings.dialogueTier,
    energy: settings.energy,
    userIntent: settings.userIntent,
    // The writer sizes shots, dialogue and the keyframe alignment timestamp off
    // this number, so it has to be the duration that will actually render. H3
    // clamps to its trained 5–15 s; LTX has no such ceiling and keeps the slider.
    durationS: isLtxWorkflow(workflowId)
      ? params.durationSeconds
      : h3ClampDuration(params.durationSeconds),
    videoModel: isLtxWorkflow(workflowId) ? 'ltx23' : workflowId,
    // Sent whichever doctrine is writing: only H3's reads it, and the LTX brain
    // swallows unknown kwargs, so this needs no per-model branch.
    // Keyframes force one shot: a cut between two of them would throw away the
    // motion path they define. Keyed on what RENDERS, not on what was read —
    // the guides are in the graph even when a picture failed to reach the writer.
    singleShot: params.singleShot === true || rendered.length > 0,
  }
}

/**
 * Whether an image-anchored render is missing the image it needs.
 *
 * i2v is satisfied by EITHER frame: with only the end frame filled the task is
 * H3's l2v — open somewhere plausible and converge on that image — which is a
 * render, not a missing input.
 */
export const missingFrame = (p: VideoGenerationParams) =>
  p.mode === 'i2v' && !p.inputImage && !p.endImage

/**
 * Why a script cannot be written yet, or null. Same order as the old Enhance button.
 * `idea: false` for Make it better and Try again: they work on the script, not the idea.
 */
export function writeBlockReason(p: VideoGenerationParams, s: EnhanceSettingsValues, { idea = true } = {}): string | null {
  if (!s.model) return 'Pick a writer first.'
  if (missingFrame(p)) return 'Upload a start or end frame first.'
  if (p.mode === 'ref2v' && !h3RefCount(p)) return 'Add at least one reference first.'
  if (idea && !s.userIntent.trim()) return 'Describe your idea above first.'
  return null
}
