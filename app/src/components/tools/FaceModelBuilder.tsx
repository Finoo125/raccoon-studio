'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2, X, Boxes, ScanFace, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useQueueStore } from '@/lib/comfyui/queue'
import { submitPrompt } from '@/lib/comfyui/submit'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { uploadImageBlob } from '@/lib/generation/upload'
import { buildFaceModelPrompt } from '@/lib/workflows/build-face-model'

interface Pic {
  /** Stable client key for the list. */
  id: string
  file: File
  /** Local object URL for the thumbnail (revoked on remove). */
  preview: string
}

// ReActor saves models under models/reactor/faces/<name>.safetensors; keep the
// name to characters that are safe in a filename across platforms.
function sanitizeName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')
}

/**
 * Tools-tab panel: build a reusable ReActor face model from one or more
 * reference photos. Uploads each photo to ComfyUI, submits a build-and-save
 * graph, and polls /history until ComfyUI reports the model written.
 */
export default function FaceModelBuilder() {
  const clientId = useQueueStore((s) => s.clientId)
  const [name, setName] = useState('')
  const [pics, setPics] = useState<Pic[]>([])
  const [building, setBuilding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { isDragging, dragProps } = useFileDrop((file) => addFiles([file]))

  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setPics((prev) => [
      ...prev,
      ...images.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ])
  }

  function removePic(id: string) {
    setPics((prev) => {
      const hit = prev.find((p) => p.id === id)
      if (hit) URL.revokeObjectURL(hit.preview)
      return prev.filter((p) => p.id !== id)
    })
  }

  function reset() {
    pics.forEach((p) => URL.revokeObjectURL(p.preview))
    setPics([])
    setName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function build() {
    const clean = sanitizeName(name)
    if (!clean) {
      toast.error('Give the face model a name')
      return
    }
    if (pics.length === 0) {
      toast.error('Add at least one reference photo')
      return
    }
    setBuilding(true)
    try {
      // 1. Upload every reference photo into ComfyUI's input dir.
      const filenames: string[] = []
      for (const p of pics) {
        filenames.push(await uploadImageBlob(p.file, p.file.name || 'face.png'))
      }

      // 2. Submit the build-and-save graph.
      const prompt = buildFaceModelPrompt({ faceFilenames: filenames, modelName: clean })
      const prompt_id = await submitPrompt({ prompt, client_id: clientId })

      // 3. Poll /history until ComfyUI records the run (success or error).
      await waitForCompletion(prompt_id)

      toast.success(`Face model "${clean}" created — pick it under Face swap in Generate.`)
      reset()
    } catch (e) {
      toast.error(`Build failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
          <ScanFace className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight leading-none">Create face model</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Blend one or more photos of a person into a reusable face model for face swap
          </p>
        </div>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-semibold">Model name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alice"
          disabled={building}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>

      {/* Drop zone */}
      <div
        {...dragProps}
        className={`rounded-xl border border-dashed p-4 transition-colors ${
          isDragging ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border bg-muted/20'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />

        {pics.length > 0 && (
          <div className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {pics.map((p) => (
              <div key={p.id} className="group relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object-URL preview */}
                <img src={p.preview} alt="Reference face" className="h-full w-full rounded-lg object-cover ring-1 ring-border" />
                <button
                  type="button"
                  onClick={() => removePic(p.id)}
                  disabled={building}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground disabled:opacity-60"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={building}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          <Upload className="h-4 w-4" /> Add photos
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Use clear, front-facing photos of the same person. More angles → a more robust model. Drag &amp; drop supported.
        </p>
      </div>

      {/* Build */}
      <button
        type="button"
        onClick={() => void build()}
        disabled={building || pics.length === 0 || !name.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ffa64d] to-[#f5811e] px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-shadow hover:shadow-primary/40 disabled:opacity-50 disabled:shadow-none"
      >
        {building ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Building…</>
        ) : (
          <><Boxes className="h-4 w-4" /> Build face model</>
        )}
      </button>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        Built models appear under <span className="font-medium text-foreground">Face swap → Face model</span> on the Generate Image tab.
      </p>
    </div>
  )
}

/**
 * Polls /history/<id> until ComfyUI records the prompt as completed. Resolves on
 * success, throws on an error status or timeout. The build is quick (no
 * diffusion), so a short poll budget is plenty.
 */
async function waitForCompletion(promptId: string, timeoutMs = 120_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000))
    let entry: { status?: { completed: boolean; status_str: string } } | undefined
    try {
      const res = await fetch(`/api/comfyui/history/${promptId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as Record<string, { status?: { completed: boolean; status_str: string } }>
        entry = data[promptId]
      }
    } catch {
      /* transient — keep polling */
    }
    if (!entry?.status) continue
    if (entry.status.status_str === 'error') throw new Error('ComfyUI reported an error building the model')
    if (entry.status.completed) return
  }
  throw new Error('Timed out waiting for the face model to build')
}
