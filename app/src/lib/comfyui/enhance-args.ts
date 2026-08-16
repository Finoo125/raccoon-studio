import { isLtxWorkflow } from '@/lib/workflows/video-index'
import { compactRefs, h3Task } from '@/lib/workflows/minimax-h3'
import type { EnhanceArgs } from './useCinematicEnhance'
import type { EnhanceSettingsValues } from '@/components/generation/EnhanceSettings'
import type { VideoGenerationParams } from '@/types/video-workflow'

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
  /** Director only: every shot's picture, in play order, already fetched. */
  directorImages?: string[]
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
  settings, params, workflowId, imageB64, endImageB64 = '', directorImages = [],
}: EnhanceArgsInput): EnhanceArgs {
  const task = isLtxWorkflow(workflowId) ? params.mode : h3Task(params)
  return {
    model: settings.model,
    videoMode: task,
    // The vision pass has to see every frame the doctrine talks about, in the
    // order the doctrine numbers them: fl2v's head calls them Picture 1 and
    // Picture 2, so start must come first. l2v sends the end frame alone — it
    // is the only image that exists, and its head says so.
    imageB64:
      params.mode === 'director' ? directorImages
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
    durationS: params.durationSeconds,
    videoModel: isLtxWorkflow(workflowId) ? 'ltx23' : workflowId,
  }
}
