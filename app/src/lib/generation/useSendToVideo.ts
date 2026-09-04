'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStudioStore } from './studio-store'
import { uploadImageBlob } from './upload'
import { downscaleToB64AndDims } from './image-b64'
import { ltx23Workflow } from '@/lib/workflows/ltx23'
import { minimaxH3Workflow } from '@/lib/workflows/minimax-h3'
import type { StudioPrefill } from './studio-store'

/**
 * Where a sent image lands in the video form.
 *
 * `source` is the original behaviour: LTX's i2v start frame. `reference` puts it
 * in MiniMax H3's first reference slot instead — a different workflow *and* a
 * different mode, which is why the two cannot share one prefill and why the
 * caller has to say which it means.
 *
 * `h3-start` / `h3-end` are the same i2v idea on H3 instead of LTX. They are
 * separate targets rather than a flag because which slot is filled is what
 * chooses H3's task: start alone is i2v, start+end is FL2VA, end alone is L2VA.
 */
export type SendToVideoTarget = 'source' | 'reference' | 'h3-start' | 'h3-end'

/** Human labels, so the picker dialog and the toasts cannot drift apart. */
export const SEND_TARGET_LABEL: Record<SendToVideoTarget, string> = {
  source: 'source image',
  reference: 'reference image',
  'h3-start': 'start frame',
  'h3-end': 'end frame',
}

/**
 * The prefill for one target. Pure, so the slot wiring is checkable without
 * mounting a form — putting a character sheet in `inputImage` instead of
 * `refImages` is silent: the clip renders, it just animates the sheet.
 *
 * Both targets name their own `mode`, which the form's prefill effect takes as
 * final. Only a seed that names no mode still falls back to i2v.
 */
export function videoPrefill(
  target: SendToVideoTarget,
  seed: { filename: string; b64: string; previewUrl: string },
  dims: { width: number; height: number },
): StudioPrefill {
  if (target === 'reference') {
    return {
      workflowId: minimaxH3Workflow.id,
      // Slot 0 specifically: it is the only one feeding the enhancer's vision
      // pass, and it is what the doctrine calls `<Picture 1>`.
      params: { mode: 'ref2v', refImages: [seed.filename] },
      videoSeed: seed,
    }
  }
  if (target === 'h3-start' || target === 'h3-end') {
    const end = target === 'h3-end'
    return {
      workflowId: minimaxH3Workflow.id,
      params: {
        mode: 'i2v',
        ...(end
          ? { endImage: seed.filename, endImageWidth: dims.width, endImageHeight: dims.height }
          : { inputImage: seed.filename, inputImageWidth: dims.width, inputImageHeight: dims.height }),
      },
      videoSeed: seed,
    }
  }
  return {
    workflowId: ltx23Workflow.id,
    params: {
      mode: 'i2v',
      inputImage: seed.filename,
      inputImageWidth: dims.width,
      inputImageHeight: dims.height,
    },
    videoSeed: seed,
  }
}

/**
 * "Send to Generate Videos" — hands any picture on screen to the video form as
 * a locked image-to-video source: re-uploads it into ComfyUI's input dir, seeds
 * the form through the prefill store (the same path the Director uses for its
 * beat frames), then navigates to the tab.
 *
 * `source` is either a same-origin URL (gallery / result / ComfyUI view route)
 * or ready-made bytes, so an unsaved photo-editor canvas can be sent as-is.
 * Shared by every inspector so the behaviour can't drift between them.
 */
export function useSendToVideo() {
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const sendToVideo = useCallback(
    async (source: string | Blob, filename = 'video-source.png', target: SendToVideoTarget = 'source') => {
      setBusy(true)
      try {
        let blob: Blob
        if (typeof source === 'string') {
          const res = await fetch(source)
          if (!res.ok) throw new Error(`Could not load image (${res.status})`)
          blob = await res.blob()
        } else {
          blob = source
        }
        const name = await uploadImageBlob(blob, filename)
        // One decode gives both the vision-pass thumbnail and the source's real
        // pixel size, which drives the clip's aspect ratio.
        const { b64, width, height } = await downscaleToB64AndDims(blob)
        setPrefill(
          videoPrefill(
            target,
            {
              filename: name,
              b64,
              // ponytail: object URLs for blob sources are left to document unload —
              // one small URL per click, and the form outlives any revoke we'd do here.
              previewUrl: typeof source === 'string' ? source : URL.createObjectURL(blob),
            },
            { width, height },
          ),
        )
        router.push('/generate-videos')
        toast.success(`Opening as ${SEND_TARGET_LABEL[target]} in Generate Videos`)
      } catch (e) {
        toast.error(`Could not send to Generate Videos: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(false)
      }
    },
    [router, setPrefill],
  )

  return { sendToVideo, busy }
}
