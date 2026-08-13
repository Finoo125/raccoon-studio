'use client'

import { ImagePlus, Trash2, Scissors, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RenderPanel } from '../VideoFormPanels'
import { MIN_SPAN, clamp, detachMedia, removeItem, sortedSegments } from '@/lib/workflows/timeline-edit'
import type { DirectorShot, DirectorTimeline } from '@/lib/workflows/director-timeline'
import type { Selection } from './DirectorTimeline'
import { comfyInputUrl } from './lane-media'

export type InspectorTab = 'selection' | 'render'

const LANE_TITLE: Record<Selection['lane'], string> = {
  shots: 'Shot',
  audio: 'Audio clip',
  motion: 'Motion reference',
}

/**
 * The right column: whatever is selected on the timeline, at a size you can
 * actually work in — and the render settings alongside it.
 *
 * The two are tabs rather than one replacing the other, because resolution and
 * duration are exactly the things you want to change while a shot is selected,
 * and deselecting to reach them lost your place.
 *
 * Living here rather than under the lanes also fixes a real bug: the old
 * inspector sat below the timeline, so anything appearing in it pushed the
 * lanes up between the two halves of a double-click, and the first split on a
 * fresh timeline silently did nothing.
 */
export default function DirectorInspector({
  timeline, onChange, selection, onSelect, durationSeconds, tab, onTabChange, onAttachMedia,
}: {
  timeline: DirectorTimeline
  onChange: (t: DirectorTimeline) => void
  selection: Selection | null
  onSelect: (s: Selection | null) => void
  durationSeconds: number
  tab: InspectorTab
  onTabChange: (t: InspectorTab) => void
  /** Upload an image or clip and pin it into the selected shot. */
  onAttachMedia: (shotId: string) => void
}) {
  const segments = sortedSegments(timeline)
  const segIndex = selection?.lane === 'shots' ? segments.findIndex((s) => s.id === selection.id) : -1
  const shot = segIndex >= 0 ? segments[segIndex] : undefined
  const media =
    selection && (selection.lane === 'audio' || selection.lane === 'motion')
      ? timeline[selection.lane].find((m) => m.id === selection.id)
      : undefined

  const showSelection = Boolean(selection && tab === 'selection')

  const remove = () => {
    if (!selection) return
    onChange(removeItem(timeline, selection.lane, selection.id))
    onSelect(null)
  }

  const patchMedia = (lane: 'audio' | 'motion', id: string, patch: Record<string, number>) =>
    onChange({
      ...timeline,
      [lane]: timeline[lane].map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })

  const patchShot = (id: string, patch: Partial<DirectorShot>) =>
    onChange({
      ...timeline,
      segments: timeline.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })

  return (
    <div className="flex h-full flex-col">
      {/* Tabs appear only once there is a selection to switch away from. */}
      {selection && (
        <div className="flex shrink-0 border-b border-border">
          <TabButton active={tab === 'selection'} onClick={() => onTabChange('selection')}>
            {LANE_TITLE[selection.lane]}
            {segIndex >= 0 ? ` ${segIndex + 1}` : ''}
          </TabButton>
          <TabButton active={tab === 'render'} onClick={() => onTabChange('render')}>
            <SlidersHorizontal className="size-3.5 mr-1.5 inline-block align-[-2px]" />
            Render
          </TabButton>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showSelection && shot ? (
          <>
            <Header title={`Shot ${segIndex + 1}`} onRemove={remove} />
            <p className="text-xs tabular-nums text-muted-foreground">
              {shot.startSec.toFixed(1)}s → {(shot.startSec + shot.lengthSec).toFixed(1)}s
              {' · '}
              {shot.lengthSec.toFixed(1)}s long
            </p>
            {/* Deliberately NOT autoFocus. Selecting a shot used to move focus
                here, which meant Delete typed into the prompt instead of
                deleting the shot — the keyboard's most obvious gesture, dead. */}
            <Textarea
              value={shot.prompt}
              onChange={(e) => patchShot(shot.id, { prompt: e.target.value })}
              placeholder="What happens during this part of the clip…"
              className="min-h-40 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The global prompt on the left still applies — this adds to it for these seconds.
            </p>

            {/* The picture, on the same block as the prompt — upstream's model. */}
            {shot.file ? (
              <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {shot.kind === 'video' ? 'Clip' : 'Image'}
                  </span>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove the picture from this shot"
                    title="Remove the picture, keep the shot"
                    onClick={() => onChange(detachMedia(timeline, shot.id))}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {shot.kind === 'video' ? (
                  <video
                    src={comfyInputUrl(shot.file)}
                    controls
                    muted
                    className="w-full rounded-lg ring-1 ring-border bg-muted"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- ComfyUI input preview
                  <img
                    src={comfyInputUrl(shot.file)}
                    alt={shot.file}
                    className="w-full rounded-lg ring-1 ring-border bg-muted"
                  />
                )}
                <p className="truncate text-xs text-muted-foreground" title={shot.file}>{shot.file}</p>
                <Slider
                  label="Strength" value={shot.strength ?? 1} display={(shot.strength ?? 1).toFixed(2)}
                  min={0} max={1} step={0.05}
                  onChange={(v) => patchShot(shot.id, { strength: v })}
                />
                {shot.kind === 'video' ? (
                  <>
                    <Slider
                      label="Trim from start" value={shot.trimStartSec ?? 0}
                      display={`${(shot.trimStartSec ?? 0).toFixed(1)}s`}
                      min={0}
                      max={Math.max(0.1, (shot.sourceDurationSec ?? 0) - shot.lengthSec)}
                      step={0.1}
                      onChange={(v) => patchShot(shot.id, { trimStartSec: v })}
                    />
                    <p className="text-xs text-muted-foreground">
                      These frames are kept as they are. Everything outside this shot is
                      generated — which is how you extend or partly redo a clip you already have.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={shot.isEndFrame === true}
                        onChange={(e) => patchShot(shot.id, { isEndFrame: e.target.checked })}
                      />
                      Arrive at this image (end frame)
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Full strength pins the frame exactly; lower it to let the model blend
                      through. Ticked, the video reaches this image at{' '}
                      {(shot.startSec + shot.lengthSec).toFixed(1)}s instead of starting from it.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onAttachMedia(shot.id)}
              >
                <ImagePlus className="size-4 mr-2" /> Add an image or clip
              </Button>
            )}
          </>
        ) : showSelection && media && selection ? (
          <>
            <Header title={LANE_TITLE[selection.lane]} onRemove={remove} />
            <p className="truncate text-xs text-muted-foreground" title={media.file}>{media.file}</p>
            <Slider
              label="Starts at" value={media.startSec} display={`${media.startSec.toFixed(1)}s`}
              min={0} max={Math.max(0, durationSeconds - media.lengthSec)} step={0.1}
              onChange={(v) => patchMedia(selection.lane as 'audio' | 'motion', media.id, { startSec: v })}
            />
            {/* Both maxima respect the material as well as the render: past
                the end of the file there is nothing left to play. */}
            <Slider
              label="Length" value={media.lengthSec} display={`${media.lengthSec.toFixed(1)}s`}
              min={MIN_SPAN}
              max={Math.max(MIN_SPAN, Math.min(
                durationSeconds - media.startSec,
                (media.sourceDurationSec ?? Infinity) - media.trimStartSec,
              ))}
              step={0.1}
              onChange={(v) => patchMedia(selection.lane as 'audio' | 'motion', media.id, { lengthSec: v })}
            />
            <Slider
              label="Trim from start" value={media.trimStartSec} display={`${media.trimStartSec.toFixed(1)}s`}
              min={0}
              max={Math.max(0.1, (media.sourceDurationSec ?? media.lengthSec) - media.lengthSec)}
              step={0.1}
              onChange={(v) => patchMedia(selection.lane as 'audio' | 'motion', media.id, { trimStartSec: v })}
            />
          </>
        ) : (
          <>
            {timeline.retake && (
              <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Scissors className="size-4 text-primary" /> Retake
                </div>
                <p className="truncate text-xs text-muted-foreground" title={timeline.retake.videoFile}>
                  {timeline.retake.videoFile}
                </p>
                <div className="flex gap-2">
                  {(['startSec', 'lengthSec'] as const).map((k) => (
                    <label key={k} className="flex flex-1 items-center gap-1 text-xs text-muted-foreground">
                      {k === 'startSec' ? 'from' : 'for'}
                      <input
                        type="number"
                        min={0}
                        max={timeline.retake!.videoDurationSec}
                        step={0.1}
                        value={timeline.retake![k]}
                        aria-label={k === 'startSec' ? 'Retake start' : 'Retake length'}
                        className="h-7 w-full min-w-0 rounded border border-border bg-background px-1 text-xs tabular-nums"
                        onChange={(e) =>
                          onChange({
                            ...timeline,
                            retake: {
                              ...timeline.retake!,
                              [k]: clamp(Number(e.target.value) || 0, 0, timeline.retake!.videoDurationSec),
                            },
                          })
                        }
                      />
                      s
                    </label>
                  ))}
                </div>
                <Textarea
                  value={timeline.retake.prompt ?? ''}
                  onChange={(e) =>
                    onChange({ ...timeline, retake: { ...timeline.retake!, prompt: e.target.value } })
                  }
                  placeholder="What should happen in the redone part? Leave empty to keep the global prompt."
                  className="min-h-14 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Only this stretch is generated again. The rest of the video is kept as-is.
                </p>
              </div>
            )}

            {!selection && (
              <p className="text-xs text-muted-foreground">
                Pick anything on the timeline to edit it here.
              </p>
            )}
            <RenderPanel />
          </>
        )}
      </div>
    </div>
  )
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={`flex-1 truncate px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'border-b-2 border-primary text-foreground'
          : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function Header({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="flex-1 font-heading text-base font-semibold tracking-tight">{title}</h3>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} aria-label={`Delete ${title}`} title="Delete (or press Delete)">
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

function Slider({
  label, value, display, min, max, step, onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        className="w-full accent-primary"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
