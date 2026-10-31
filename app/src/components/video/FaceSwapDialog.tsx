'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ScanFace, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listFaceModels } from '@/lib/generation/face-models'
import { uploadImageBlob } from '@/lib/generation/upload'
import {
  useVideoFaceSwap, type DetectedFace, type SwapCapabilities,
} from '@/lib/generation/useVideoFaceSwap'
import {
  MAX_SWAP_CHARACTERS, type SwapCharacter, type VideoSource,
} from '@/lib/workflows/video-face-swap'
import { H3_RIFE_FPS, H3_UPSCALE_SCALE, type VideoPostParams } from '@/lib/workflows/minimax-h3'

/** A detected face plus what the user chose to replace it with. */
interface Assignment extends DetectedFace {
  /** A saved face model filename, an uploaded photo filename, or `SKIP`. */
  replacement: string
  /** Which of the two `replacement` is, so the builder wires the right input. */
  kind: 'model' | 'photo'
}

// Sentinels, not empty strings: Radix's Select throws on `value=""` because it
// reserves that for "nothing selected", and a face nobody assigned IS a
// selection — "leave this one alone".
const SKIP = '__skip__'
const UPLOAD = '__upload__'

/** The held-back passes, spelled the way the form spells them. */
function postLabels(post: VideoPostParams): string[] {
  return [
    post.rife === true ? `${H3_RIFE_FPS} fps` : null,
    post.upscale === true ? `${H3_UPSCALE_SCALE}× upscale` : null,
    post.sharpen === true ? 'sharpen' : null,
    // Same opt-out default the render uses, so the list names what will really
    // run rather than only what was ticked.
    post.filmGrain !== false ? 'film grain' : null,
  ].filter((l): l is string => l !== null)
}

