'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, X, ScanFace, Boxes, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useFileDrop } from '@/lib/generation/useFileDrop'
import { useImagePicker } from './PickImageDialog'
import { InfoTip, SwitchTile, TileBody } from './SwitchTile'
import { listFaceModels } from '@/lib/generation/face-models'
import { selectionIsStale } from '@/lib/models/installed'
import { PIXEL_BOOST_ONLY, IDENTITY_NEUTRAL } from '@/lib/workflows/face-swap'

type SwapModel = 'inswapper_128.onnx' | 'hyperswap_1a_256.onnx' | 'hyperswap_1b_256.onnx' | 'hyperswap_1c_256.onnx' | 'alphaface_256.onnx'
type PixelBoostSize = '512x512' | '768x768' | '1024x1024'
type Source = 'upload' | 'model'

const BOOST_SIZES: PixelBoostSize[] = ['512x512', '768x768', '1024x1024']

interface Props {
  /**
   * Whether ComfyUI actually reports the ReActor swap node. False disables the
   * toggle outright: without the pack the prompt fails validation and the user
   * only sees a bare "Generation failed". Null while still checking.
   */
  available: boolean | null
  /**
   * Whether the vendored pixel-boost node is loaded. Tracked apart from
   * `available` because it ships in a different pack — ours — so it can be the
   * only missing piece while the plain ReActor swap still works.
   */
  pixelBoostAvailable: boolean
  enabled: boolean
  /** Whether the source face is an uploaded photo or a saved face model. */
  source: Source
  /** Uploaded source-face filename on the ComfyUI server, if any. */
  value?: string
  /** Selected saved face-model filename, if any. */
  faceModel?: string
  /** Selected ReActor swap model; defaults to inswapper. */
  model?: SwapModel
  /** Swap via the pixel-boost node (512-1024px effective resolution); default off. */
  pixelBoost?: boolean
  /** Pixel-boost effective resolution; defaults to 512x512. */
  pixelBoostSize?: PixelBoostSize
  /** Identity strength 0..1; 0.5 is neutral. Pixel-boost path only. */
  identity?: number
  onToggle: (enabled: boolean) => void
  onSourceChange: (source: Source) => void
  onChange: (filename: string | undefined) => void
  onFaceModelChange: (name: string | undefined) => void
  onModelChange: (model: SwapModel) => void
  onPixelBoostChange: (enabled: boolean) => void
  onPixelBoostSizeChange: (size: PixelBoostSize) => void
  onIdentityChange: (identity: number) => void
}

const SWAP_MODELS: { id: SwapModel; label: string; hint: string }[] = [
  { id: 'inswapper_128.onnx', label: 'Inswapper', hint: 'Classic 128px (default)' },
  { id: 'hyperswap_1a_256.onnx', label: 'Hyperswap 1A', hint: '256px, more detail' },
  { id: 'hyperswap_1b_256.onnx', label: 'Hyperswap 1B', hint: '256px, balanced' },
  { id: 'hyperswap_1c_256.onnx', label: 'Hyperswap 1C', hint: '256px, best likeness' },
  { id: 'alphaface_256.onnx', label: 'AlphaFace', hint: '256px, best on angled faces' },
]

/**
 * ReActor face-swap control: a toggle that reveals a source picker. The face can
 * come from an uploaded photo (uploaded to ComfyUI's input folder via the proxy)
 * or a saved face model built in the Tools tab. The chosen reference is stored so
 * the workflow can wire either a `LoadImage` or a `ReActorLoadFaceModel` node.
 */
