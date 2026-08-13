'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { PRESETS } from '@/lib/photo-edit/presets'
import {
  deleteUserPreset, loadUserPresets, presetFromState, saveUserPreset, stateFromPreset,
} from '@/lib/photo-edit/user-presets'
import { renderToCanvas } from '@/lib/photo-edit/pipeline'
import { defaultEditState, type Preset } from '@/lib/photo-edit/types'
import { cn } from '@/lib/utils'
import SliderRow from './SliderRow'

/** Tiny bitmap side for thumbnails (px) */
const THUMB_PX = 96

/** Downscale an ImageBitmap to a small square-ish bitmap for preview. */
async function makeTiny(source: ImageBitmap): Promise<ImageBitmap> {
  const scale = THUMB_PX / Math.max(source.width, source.height)
  const w = Math.round(source.width * scale)
  const h = Math.round(source.height * scale)
  return createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
}

/** Render a preset onto a tiny bitmap and return a data URL. */
function renderPreviewUrl(tiny: ImageBitmap, preset: Preset): string {
  const canvas = document.createElement('canvas')
  const state = defaultEditState()
  // Built-ins are a filter layer the pipeline scales by intensity; a user preset
  // is a saved look, so its values go straight into the state being previewed.
  if (preset.custom) Object.assign(state, stateFromPreset(preset))
  else state.filter = { id: preset.id, intensity: 1 }
  renderToCanvas(tiny, state, canvas)
  return canvas.toDataURL()
}

export default function FilterStrip() {
  const source = usePhotoEditStore((s) => s.source)
  const editState = usePhotoEditStore((s) => s.editState)
  const filterId = usePhotoEditStore((s) => s.editState.filter.id)
  const filterIntensity = usePhotoEditStore((s) => s.editState.filter.intensity)
  const selectFilter = usePhotoEditStore((s) => s.selectFilter)
  const setFilterIntensity = usePhotoEditStore((s) => s.setFilterIntensity)
  const applyLook = usePhotoEditStore((s) => s.applyLook)

  // Map from presetId → data URL thumbnail; generated async when source changes.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [userPresets, setUserPresets] = useState<Preset[]>([])
  // Ref to the tiny bitmap so we can .close() when source changes.
  const tinyRef = useRef<ImageBitmap | null>(null)

  // localStorage is not available during SSR, so the saved presets load on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only storage read
    setUserPresets(loadUserPresets())
  }, [])

  const all = [...PRESETS, ...userPresets]

  useEffect(() => {
    if (!source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset derived thumbnails when source is cleared
      setThumbs({})
      return
    }

    let cancelled = false

    void makeTiny(source).then((tiny) => {
      if (cancelled) { tiny.close(); return }
      // Close previous tiny bitmap.
      if (tinyRef.current) tinyRef.current.close()
      tinyRef.current = tiny

      const map: Record<string, string> = {}
      for (const preset of all) {
        try {
          map[preset.id] = renderPreviewUrl(tiny, preset)
        } catch {
          // If rendering fails for any preset, leave the entry absent → fallback shown.
        }
      }
      if (!cancelled) setThumbs(map)
    })

    return () => {
      cancelled = true
    }
    // `all` is derived from userPresets, which is listed — adding the array itself
    // would make the effect re-run every render and re-enter its own setThumbs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, userPresets])

  const handleSave = () => {
    const name = window.prompt('Name this preset')?.trim()
    if (!name) return
    setUserPresets(saveUserPreset(presetFromState(name, editState)))
    toast.success(`Saved preset “${name}”`)
  }

  const handleDelete = (preset: Preset) => {
    setUserPresets(deleteUserPreset(preset.id))
    toast.success(`Deleted “${preset.name}”`)
  }

  // Cleanup tiny bitmap on unmount.
  useEffect(() => {
    return () => {
      if (tinyRef.current) {
        tinyRef.current.close()
        tinyRef.current = null
      }
    }
  }, [])

  const selectedPreset = PRESETS.find((p) => p.id === filterId) ?? PRESETS[0]

  return (
    <div className="flex flex-col gap-2">
      {/* Wrapping grid — the presets live in the edit column now, not a bottom strip. */}
      <div className="grid grid-cols-3 gap-2">
        {all.map((preset) => {
          const isSelected = !preset.custom && preset.id === filterId
          const thumbUrl = thumbs[preset.id]
          return (
            <div key={preset.id} className="group relative">
              <button
                type="button"
                onClick={() =>
                  preset.custom ? applyLook(stateFromPreset(preset)) : selectFilter(preset.id)
                }
                className={cn(
                  'flex w-full flex-col items-center gap-1 rounded-lg border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent hover:border-border hover:bg-muted/60',
                )}
              >
                <div className="aspect-square w-full overflow-hidden rounded-md bg-muted">
                  {thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URLs, not next/image
                    <img
                      src={thumbUrl}
                      alt={preset.name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                      …
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'w-full truncate text-center text-[10px] font-medium',
                    isSelected ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {preset.name}
                </span>
              </button>
              {preset.custom && (
                <button
                  type="button"
                  title={`Delete ${preset.name}`}
                  aria-label={`Delete ${preset.name}`}
                  onClick={() => handleDelete(preset)}
                  className="absolute right-0.5 top-0.5 rounded bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}

        {/* Save the current look as a reusable preset. */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!source}
          title="Save the current edit as a preset"
          className="flex aspect-square w-full flex-col items-center justify-center gap-1 self-start rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          <span className="text-[10px]">Save</span>
        </button>
      </div>

      {/* Intensity slider — only visible when a non-original preset is selected */}
      {selectedPreset.id !== 'original' && (
        <div>
          <SliderRow
            label={`${selectedPreset.name} intensity`}
            value={Math.round(filterIntensity * 100)}
            min={0}
            max={100}
            onChange={(v) => setFilterIntensity(v / 100)}
          />
        </div>
      )}
    </div>
  )
}
