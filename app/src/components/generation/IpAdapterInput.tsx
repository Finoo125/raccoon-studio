'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { uploadImageBlob } from '@/lib/generation/upload'
import type { GenerationParams } from '@/types/workflow'

type IpAdapter = NonNullable<GenerationParams['ipAdapter']>

interface Props {
  value?: IpAdapter
  /** ComfyUI has the IP-Adapter Plus nodes installed. */
  available: boolean
  onChange: (v: IpAdapter | undefined) => void
}

/**
 * IP-Adapter reference control: toggle → reference upload + weight. Transfers the
 * style/subject of the reference image. Disabled with a hint when the IP-Adapter
 * Plus nodes are missing.
 */
export default function IpAdapterInput({ value, available, onChange }: Props) {
  const enabled = !!value
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { isDragging, dragProps } = useFileDrop((file) => void handleFile(file))

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
      const name = await uploadImageBlob(file, 'ipadapter.png')
      const url = URL.createObjectURL(file)
      previewRef.current = url
      setPreview(url)
      onChange({ image: name, weight: value?.weight ?? 0.7 })
    } catch (e) {
      toast.error(`IP-Adapter upload failed: ${e instanceof Error ? e.message : String(e)}`)
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
      onChange({ image: '', weight: 0.7 })
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!available}
        onClick={toggle}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
          !available ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
            : enabled ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
        }`}
      >
        <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-input'}`}>
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform mt-0.5 ${enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
        </span>
        <span className="min-w-0 flex items-center gap-2">
          <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold">IP-Adapter reference</span>
            <span className="block text-xs text-muted-foreground">
              {available ? 'Match the style/subject of a reference image' : 'Requires ComfyUI IP-Adapter Plus'}
            </span>
          </span>
        </span>
      </button>

      {enabled && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <div {...dragProps} className={`flex items-center gap-3 rounded-lg border bg-background p-2 transition-colors ${isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
            {value?.image && preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
              <img src={preview} alt="IP-Adapter reference" className="h-14 w-14 rounded-lg object-cover ring-1 ring-border" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {value?.image ? 'Replace' : 'Upload reference'}
              </button>
              {!value?.image && !uploading && <p className="mt-1 text-xs text-muted-foreground">Drag &amp; drop supported.</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Weight</span>
              <span className="font-mono tabular-nums text-muted-foreground">{(value?.weight ?? 0.7).toFixed(2)}</span>
            </div>
            <input type="range" min={0.1} max={1} step={0.05} value={value?.weight ?? 0.7} onChange={(e) => value && onChange({ ...value, weight: Number(e.target.value) })} className="w-full accent-primary" aria-label="IP-Adapter weight" />
          </div>
        </div>
      )}
    </div>
  )
}
