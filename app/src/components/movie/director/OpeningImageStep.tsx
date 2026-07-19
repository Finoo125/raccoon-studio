'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import DirectorGenerationStage from './DirectorGenerationStage'
import { buildOpeningImageParams } from '@/lib/director/opening-image'
import { applyOpeningImage } from '@/lib/director/run-doc'
import { getWorkflow } from '@/lib/workflows'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import type { DirectorRun } from '@/types/director'

export default function OpeningImageStep({
  run, onUpdated,
}: {
  run: DirectorRun
  onUpdated: (run: DirectorRun) => void
}) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { isDragging, dragProps } = useFileDrop((file) => void uploadOwn(file))

  // Copy an image (a chosen output URL or a user-picked file) into ComfyUI's
  // input dir under a per-run filename, then persist it onto the run.
  const captureToInput = async (file: File) => {
    const form = new FormData()
    form.append('image', file)
    form.append('overwrite', 'true')
    form.append('type', 'input')
    const up = await fetch('/api/comfyui/upload/image', { method: 'POST', body: form })
    if (!up.ok) throw new Error(await up.text())
    const data = (await up.json()) as { name: string; subfolder?: string }
    const sub = data.subfolder ?? ''
    const inputFilename = sub ? `${sub}/${data.name}` : data.name
    const url = `/api/comfyui/view?filename=${encodeURIComponent(data.name)}&subfolder=${encodeURIComponent(sub)}&type=input`
    const updated = applyOpeningImage(run, { inputFilename, url })
    const put = await fetch(`/api/director/${run.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: updated }),
    })
    const saved = (await put.json()) as { run?: DirectorRun; error?: string }
    if (!put.ok || !saved.run) throw new Error(saved.error ?? 'Save failed')
    onUpdated(saved.run)
  }

  const selectFromUrl = async (url: string) => {
    try {
      const blob = await (await fetch(url)).blob()
      const file = new File([blob], `director-${run.id}.png`, { type: blob.type || 'image/png' })
      await captureToInput(file)
      toast.success('Opening image set')
    } catch (e) {
      toast.error(`Failed to use image: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function uploadOwn(file: File) {
    setBusy(true)
    try {
      await captureToInput(file)
      toast.success('Opening image set')
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const params = buildOpeningImageParams(run)
  const wf = getWorkflow(run.imageModel)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 shrink-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="font-heading text-sm font-semibold">Opening image</p>
          <p className="truncate text-xs text-muted-foreground">
            the first frame of clip 1 — hit <span className="font-medium text-foreground">Use this</span> on a candidate, or upload your own
          </p>
        </div>
        {run.openingImage && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-primary shrink-0">
            <CheckCircle2 className="h-4 w-4" /> Opening image locked in
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 shrink-0">
        <p className="line-clamp-2 text-xs text-muted-foreground">{run.openingImagePrompt}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <DirectorGenerationStage
          kind="image"
          label="opening image"
          prefill={{ workflowId: wf?.id ?? run.imageModel, params }}
          onSelect={selectFromUrl}
        />
      </div>

      <div
        {...dragProps}
        className={`flex flex-wrap items-center gap-2 rounded-xl p-2 shrink-0 transition-colors ${
          isDragging ? 'ring-2 ring-primary/30 bg-primary/5' : ''
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadOwn(f) }}
        />
        <Button size="lg" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Upload data-icon="inline-start" />}
          Upload your own
        </Button>
        <p className="text-xs text-muted-foreground">— drag &amp; drop supported.</p>

        {run.openingImage && (
          <Button
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const updated: DirectorRun = { ...run, status: 'rendering' }
                const res = await fetch(`/api/director/${run.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ run: updated }),
                })
                const saved = (await res.json()) as { run?: DirectorRun; error?: string }
                if (!res.ok || !saved.run) throw new Error(saved.error ?? 'Failed to start render')
                onUpdated(saved.run)
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to start render')
              } finally {
                setBusy(false)
              }
            }}
          >
            Start render
          </Button>
        )}
      </div>
    </div>
  )
}
