'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, Move3d } from 'lucide-react'
import { toast } from 'sonner'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { uploadImageBlob } from '@/lib/generation/upload'
import { useImagePicker } from './PickImageDialog'
import { SwitchTile, TileBody } from './SwitchTile'
import type { GenerationParams } from '@/types/workflow'

type ControlNet = NonNullable<GenerationParams['controlNet']>
type Mode = ControlNet['mode']

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'pose', label: 'Pose', hint: 'Copy the pose of a person' },
  { id: 'depth', label: 'Depth', hint: 'Copy the 3D layout/composition' },
  { id: 'canny', label: 'Canny', hint: 'Copy hard edges/outlines' },
  { id: 'scribble', label: 'Scribble', hint: 'Turn a sketch into a render' },
]

interface Props {
  value?: ControlNet
  /** ComfyUI has the ControlNet preprocessor nodes installed; null while still checking. */
  available: boolean | null
  /** Shown under the toggle when unavailable — names the actual missing piece. */
  unavailableHint?: string
  onChange: (v: ControlNet | undefined) => void
}

/**
 * ControlNet reference control: toggle → mode tabs + reference upload + strength.
 * The uploaded photo is auto-preprocessed in-graph for the chosen mode. Disabled
 * with a hint when the ControlNet Aux nodes are missing.
 */
export default function ControlNetInput({ value, available, unavailableHint, onChange }: Props) {
  const enabled = !!value
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { isDragging, dragProps } = useFileDrop((file) => void handleFile(file))
  const { openPicker, pickerDialog } = useImagePicker(inputRef, (file) => void handleFile(file))

  // Revoke the local preview URL if the parent clears the value externally
  // (e.g. a form reset), since toggle() only fires on user-driven toggle-off.
  useEffect(() => {
    if (!value && previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
      setPreview(null)
    }
  }, [value])

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const name = await uploadImageBlob(file, 'controlnet.png')
      const url = URL.createObjectURL(file)
      previewRef.current = url
      setPreview(url)
      onChange({ mode: value?.mode ?? 'pose', image: name, strength: value?.strength ?? 0.8 })
    } catch (e) {
      toast.error(`ControlNet upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  function toggle() {
    if (enabled) {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
      setPreview(null)
      onChange(undefined)
    } else {
      // Toggle on without an image yet — image stays empty until uploaded.
      onChange({ mode: 'pose', image: '', strength: 0.8 })
    }
  }

  return (
    <div className="contents">
      <SwitchTile
        label="ControlNet"
        icon={Move3d}
        on={enabled}
        onToggle={toggle}
        disabled={!available}
        hint="Copy pose / depth / edges from a reference"
        note={available === false ? (unavailableHint ?? 'Requires ComfyUI ControlNet Aux') : undefined}
      />

      {enabled && (
        <TileBody title="ControlNet">
          <div className="grid grid-cols-4 gap-1.5">
            {MODES.map((m) => {
              const active = value?.mode === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => value && onChange({ ...value, mode: m.id })}
                  title={m.hint}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${active ? 'border-primary/40 bg-primary/10' : 'border-border bg-background hover:bg-muted/50'}`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>

          <div {...dragProps} className={`flex items-center gap-3 rounded-lg border bg-background p-2 transition-colors ${isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
            {value?.image && preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
              <img src={preview} alt="ControlNet reference" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
                <Move3d className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
              {pickerDialog}
              <button type="button" onClick={openPicker} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {value?.image ? 'Replace' : 'Upload reference'}
              </button>
              {!value?.image && !uploading && <p className="mt-1 text-xs text-muted-foreground">Drag &amp; drop supported.</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Strength</span>
              <span className="font-mono tabular-nums text-muted-foreground">{(value?.strength ?? 0.8).toFixed(2)}</span>
            </div>
            <input type="range" min={0.1} max={1} step={0.05} value={value?.strength ?? 0.8} onChange={(e) => value && onChange({ ...value, strength: Number(e.target.value) })} className="w-full accent-primary" aria-label="ControlNet strength" />
          </div>
        </TileBody>
      )}
    </div>
  )
}
