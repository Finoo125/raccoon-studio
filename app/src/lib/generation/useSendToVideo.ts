'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStudioStore } from './studio-store'
import { uploadImageBlob } from './upload'
import { downscaleToB64AndDims } from './image-b64'
import { ltx23Workflow } from '@/lib/workflows/ltx23'

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
    async (source: string | Blob, filename = 'video-source.png') => {
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
        setPrefill({
          workflowId: ltx23Workflow.id,
          params: { mode: 'i2v', inputImage: name, inputImageWidth: width, inputImageHeight: height },
          videoSeed: {
            filename: name,
            b64,
            // ponytail: object URLs for blob sources are left to document unload —
            // one small URL per click, and the form outlives any revoke we'd do here.
            previewUrl: typeof source === 'string' ? source : URL.createObjectURL(blob),
          },
        })
        router.push('/generate-videos')
        toast.success('Opening as source image in Generate Videos')
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
