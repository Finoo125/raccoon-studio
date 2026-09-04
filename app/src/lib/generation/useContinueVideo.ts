'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useStudioStore, type StudioPrefill } from './studio-store'
import { minimaxH3Workflow } from '@/lib/workflows/minimax-h3'
import type { GalleryImage } from '@/types/gallery'

/**
 * The clip's path relative to ComfyUI's output dir, which is what
 * `continueFrom` wants. Forward slashes: it ends up in a ComfyUI node input,
 * not on a filesystem call.
 */
export const clipOutputPath = (v: Pick<GalleryImage, 'filename' | 'subfolder'>): string =>
  v.subfolder ? `${v.subfolder.replace(/\\/g, '/')}/${v.filename}` : v.filename

/**
 * Only H3 can be continued. LTX has no equivalent of `MiniMaxH3AddGuide`, and
 * offering the button on a clip that cannot be continued is worse than not
 * offering it — the render would fail at validation with a node error.
 *
 * Read off the recorded workflow rather than the filename: the gallery holds
 * clips from every family and from older versions of this app.
 */
export const canContinue = (v: GalleryImage): boolean =>
  v.media === 'video' && /minimax|h3/i.test(v.metadata?.workflow ?? '')

/**
 * Set up the video form to continue an existing H3 clip.
 *
 * Nothing is uploaded or copied: the graph reads the clip straight out of the
 * output dir, so this only has to carry the path and the settings that must not
 * drift across a chain.
 *
 * **Nothing about size is carried here, and that is deliberate.** An earlier
 * version of this comment claimed resolution and orientation were passed
 * forward; they were not, and the mismatch shipped — a portrait source
 * continued while the form said landscape came back centre-cropped and
 * upscaled. The fix is not to add them to this object, where they could drift
 * from the source again, but to have the graph read the size off the previous
 * clip's own frames (`GetImageSize` in `minimax-h3.ts`). The gallery does not
 * record video dimensions anyway, so this side genuinely cannot know them.
 */
export function continuationPrefill(video: GalleryImage, huntCount = 0): StudioPrefill {
  const m = video.metadata ?? {}
  return {
    workflowId: minimaxH3Workflow.id,
    /**
     * Always written, never left undefined: the form keeps `huntCount` across a
     * same-route Continue, so omitting it would inherit the previous hunt's
     * size when the dialog said "just one".
     */
    huntCount,
    params: {
      /**
       * **`videoModel`, not just `workflowId`.** The form picks its workflow
       * from `params.videoModel`; `workflowId` on the prefill is not read at
       * all. Omitting this left the form on whatever model was selected before
       * — and on LTX the builder ignores `continueFrom` outright, so the render
       * succeeded and silently was not a continuation. Found in a browser, not
       * by a unit test, because the unit tests hand params straight to the
       * builder and never go through the form's model selection.
       */
      videoModel: minimaxH3Workflow.id,
      // t2v: the pinned head is the opening, so there is no start frame.
      mode: 't2v',
      continueFrom: clipOutputPath(video),
      /**
       * Carried when the clip actually recorded one — which for video is the
       * exception, not the rule: an mp4 does not embed the graph the way a PNG
       * does, so most clips come back with no prompt at all (a joined clip
       * never has one). That is why this spreads conditionally instead of
       * writing `prompt: undefined`: the prefill is merged over current form
       * state, so omitting the key leaves whatever the user already has —
       * which, right after rendering the clip they are continuing, is exactly
       * the right prompt. Writing undefined would blank it and disable
       * Generate.
       *
       * Keeping the prompt unchanged is also the safe default on its own: H3
       * renders a contradicting prompt as a *union* with what it was shown
       * rather than replacing it.
       */
      ...(m.prompt ? { prompt: m.prompt } : {}),
      // A fresh seed every time, so pressing Generate again is a re-roll of
      // this same link rather than a repeat of it.
      seed: -1,
    },
  }
}

/**
 * Open the Continue dialog for a clip. The dialog (mounted once in the studio
 * layout) asks how many takes to render and does the prefill + navigation, so
 * every Continue button stays a one-liner and there is exactly one copy of the
 * "how many?" question.
 */
export function useContinueVideo() {
  const setContinueTarget = useStudioStore((s) => s.setContinueTarget)

  return useCallback(
    (video: GalleryImage) => {
      if (!canContinue(video)) {
        toast.error('Only MiniMax H3 clips can be continued')
        return
      }
      setContinueTarget(video)
    },
    [setContinueTarget],
  )
}
