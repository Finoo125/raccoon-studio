'use client'

import { useState } from 'react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { HUE_BANDS, type HslBand } from '@/lib/photo-edit/types'
import { cn } from '@/lib/utils'
import ColorWheel from './ColorWheel'
import GroupSliders from './GroupSliders'
import SliderRow from './SliderRow'

const AXES: { id: keyof HslBand; label: string }[] = [
  { id: 'hue', label: 'Hue' },
  { id: 'sat', label: 'Saturation' },
  { id: 'lum', label: 'Luminance' },
]

/** Swatch per band so the slider list reads as colours, not just words. */
const SWATCH: Record<string, string> = {
  red: '#e5484d', orange: '#f76b15', yellow: '#ffe629', green: '#46a758',
  aqua: '#12a594', blue: '#3e63dd', purple: '#8e4ec6', magenta: '#e93d82',
}

export default function ColorPanel() {
  const hsl = usePhotoEditStore((s) => s.editState.hsl)
  const wheels = usePhotoEditStore((s) => s.editState.wheels)
  const setHsl = usePhotoEditStore((s) => s.setHsl)
  const setWheel = usePhotoEditStore((s) => s.setWheel)
  const setWheelsField = usePhotoEditStore((s) => s.setWheelsField)
  const endGesture = usePhotoEditStore((s) => s.endGesture)
  const showHint = usePhotoEditStore((s) => !s.dismissedHints.includes('color'))
  const [axis, setAxis] = useState<keyof HslBand>('sat')

  return (
    <div className="flex flex-col gap-3">
      {/* White balance and overall saturation — the Color slider group. */}
      <GroupSliders id="color" />

      <section>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Color mixer
        </p>
        {showHint && (
          <p className="mb-1.5 text-[10px] leading-snug text-muted-foreground/70">
            Change one colour without touching the rest. Pick what to change, then
            drag the colour you want to change it in.
          </p>
        )}
        <div className="mb-1 flex items-center gap-1">
          {AXES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAxis(id)}
              className={cn(
                'flex-1 rounded px-1 py-1 text-[11px] font-medium transition-colors',
                axis === id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {HUE_BANDS.map((band) => (
          <div key={band} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: SWATCH[band] }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <SliderRow
                label={band[0].toUpperCase() + band.slice(1)}
                value={hsl[band][axis]}
                onChange={(v) => setHsl(band, axis, v)}
                onReset={() => setHsl(band, axis, 0)}
              />
            </div>
            {/* Bands carry no per-row help — the axis line above covers them. */}
          </div>
        ))}
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Color grading
        </p>
        {showHint && (
          <p className="mb-2 text-[10px] leading-snug text-muted-foreground/70">
            Tint the dark, middle and bright parts separately — the teal-shadows,
            warm-skin look films use. Drag out from the centre; centre is off.
          </p>
        )}
        <div className="flex justify-between gap-1">
          {(['shadows', 'midtones', 'highlights'] as const).map((zone) => (
            <ColorWheel
              key={zone}
              label={zone[0].toUpperCase() + zone.slice(1)}
              stop={wheels[zone]}
              onChange={(patch) => setWheel(zone, patch)}
              onEnd={endGesture}
            />
          ))}
        </div>
        <SliderRow
          label="Blending"
          min={0}
          max={100}
          value={wheels.blending}
          showHint={showHint}
          onChange={(v) => setWheelsField('blending', v)}
          onReset={() => setWheelsField('blending', 100)}
        />
        <SliderRow
          label="Balance"
          value={wheels.balance}
          showHint={showHint}
          onChange={(v) => setWheelsField('balance', v)}
          onReset={() => setWheelsField('balance', 0)}
        />
      </section>
    </div>
  )
}
