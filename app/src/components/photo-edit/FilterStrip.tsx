'use client'

import { useEffect, useRef, useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { PRESETS } from '@/lib/photo-edit/presets'
import { renderToCanvas } from '@/lib/photo-edit/pipeline'
import { defaultEditState } from '@/lib/photo-edit/types'
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
function renderPreviewUrl(tiny: ImageBitmap, presetId: string): string {
  const canvas = document.createElement('canvas')
  const state = defaultEditState()
  state.filter = { id: presetId, intensity: 1 }
  renderToCanvas(tiny, state, canvas)
  return canvas.toDataURL()
}

export default function FilterStrip() {
  const source = usePhotoEditStore((s) => s.source)
  const filterId = usePhotoEditStore((s) => s.editState.filter.id)
  const filterIntensity = usePhotoEditStore((s) => s.editState.filter.intensity)
  const selectFilter = usePhotoEditStore((s) => s.selectFilter)
  const setFilterIntensity = usePhotoEditStore((s) => s.setFilterIntensity)

  // Map from presetId → data URL thumbnail; generated async when source changes.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  // Ref to the tiny bitmap so we can .close() when source changes.
  const tinyRef = useRef<ImageBitmap | null>(null)

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
      for (const preset of PRESETS) {
        try {
          map[preset.id] = renderPreviewUrl(tiny, preset.id)
        } catch {
          // If rendering fails for any preset, leave the entry absent → fallback shown.
        }
      }
      if (!cancelled) setThumbs(map)
    })

    return () => {
      cancelled = true
    }
  }, [source])

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
    <div className="flex flex-col gap-2 py-2">
      {/* Scrollable preset strip */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-1">
        {PRESETS.map((preset) => {
          const isSelected = preset.id === filterId
          const thumbUrl = thumbs[preset.id]
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => selectFilter(preset.id)}
              className={cn(
                'flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-transparent hover:border-border hover:bg-muted/60',
              )}
            >
              <div className="h-16 w-16 overflow-hidden rounded-md bg-muted">
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
                  'text-[10px] font-medium',
                  isSelected ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {preset.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* Intensity slider — only visible when a non-original preset is selected */}
      {selectedPreset.id !== 'original' && (
        <div className="px-4">
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
