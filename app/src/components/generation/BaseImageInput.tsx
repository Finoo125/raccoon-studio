'use client'

import { useRef, type RefObject } from 'react'
import Link from 'next/link'
import { Upload, Loader2, X, ImagePlus, FolderOpen, History, Layers } from 'lucide-react'
import MaskBrush, { type MaskBrushHandle } from './MaskBrush'
import type { GenerationParams } from '@/types/workflow'

type EditMode = NonNullable<GenerationParams['editMode']>

const MODES: { id: EditMode; label: string; hint: string }[] = [
  { id: 'img2img', label: 'img2img', hint: 'Reimagine the whole image at a chosen strength' },
  { id: 'inpaint', label: 'Inpaint', hint: 'Repaint only the area you brush' },
  { id: 'outpaint', label: 'Outpaint', hint: 'Extend the canvas outwards' },
]

interface Props {
  params: GenerationParams
  set: (key: keyof GenerationParams, value: unknown) => void
  /** Preview URL for the current base (object URL for uploads, route URL otherwise). */
  preview: string | null
  /** An upload/fetch is in flight. */
  busy: boolean
  /** Newest finished result, offered as "use last result"; null when none yet. */
  lastResultUrl: string | null
  /** Exposes the mask canvas so the form can upload it at generate time. */
  brushRef: RefObject<MaskBrushHandle | null>
  onUploadFile: (file: File) => void
  onUseLastResult: () => void
  onRemove: () => void
}

/**
 * Base-image control for img2img / inpaint / outpaint. When empty it offers
 * Upload / From gallery / Use last result; once a base is set it shows the
 * thumbnail, the mode tabs, and the per-mode controls (strength slider, mask
 * brush, or outpaint pads). Filenames/params are owned by the form; this
 * component only drives the UI and the embedded {@link MaskBrush}.
 */
export default function BaseImageInput({
  params, set, preview, busy, lastResultUrl, brushRef, onUploadFile, onUseLastResult, onRemove,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const mode: EditMode = params.editMode ?? 'img2img'
  const hasBase = !!params.baseImage

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onUploadFile(f)
        if (fileRef.current) fileRef.current.value = ''
      }}
    />
  )

  if (!hasBase) {
    return (
      <div className="space-y-2">
        {fileInput}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
            <ImagePlus className="h-4 w-4 text-primary" /> Start from an image
            <span className="text-xs font-normal text-muted-foreground">img2img · inpaint · outpaint</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background px-2 py-3 text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </button>
            <Link
              href="/gallery"
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background px-2 py-3 text-xs font-medium hover:bg-muted/50"
            >
              <FolderOpen className="h-4 w-4" /> From gallery
            </Link>
            <button
              type="button"
              onClick={onUseLastResult}
              disabled={busy || !lastResultUrl}
              title={lastResultUrl ? 'Use the most recent generated image' : 'Generate an image first'}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background px-2 py-3 text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
            >
              <History className="h-4 w-4" /> Last result
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
      {fileInput}
      {/* Header: thumbnail + replace/remove */}
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local/proxied preview, not a remote asset
          <img src={preview} alt="Base" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
            <Layers className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="h-4 w-4 text-primary" /> Base image</p>
          <div className="mt-1 flex items-center gap-3 text-xs">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="text-primary hover:underline disabled:opacity-60">
              {busy ? 'Working…' : 'Replace'}
            </button>
            <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="grid grid-cols-3 gap-1.5">
        {MODES.map((m) => {
          const active = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => set('editMode', m.id)}
              title={m.hint}
              className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors ${
                active ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/50'
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)!.hint}</p>

      {/* Per-mode controls */}
      {mode !== 'outpaint' && (
        <StrengthSlider value={params.denoise ?? 0.65} onChange={(v) => set('denoise', v)} />
      )}

      {mode === 'inpaint' && preview && (
        <MaskBrush ref={brushRef} src={preview} />
      )}

      {mode === 'outpaint' && (
        <OutpaintPads
          value={params.outpaint ?? { left: 0, top: 0, right: 0, bottom: 256, feather: 40 }}
          onChange={(v) => set('outpaint', v)}
        />
      )}
    </div>
  )
}

function StrengthSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Strength</span>
        <span className="font-mono tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0.2}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label="Denoise strength"
      />
      <p className="text-xs text-muted-foreground">Lower keeps the original; higher changes more.</p>
    </div>
  )
}

type Outpaint = NonNullable<GenerationParams['outpaint']>

function OutpaintPads({ value, onChange }: { value: Outpaint; onChange: (v: Outpaint) => void }) {
  const upd = (key: keyof Outpaint, n: number) => onChange({ ...value, [key]: Math.max(0, n) })
  const pad = (k: keyof Outpaint, label: string) => (
    <label key={k} className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        step={64}
        value={value[k]}
        onChange={(e) => upd(k, Number(e.target.value))}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  )
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {pad('left', 'Left')}
        {pad('top', 'Top')}
        {pad('right', 'Right')}
        {pad('bottom', 'Bottom')}
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Feather: {value.feather}px</span>
        <input
          type="range"
          min={0}
          max={128}
          step={4}
          value={value.feather}
          onChange={(e) => upd('feather', Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Outpaint feather"
        />
      </label>
      <p className="text-xs text-muted-foreground">Pixels added per side; feather softens the seam.</p>
    </div>
  )
}