export default function FaceSwapInput({
  available, pixelBoostAvailable, enabled, source, value, faceModel, model, pixelBoost, pixelBoostSize, identity,
  onToggle, onSourceChange, onChange, onFaceModelChange, onModelChange, onPixelBoostChange, onPixelBoostSizeChange,
  onIdentityChange,
}: Props) {
  const activeModel: SwapModel = model ?? 'inswapper_128.onnx'
  // A stale `enabled` (restored from a previous session, or from a gallery
  // deep-link) must not render as on once the pack has gone missing — the
  // submitted params drop it either way, so the switch has to agree.
  const active = available === true && enabled
  // Some swap models only run through the vendored node, so they turn the boost
  // path on whether or not the checkbox is ticked — and must be unselectable
  // when that pack is missing, or picking one 400s the job.
  const modelForcesBoost = PIXEL_BOOST_ONLY.has(activeModel)
  const boostOn = pixelBoostAvailable && ((pixelBoost ?? false) || modelForcesBoost)
  const identityValue = identity ?? IDENTITY_NEUTRAL
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { isDragging, dragProps } = useFileDrop((file) => void handleFile(file))
  const { openPicker, pickerDialog } = useImagePicker(inputRef, (file) => void handleFile(file))

  // Saved face models, loaded when the model source is shown (and refreshable).
  const [faceModels, setFaceModels] = useState<string[]>([])
  const [faceModelsLoaded, setFaceModelsLoaded] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const refreshModels = async () => {
    setLoadingModels(true)
    try {
      const list = await listFaceModels()
      if (list) {
        setFaceModels(list)
        setFaceModelsLoaded(true)
      }
    } finally {
      setLoadingModels(false)
    }
  }
  useEffect(() => {
    if (!enabled || source !== 'model') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy load when the model source is shown
    void refreshModels()
  }, [enabled, source])

  // A saved face model is remembered by name, so it outlives the file — a
  // reinstall re-creates `models/reactor/faces/` empty while localStorage keeps
  // the name. ComfyUI then rejects the whole prompt, and the chips below only
  // render when the list is non-empty, so there would be nothing left to click.
  // Clearing degrades to "no face model": every builder skips the swap when this
  // is falsy rather than failing the job.
  useEffect(() => {
    if (selectionIsStale(faceModel, faceModels, faceModelsLoaded)) onFaceModelChange('')
  }, [faceModel, faceModels, faceModelsLoaded, onFaceModelChange])

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('image', file)
      form.append('overwrite', 'true')
      form.append('type', 'input')
      const res = await fetch('/api/comfyui/upload/image', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { name: string; subfolder?: string }
      const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name
      setPreview(URL.createObjectURL(file))
      onChange(name)
    } catch (e) {
      toast.error(`Face upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    onChange(undefined)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="contents">
      <SwitchTile
        label="Face swap"
        icon={ScanFace}
        on={active}
        onToggle={() => available && onToggle(!enabled)}
        disabled={!available}
        hint="Swap the generated face onto a reference photo or face model"
        note={available === false ? 'Requires the ReActor node — check the ComfyUI log for an import error' : undefined}
      />

      {active && (
        <TileBody title="Face swap">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Face swap is meant for keeping <strong>your own original characters</strong> consistent across
            generations. Do not use it on real people — no likenesses of real persons, no impersonation,
            and never without consent.
          </span>
        </div>

        {/* Source switch — uploaded photo vs. saved face model */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/20 p-1">
          {([
            { id: 'upload' as const, label: 'Upload photo', icon: Upload },
            { id: 'model' as const, label: 'Face model', icon: Boxes },
          ]).map((opt) => {
            const selected = source === opt.id
            const Icon = opt.icon
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSourceChange(opt.id)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  selected ? 'bg-primary/15 text-foreground ring-1 ring-primary/30' : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {opt.label}
              </button>
            )
          })}
        </div>

        {source === 'upload' ? (
        <div
          {...dragProps}
          className={`flex items-center gap-3 rounded-xl border bg-muted/20 p-3 transition-colors ${
            isDragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'
          }`}
        >
          {value && preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview, not a remote asset
            <img src={preview} alt="Face source" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
              <ScanFace className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            {pickerDialog}
            <button
              type="button"
              onClick={openPicker}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {value ? 'Replace photo' : 'Upload photo'}
            </button>
            {value && (
              <button
                type="button"
                onClick={clear}
                className="ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
            {!value && !uploading && (
              <p className="mt-1 text-xs text-muted-foreground">A clear, front-facing photo works best — drag &amp; drop supported.</p>
            )}
          </div>
        </div>
        ) : (
        /* Saved face model picker */
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Saved face model</span>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={loadingModels}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              title="Refresh list"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {faceModels.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {faceModels.map((name) => {
                const selected = faceModel === name
                const label = name.replace(/\.safetensors$/i, '')
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onFaceModelChange(name)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                      selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-background hover:bg-muted/50'
                    }`}
                  >
                    <Boxes className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {loadingModels ? 'Loading…' : 'No face models yet — build one in the Tools tab.'}
            </p>
          )}
        </div>
        )}

        {/* Swap-model picker: inswapper (classic 128px) vs hyperswap (256px). */}
        <div className="rounded-xl border border-border bg-muted/20 p-2">
          <div className="grid grid-cols-2 gap-2">
            {SWAP_MODELS.map((m) => {
              const selected = activeModel === m.id
              const unavailable = PIXEL_BOOST_ONLY.has(m.id) && !pixelBoostAvailable
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => onModelChange(m.id)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    unavailable
                      ? 'border-border bg-background opacity-50 cursor-not-allowed'
                      : selected
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border bg-background hover:bg-muted/50'
                  }`}
                >
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {unavailable ? 'needs RaccoonSwapNodes' : m.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Pixel boost: swap at 512-1024px effective resolution (FaceFusion technique). */}
        <div className={`rounded-xl border border-border bg-muted/20 p-3 space-y-2 ${pixelBoostAvailable ? '' : 'opacity-60'}`}>
          <label className={`flex items-center gap-2 text-sm ${pixelBoostAvailable ? '' : 'cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={boostOn}
              disabled={!pixelBoostAvailable || modelForcesBoost}
              onChange={(e) => onPixelBoostChange(e.target.checked)}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
            />
            <span className="font-medium">Pixel boost</span>
            <span className="text-xs text-muted-foreground">
              {!pixelBoostAvailable
                ? 'unavailable — RaccoonSwapNodes did not load'
                : modelForcesBoost
                ? `always on for ${SWAP_MODELS.find((m) => m.id === activeModel)?.label}`
                : 'sharper swap detail (experimental)'}
            </span>
          </label>
          {boostOn && (
            <>
            <div className="grid grid-cols-3 gap-2">
              {BOOST_SIZES.map((size) => {
                const selected = (pixelBoostSize ?? '512x512') === size
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onPixelBoostSizeChange(size)}
                    className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors ${
                      selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-background hover:bg-muted/50'
                    }`}
                  >
                    {size.split('x')[0]}px
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">512–768 recommended; 1024 can show crackled skin texture with the 256px swap models.</p>

            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-sm font-medium">
                  Identity strength
                  <InfoTip>
                    Neutral is the strongest likeness. Left blends toward the generated face — softer,
                    easier to blend, less like your reference. Right overshoots the other way, which
                    exaggerates the difference from the generated face rather than adding likeness,
                    and starts to caricature.
                  </InfoTip>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {identityValue === IDENTITY_NEUTRAL ? 'neutral' : identityValue.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={identityValue}
                onChange={(e) => onIdentityChange(Number(e.target.value))}
                className="w-full accent-primary"
                aria-label="Identity strength"
              />
            </div>
            </>
          )}
        </div>
        </TileBody>
      )}
    </div>
  )
}