export default function FaceSwapDialog({
  open, onOpenChange, clip, clipUrl, clipKey, post = null,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** The clip to swap, as LoadVideo needs to be told about it. */
  clip: VideoSource | null
  /** Playable URL for the scrubber. */
  clipUrl: string
  /** Stable per-clip stem for the crop files, so a re-detect overwrites. */
  clipKey: string
  /**
   * Finishing passes this clip's render held back, from `pendingPost`.
   *
   * Not editable here on purpose: they were already chosen in the form, and a
   * second set of the same four switches is two places to disagree. This dialog
   * only says what is about to happen.
   */
  post?: VideoPostParams | null
}) {
  const { busy, probe, detectFaces, swapFaces } = useVideoFaceSwap()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [caps, setCaps] = useState<SwapCapabilities | null>(null)
  const [faceModels, setFaceModels] = useState<string[]>([])
  const [found, setFound] = useState<Assignment[]>([])
  const [swapModel, setSwapModel] = useState('')
  const [boost, setBoost] = useState<'512x512' | '768x768' | '1024x1024'>('512x512')
  const [occlusion, setOcclusion] = useState(true)
  const [smoothing, setSmoothing] = useState(true)
  /** Which row an "Upload a photo…" pick is filling, so the input can be shared. */
  const [uploadingFor, setUploadingFor] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [c, models] = await Promise.all([probe(), listFaceModels()])
      setCaps(c)
      setFaceModels(models ?? [])
      setSwapModel(c.swapModels[0] ?? '')
    })()
  }, [open, probe])

  /**
   * Clear the picked faces on close rather than on open.
   *
   * Same result, and it keeps the effect above a pure fetch: resetting state
   * synchronously inside an effect body costs a cascading render, which React
   * Compiler (on in this app) rightly flags. Closing is also the honest moment —
   * the crops belong to the clip that was open, and every exit route (the
   * button, Escape, the overlay) comes through here.
   */
  const setOpen = (v: boolean) => {
    if (!v) {
      setFound([])
      setUploadingFor(null)
    }
    onOpenChange(v)
  }

  const find = useCallback(async () => {
    const el = videoRef.current
    if (!clip || !el) return
    const position = el.duration > 0 ? el.currentTime / el.duration : 0
    try {
      const faces = await detectFaces(clip, position, clipKey)
      setFound((prev) => {
        // Append rather than replace, and keep what is already assigned: a clip
        // where two characters never share a frame is done in two passes, and
        // re-detecting must not throw away the first pass's choices.
        const room = MAX_SWAP_CHARACTERS - prev.length
        const fresh = faces
          .filter((f) => !prev.some((p) => p.filename === f.filename))
          .slice(0, Math.max(room, 0))
        if (fresh.length === 0) {
          toast(prev.length ? 'No new faces in this frame' : 'No faces found in this frame')
        }
        return [...prev, ...fresh.map((f) => ({ ...f, replacement: SKIP, kind: 'model' as const }))]
      })
    } catch (e) {
      toast.error(`Face detection failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [clip, clipKey, detectFaces])

  const assign = (index: number, value: string) => {
    if (value === UPLOAD) {
      setUploadingFor(index)
      fileRef.current?.click()
      return
    }
    setFound((prev) => prev.map((f, i) => (i === index ? { ...f, replacement: value, kind: 'model' } : f)))
  }

  const onPhoto = async (file: File | undefined) => {
    const index = uploadingFor
    setUploadingFor(null)
    if (!file || index === null) return
    try {
      const name = await uploadImageBlob(file, file.name)
      setFound((prev) => prev.map((f, i) => (i === index ? { ...f, replacement: name, kind: 'photo' } : f)))
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const run = async () => {
    if (!clip) return
    const characters: SwapCharacter[] = found
      .filter((f) => f.replacement !== SKIP)
      .map((f) => ({
        reference: f.filename,
        ...(f.kind === 'model' ? { faceModel: f.replacement } : { sourceImage: f.replacement }),
      }))
    try {
      await swapFaces(clip, characters, {
        post: post ?? undefined,
        swapModel: swapModel || undefined,
        pixelBoost: boost,
        smooth: smoothing ? 0.4 : 0,
        // Only ever names a model the probe actually found installed.
        occluder: occlusion ? caps?.occluders[0] : undefined,
      })
      toast.success('Queued — swapping faces')
      setOpen(false)
    } catch (e) {
      toast.error(`Face swap failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const assigned = found.filter((f) => f.replacement !== SKIP).length
  const hasOccluder = (caps?.occluders.length ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Swap faces</DialogTitle>
          <DialogDescription>
            Scrub to a frame where the faces are visible, find them, then pick who replaces who.
            {post && (
              <>
                {' '}This clip isn&apos;t finished yet &mdash; {postLabels(post).join(', ')} run
                after the swap. Where a face is turned away or something is in front of it, the
                original face stays.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {caps && !caps.available ? (
          <p className="text-sm text-muted-foreground">
            The face-swap node isn&apos;t loaded. Check ComfyUI&apos;s startup log for a
            RaccoonSwapNodes import error, then restart it.
          </p>
        ) : (
          <div className="space-y-4">
            <video
              ref={videoRef}
              src={clipUrl}
              controls
              // Open on the middle of the clip, not frame 0. The first frame is
              // the worst possible default: a clip routinely opens on an empty
              // room or a fade-in, so "Find faces" on an untouched dialog
              // reported "no faces found" on a clip full of them (found in a
              // browser, 2026-09-07). The node's own `position` default is 0.5
              // for the same reason.
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                if (Number.isFinite(el.duration)) el.currentTime = el.duration / 2
              }}
              className="max-h-64 w-full rounded-md bg-black object-contain"
            />

            <Button variant="secondary" onClick={() => void find()} disabled={busy || !clip}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ScanFace className="mr-2 size-4" />}
              Find faces in frame
            </Button>

            {found.length > 0 && (
              <div className="space-y-2">
                {found.map((face, i) => (
                  <div key={face.filename} className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={face.url}
                      alt={`Face ${i + 1}`}
                      className="size-16 shrink-0 rounded-md object-cover"
                    />
                    <span className="text-sm text-muted-foreground">replace with</span>
                    <Select value={face.replacement} onValueChange={(v) => { if (v !== null) assign(i, v) }}>
                      <SelectTrigger className="h-9 flex-1">
                        <SelectValue placeholder="Don't swap" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>Don&apos;t swap</SelectItem>
                        {face.kind === 'photo' && face.replacement !== SKIP && (
                          <SelectItem value={face.replacement}>{face.replacement}</SelectItem>
                        )}
                        {/* Full filename, not a prettified stem: this Select's
                            trigger shows the raw value, so stripping the
                            extension here made the list and the closed control
                            disagree about the same choice. */}
                        {faceModels.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                        <SelectItem value={UPLOAD}>
                          <Upload className="mr-2 inline size-3.5" />Upload a photo…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {found.length >= MAX_SWAP_CHARACTERS && (
                  <p className="text-xs text-muted-foreground">
                    {MAX_SWAP_CHARACTERS} faces is the limit for one pass.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Swap model</Label>
                <Select value={swapModel} onValueChange={(v) => { if (v !== null) setSwapModel(v) }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {caps?.swapModels.map((m) => (
                      <SelectItem key={m} value={m}>{m.replace(/\.onnx$/, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Detail</Label>
                <Select value={boost} onValueChange={(v) => { if (v !== null) setBoost(v as typeof boost) }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="512x512">512 — fastest</SelectItem>
                    <SelectItem value="768x768">768</SelectItem>
                    <SelectItem value="1024x1024">1024 — slowest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={occlusion && hasOccluder}
                  disabled={!hasOccluder}
                  onChange={(e) => setOcclusion(e.target.checked)}
                />
                Handle objects in front of faces
                {!hasOccluder && (
                  <span className="text-xs text-muted-foreground">
                    — needs the occlusion model from the Models page
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} />
                Smooth jitter
              </label>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onPhoto(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void run()} disabled={busy || assigned === 0}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Swap {assigned > 1 ? `${assigned} faces` : 'face'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
