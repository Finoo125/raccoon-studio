'use client'

import { Trash2, Eraser, Brush } from 'lucide-react'
import { usePhotoEditStore } from '@/lib/photo-edit/store'
import { ADJUSTMENT_GROUPS, ZERO_ADJUSTMENTS, type MaskKind } from '@/lib/photo-edit/types'
import { cn } from '@/lib/utils'
import SliderRow from './SliderRow'

// `short` sits under the name for anyone who has not met these before — the
// names alone say nothing; `hint` stays as the hover tooltip.
const KINDS: { id: MaskKind; label: string; short: string; hint: string }[] = [
  { id: 'linear', label: 'Linear', short: 'Fades across', hint: 'Graduated filter — drag the two ends on the image' },
  { id: 'radial', label: 'Radial', short: 'A soft oval', hint: 'Elliptical spot — drag the centre or either radius' },
  { id: 'brush', label: 'Brush', short: 'Paint by hand', hint: 'Paint the area to adjust' },
  { id: 'luminance', label: 'Luminance', short: 'By brightness', hint: 'Select by brightness range' },
]

const toLabel = (k: string) => k.replace(/^./, (c) => c.toUpperCase())

export default function MasksPanel() {
  const masks = usePhotoEditStore((s) => s.editState.masks)
  const selectedId = usePhotoEditStore((s) => s.selectedMaskId)
  const addMask = usePhotoEditStore((s) => s.addMask)
  const selectMask = usePhotoEditStore((s) => s.selectMask)
  const updateMask = usePhotoEditStore((s) => s.updateMask)
  const removeMask = usePhotoEditStore((s) => s.removeMask)
  const setMaskAdjustment = usePhotoEditStore((s) => s.setMaskAdjustment)
  const brushRadius = usePhotoEditStore((s) => s.brushRadius)
  const brushErase = usePhotoEditStore((s) => s.brushErase)
  const setBrush = usePhotoEditStore((s) => s.setBrush)
  const showHint = usePhotoEditStore((s) => !s.dismissedHints.includes('masks'))

  const mask = masks.find((m) => m.id === selectedId) ?? null

  return (
    <div className="flex flex-col gap-3">
      <section>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Add mask
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {KINDS.map(({ id, label, short, hint }) => (
            <button
              key={id}
              type="button"
              title={hint}
              onClick={() => addMask(id)}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {label}
              {showHint && (
                <span className="block text-[9px] leading-tight text-muted-foreground/60">{short}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {masks.length > 0 && (
        <section>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Masks
          </p>
          <ul className="flex flex-col gap-1">
            {masks.map((m) => (
              <li key={m.id}>
                <div
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                    m.id === selectedId
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => selectMask(m.id === selectedId ? null : m.id)}
                  >
                    {m.name}
                  </button>
                  <button
                    type="button"
                    title="Invert this mask"
                    aria-pressed={m.invert}
                    onClick={() => updateMask(m.id, { invert: !m.invert })}
                    className={cn('rounded px-1 text-[10px]', m.invert ? 'bg-primary/20' : 'opacity-60')}
                  >
                    INV
                  </button>
                  <button
                    type="button"
                    title="Delete this mask"
                    aria-label={`Delete ${m.name}`}
                    onClick={() => removeMask(m.id)}
                    className="rounded p-0.5 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mask && (
        <>
          <section>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {mask.name}
            </p>
            <SliderRow
              label="Feather"
              min={0}
              max={100}
              value={mask.feather}
              showHint={showHint}
              onChange={(v) => updateMask(mask.id, { feather: v })}
              onReset={() => updateMask(mask.id, { feather: 50 })}
            />

            {mask.kind === 'luminance' && mask.luminance && (
              <>
                <SliderRow
                  label="Range from"
                  min={0} max={255}
                  value={mask.luminance.min}
                  showHint={showHint}
                  onChange={(v) => updateMask(mask.id, { luminance: { ...mask.luminance!, min: v } })}
                  onReset={() => updateMask(mask.id, { luminance: { ...mask.luminance!, min: 0 } })}
                />
                <SliderRow
                  label="Range to"
                  min={0} max={255}
                  value={mask.luminance.max}
                  showHint={showHint}
                  onChange={(v) => updateMask(mask.id, { luminance: { ...mask.luminance!, max: v } })}
                  onReset={() => updateMask(mask.id, { luminance: { ...mask.luminance!, max: 255 } })}
                />
              </>
            )}

            {mask.kind === 'brush' && (
              <>
                <SliderRow
                  label="Brush size"
                  min={1}
                  max={40}
                  value={Math.round(brushRadius * 100)}
                  showHint={showHint}
                  onChange={(v) => setBrush({ radius: v / 100 })}
                  onReset={() => setBrush({ radius: 0.08 })}
                />
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setBrush({ erase: false })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                      brushErase ? 'border-border text-muted-foreground' : 'border-primary bg-primary/10 text-primary',
                    )}
                  >
                    <Brush className="h-3 w-3" /> Paint
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrush({ erase: true })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                      brushErase ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    )}
                  >
                    <Eraser className="h-3 w-3" /> Erase
                  </button>
                </div>
                {(mask.brush?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => updateMask(mask.id, { brush: [] })}
                    className="mt-1 w-full rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear strokes ({mask.brush?.length})
                  </button>
                )}
              </>
            )}
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Adjust inside mask
              </p>
              <button
                type="button"
                onClick={() => updateMask(mask.id, { adjustments: { ...ZERO_ADJUSTMENTS } })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            </div>
            {ADJUSTMENT_GROUPS.map(({ label, keys }) => (
              <div key={label} className="mb-1">
                <p className="text-[10px] text-muted-foreground/70">{label}</p>
                {keys.map((key) => (
                  <SliderRow
                    key={key}
                    label={toLabel(key)}
                    value={mask.adjustments[key]}
                    showHint={showHint}
                    onChange={(v) => setMaskAdjustment(mask.id, key, v)}
                    onReset={() => setMaskAdjustment(mask.id, key, 0)}
                  />
                ))}
              </div>
            ))}
          </section>
        </>
      )}

      {masks.length === 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A mask limits an adjustment to part of the image — darken a sky, brighten a
          face, warm just the shadows.
        </p>
      )}
    </div>
  )
}
