'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Eye, EyeOff, FolderOpen, ImagePlus, Magnet, Maximize2, Minus, Plus, Save, Scissors, Video, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadImageBlob } from '@/lib/generation/upload'
import { parseTimeline } from '@/lib/workflows/director-timeline'
import { fitZoom, shotAt, snapSec } from '@/lib/workflows/timeline-snap'
import {
  makeId, makeMediaClip, makeShot, moveItem, removeItem, resizeItem, splitShot,
} from '@/lib/workflows/timeline-edit'
import type { DirectorShot, DirectorTimeline } from '@/lib/workflows/director-timeline'
import type { Edge, Lane } from '@/lib/workflows/timeline-edit'
import {
  comfyInputUrl, peaksPath, pickFile, pickShotMedia, poster, probeMedia,
  usePoster, useWaveform, waveform,
} from './lane-media'

const ROW_H = 56
const RULER_H = 28
const LANES = ['shots', 'audio', 'motion'] as const

/** Breathing room at the right edge so a clip on the last second is not clipped. */
const TRACK_PAD = 32

/**
 * Plain-English label + one-line "what does this actually do" per lane. Shown
 * in the gutter and as the lane's tooltip, so the feature explains itself
 * instead of needing docs.
 */
const LANE_INFO: Record<Lane, { label: string; help: string; add: string }> = {
  shots: {
    label: 'Shots',
    help: 'A stretch of the video. Give it a prompt, and an image or clip to pass through.',
    add: 'Add a shot at the playhead',
  },
  audio: {
    label: 'Audio',
    help: 'Use your own sound. Empty spots get filled in for you.',
    add: 'Add audio at the playhead',
  },
  motion: {
    label: 'Motion',
    help: 'Copy the camera movement from a video you drop here.',
    add: 'Add a motion reference at the playhead',
  },
}

/** Which timeline switch turns each lane off. Shots use the prompt-relay switch. */
const LANE_SWITCH: Record<Lane, 'promptRelay' | 'audioOn' | 'motionOn'> = {
  shots: 'promptRelay',
  audio: 'audioOn',
  motion: 'motionOn',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface Selection {
  lane: Lane
  id: string
}

interface Props {
  value: DirectorTimeline
  onChange: (t: DirectorTimeline) => void
  /** Render duration, owned by the form rather than the timeline. */
  durationSeconds: number
  /** Motion lane stays read-only until an IC-LoRA is installed. */
  motionEnabled?: boolean
  /** Installed IC-LoRAs the motion lane can be driven with. */
  icLoras?: { name: string; label: string }[]
  icLora?: string
  onIcLoraChange?: (v: string) => void
  /** Selection lives in the layout so the inspector column can render it. */
  selection: Selection | null
  onSelect: (sel: Selection | null) => void
  /** Playhead position in seconds, shared with the program monitor. */
  currentSec: number
  onScrub: (sec: number) => void
}

export default function DirectorTimelineEditor({
  value,
  onChange,
  durationSeconds,
  motionEnabled = true,
  icLoras = [],
  icLora,
  onIcLoraChange,
  selection: sel,
  onSelect: setSel,
  currentSec,
  onScrub,
}: Props) {
  // null = fit the clip to the window, which is the default. A fixed px/s left a
  // 10 s clip using half the width, so every edit happened in the left half of a
  // mostly-empty timeline. Zooming pins an explicit scale; Fit returns to null.
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [trackW, setTrackW] = useState(0)
  const [unit, setUnit] = useState<'sec' | 'frames'>('sec')
  const [snapOn, setSnapOn] = useState(true)
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // Ids come from a counter, not Date.now(): React Compiler is on, and it
  // rejects impure calls reached from the component body even via handlers.
  const nextId = useRef(0)

  // A horizontal scrollbar costs height, not width, so re-fitting on resize
  // cannot oscillate here.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setTrackW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoom = manualZoom ?? fitZoom(Math.max(0, trackW - TRACK_PAD), durationSeconds)
  const width = Math.max(durationSeconds, 1) * zoom

  const secAt = useCallback(
    (clientX: number, lane: Lane | 'ruler') => {
      const el = lane === 'ruler' ? scrollerRef.current : laneRefs.current[lane]
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const offset = lane === 'ruler' ? el.scrollLeft : 0
      return clamp((clientX - rect.left + offset) / zoom, 0, durationSeconds)
    },
    [zoom, durationSeconds],
  )

  const segments = useMemo(
    () => [...value.segments].sort((a, b) => a.startSec - b.startSec),
    [value.segments],
  )

  /**
   * Snap a dragged second to nearby landmarks. Only targets currently scrolled
   * into view are offered — snapping to something off screen reads as the clip
   * moving on its own.
   *
   * useCallback, not a plain closure: it reads `scrollerRef` at call time, and
   * the compiler's refs rule otherwise flags every handler it is threaded into.
   */
  const snap = useCallback(
    (sec: number, exclude?: string) => {
      if (!snapOn) return sec
      const el = scrollerRef.current
      const targets = [
        0,
        durationSeconds,
        currentSec,
        ...[...value.segments, ...value.audio, ...value.motion]
          .filter((m) => m.id !== exclude)
          .flatMap((m) => [m.startSec, m.startSec + m.lengthSec]),
      ]
      return snapSec(sec, targets, {
        zoom,
        viewStartSec: el ? el.scrollLeft / zoom : undefined,
        viewEndSec: el ? (el.scrollLeft + el.clientWidth) / zoom : undefined,
      })
    },
    [snapOn, zoom, currentSec, durationSeconds, value],
  )

  // ── edits ──────────────────────────────────────────────────────────────────
  /**
   * A new shot in the free space at `sec`. Returns the timeline it produced so
   * an upload can add its picture in the same edit rather than in a second one.
   */
  const addShot = (sec: number, over?: Partial<DirectorShot>) => {
    const [id, n] = makeId(value, 'shot', nextId.current)
    const shot = makeShot(value, id, sec, over)
    if (!shot) {
      toast.error('No room here — drag a shot narrower, or add this one in a gap')
      return null
    }
    nextId.current = n
    const next = { ...value, segments: [...value.segments, shot] }
    onChange(next)
    setSel({ lane: 'shots', id })
    return next
  }

  const splitAt = (sec: number) => {
    const [id, n] = makeId(value, 'shot', nextId.current)
    const next = splitShot(value, sec, id)
    // Refused: the cut landed outside every shot, or too near an edge to leave
    // two grabbable halves. On the bare stretches, cut means "start a shot".
    if (next === value) return addShot(sec)
    nextId.current = n
    onChange(next)
    setSel({ lane: 'shots', id })
    return next
  }

  const remove = (lane: Lane, id: string) => {
    onChange(removeItem(value, lane, id))
    if (sel?.id === id) setSel(null)
  }

  /** Delete whatever is selected — the gesture every editor has. */
  const removeSelected = useCallback(() => {
    if (!sel) return
    onChange(removeItem(value, sel.lane, sel.id))
    setSel(null)
  }, [sel, value, onChange, setSel])

  // Delete/Backspace on the selection, as upstream's canvas does it. Ignored
  // while a prompt box has focus, or it would eat the text being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (!sel) return
      e.preventDefault()
      removeSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, removeSelected])

  /**
   * Snapping happens inside `drag` rather than in the callers' callbacks:
   * `drag(...)` runs at render time, and handing it a closure that reads
   * `scrollerRef` trips the compiler's refs rule.
   */
  const drag = useCallback(
    (lane: Lane | 'ruler', exclude: string | undefined, onMove: (sec: number) => void) =>
      (e: React.PointerEvent) => {
        e.stopPropagation()
        // Without this, Chrome starts its own text-selection drag on the block
        // under the pointer and fires `pointercancel` after the FIRST move —
        // which silently ended every drag on this timeline about 8 px in, and
        // is why nothing here felt resizable.
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => onMove(snap(secAt(ev.clientX, lane), exclude))
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          // A cancel that does not tear down leaks a live pointermove listener
          // onto the window for the rest of the session.
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      },
    [snap, secAt],
  )

  /** Where a click landed, already snapped. */
  const snappedSecAt = useCallback(
    (clientX: number, lane: Lane | 'ruler') => snap(secAt(clientX, lane)),
    [snap, secAt],
  )

  /**
   * Drag one edge of a block — the same gesture on every lane, because
   * `resizeItem` is where the per-lane difference lives.
   *
   * Safe against the stale `value` captured when the pointer went down: every
   * edit is computed from the dragged-to second against the ORIGINAL block, so
   * repeating it mid-drag lands in the same place.
   */
  const resize = (lane: Lane, id: string, edge: Edge) =>
    drag(lane, id, (sec) => onChange(resizeItem(value, lane, id, edge, sec)))

  // ── uploads ────────────────────────────────────────────────────────────────
  /**
   * A shot with a picture in it. A clip is upstream's video support: the node
   * decodes its frames and pins them into the render, which is how an existing
   * video gets extended or partly kept.
   */
  const addShotWithMedia = async (sec: number) => {
    try {
      const picture = await pickShotMedia()
      if (picture) addShot(sec, picture)
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const addMedia = async (lane: 'audio' | 'motion', sec: number) => {
    const file = await pickFile(lane === 'audio' ? 'audio/*' : 'video/*')
    if (!file) return
    try {
      const [filename, probe] = await Promise.all([
        uploadImageBlob(file, file.name),
        probeMedia(file),
      ])
      // Prime the artwork cache from the bytes already in hand — cheaper and
      // more reliable than fetching the file straight back out of ComfyUI.
      if (lane === 'audio') void waveform(filename, file)
      else void poster(filename, file)
      const [id, n] = makeId(value, lane, nextId.current)
      nextId.current = n
      onChange({
        ...value,
        [lane]: [...value[lane], makeMediaClip(value, id, filename, sec, probe.duration)],
      })
      setSel({ lane, id })
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** What the lane's `+` does — always at the playhead, so it is predictable. */
  const addToLane = (lane: Lane) => {
    if (lane === 'shots') addShot(currentSec)
    else void addMedia(lane, currentSec)
  }

  // ── retake ─────────────────────────────────────────────────────────────────
  /**
   * Point the render at an existing clip and re-roll one span of it. The source
   * has to live in ComfyUI's input dir like any other timeline media, so a
   * finished render is re-uploaded rather than referenced where it sits.
   */
  const toggleRetake = async () => {
    if (value.retake) return onChange({ ...value, retake: undefined })
    const file = await pickFile('video/*')
    if (!file) return
    try {
      const [videoFile, probe] = await Promise.all([
        uploadImageBlob(file, file.name),
        probeMedia(file),
      ])
      onChange({
        ...value,
        retake: {
          videoFile,
          videoDurationSec: probe.duration,
          startSec: 0,
          lengthSec: Math.min(probe.duration, durationSeconds),
        },
      })
      toast.success('Retake on — set the stretch to redo in the inspector')
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── save / load ────────────────────────────────────────────────────────────
  // A timeline is plain JSON, so a file is the whole feature: portable, no
  // server route, and the browser's own dialog supplies the name.
  const onSave = () => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'director-timeline.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onLoad = async () => {
    const file = await pickFile('application/json,.json')
    if (!file) return
    try {
      const parsed = parseTimeline(JSON.parse(await file.text()), {
        durationSeconds,
        fps: value.fps,
      })
      if (!parsed) throw new Error('not a Director timeline')
      onChange(parsed)
      setSel(null)
      toast.success('Timeline loaded')
    } catch (e) {
      toast.error(`Could not load timeline: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const ticks = useMemo(() => {
    const step = [0.5, 1, 2, 5, 10, 30].find((s) => s * zoom >= 60) ?? 60
    return Array.from({ length: Math.floor(durationSeconds / step) + 1 }, (_, i) => i * step)
  }, [zoom, durationSeconds])

  const activeShot = shotAt(segments, currentSec)

  const laneBody = (lane: Lane) => {
    if (lane === 'shots') {
      return segments.map((s, i) => (
        <ShotBlock
          key={s.id}
          shot={s}
          index={i}
          zoom={zoom}
          durationSeconds={durationSeconds}
          active={sel?.lane === 'shots' && sel.id === s.id}
          live={activeShot?.id === s.id}
          onClick={(e) => { e.stopPropagation(); setSel({ lane: 'shots', id: s.id }) }}
          onDoubleClick={(e) => { e.stopPropagation(); splitAt(snappedSecAt(e.clientX, 'shots')) }}
          onPointerDown={drag('shots', s.id, (sec) => onChange(moveItem(value, 'shots', s.id, sec)))}
          onResize={(edge) => resize('shots', s.id, edge)}
          onRemove={() => remove('shots', s.id)}
        />
      ))
    }

    return value[lane].map((m) => (
      <MediaClip
        key={m.id}
        lane={lane}
        clip={m}
        zoom={zoom}
        active={sel?.lane === lane && sel.id === m.id}
        onClick={(e) => { e.stopPropagation(); setSel({ lane, id: m.id }) }}
        onPointerDown={drag(lane, m.id, (sec) => onChange(moveItem(value, lane, m.id, sec)))}
        onResize={(edge) => resize(lane, m.id, edge)}
        onRemove={() => remove(lane, m.id)}
      />
    ))
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar. Motion transfer, Retake, Save and Open are buttons rather than
          a ⋯ menu — they are the four things you reach for while directing, and
          behind a menu nobody found them. */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/60 shrink-0 flex-wrap">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setManualZoom((z) => Math.max(12, (z ?? zoom) / 1.4))} aria-label="Zoom out">
          <Minus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setManualZoom((z) => Math.min(400, (z ?? zoom) * 1.4))} aria-label="Zoom in">
          <Plus className="size-4" />
        </Button>
        <Button
          variant={manualZoom === null ? 'default' : 'outline'}
          className="h-7 px-2 text-xs"
          onClick={() => setManualZoom(null)}
          title="Fit the whole clip to the window"
        >
          <Maximize2 className="size-3.5 mr-1" /> Fit
        </Button>

        {/* Seconds vs frames — upstream's Display Mode. */}
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs tabular-nums"
          onClick={() => setUnit((u) => (u === 'sec' ? 'frames' : 'sec'))}
          title="Switch the ruler between seconds and frames"
        >
          {unit === 'sec' ? 'seconds' : 'frames'}
        </Button>

        <Button
          variant={snapOn ? 'default' : 'outline'}
          className="h-7 px-2 text-xs"
          onClick={() => setSnapOn((v) => !v)}
          title="Snap to shot boundaries, clip edges and the playhead"
        >
          <Magnet className="size-3.5 mr-1" /> Snap
        </Button>

        <div className="flex-1" />

        {/* Motion transfer — the IC-LoRA that drives the motion lane. */}
        <label className="flex items-center gap-1.5 text-xs" title="Which IC-LoRA copies the camera movement">
          <Video className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Motion transfer</span>
          {motionEnabled ? (
            <select
              className="h-7 max-w-44 rounded border border-border bg-background px-1.5 text-xs"
              value={icLora ?? icLoras[0]?.name ?? ''}
              onChange={(e) => onIcLoraChange?.(e.target.value)}
              aria-label="Motion transfer IC-LoRA"
            >
              {icLoras.map((l) => (
                <option key={l.name} value={l.name}>{l.label}</option>
              ))}
            </select>
          ) : (
            <span className="rounded border border-border px-1.5 py-1 text-[11px] text-muted-foreground">
              needs an IC-LoRA
            </span>
          )}
        </label>

        {/* Prompt and picture live on the same block, so "ignore the pictures"
            cannot be a lane switch any more — it is its own toggle, and only
            worth showing once a shot actually has one. */}
        {value.segments.some((s) => s.file) && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Render without the images pinned into the shots, keeping their prompts">
            <input
              type="checkbox"
              className="accent-primary"
              checked={value.keyframesOn !== false}
              onChange={(e) => onChange({ ...value, keyframesOn: e.target.checked })}
            />
            Use the images
          </label>
        )}

        {/* Audio gap-fill only matters once there is audio to leave gaps around. */}
        {value.audio.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Generate sound for the stretches your own audio does not cover">
            <input
              type="checkbox"
              className="accent-primary"
              checked={value.audioInpaint !== false}
              onChange={(e) => onChange({ ...value, audioInpaint: e.target.checked })}
            />
            Fill audio gaps
          </label>
        )}

        <span className="mx-1 h-5 w-px bg-border" />

        <Button
          variant={value.retake ? 'default' : 'outline'}
          className="h-7 px-2 text-xs"
          onClick={() => void toggleRetake()}
          title="Re-roll one stretch of a clip you already rendered, keeping the rest"
        >
          <Scissors className="size-3.5 mr-1" /> {value.retake ? 'Retake on' : 'Retake'}
        </Button>
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={onSave} title="Save this timeline to a file">
          <Save className="size-3.5 mr-1" /> Save
        </Button>
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => void onLoad()} title="Open a saved timeline">
          <FolderOpen className="size-3.5 mr-1" /> Open
        </Button>
      </div>

      {/* Scrolls vertically as one unit so the gutter can never drift out of
          step with the lanes when the panel is dragged shorter than they are. */}
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        {/* Fixed gutter: what each lane is, a switch to ignore it, and its add button. */}
        <div className="w-44 shrink-0 border-r border-border bg-muted/20">
          <div style={{ height: RULER_H }} className="border-b border-border" />
          {LANES.map((lane) => {
            const gated = lane === 'motion' && !motionEnabled
            const laneOn = value[LANE_SWITCH[lane]] !== false
            return (
              <div
                key={lane}
                className="flex items-start gap-1.5 border-b border-border/50 last:border-b-0 px-1.5 py-1"
                style={{ height: ROW_H }}
              >
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={gated}
                  aria-label={`${laneOn ? 'Turn off' : 'Turn on'} ${LANE_INFO[lane].label}`}
                  title={laneOn ? 'Turn off — keeps what is here but ignores it' : 'Turn on — use this lane again'}
                  onClick={() => onChange({ ...value, [LANE_SWITCH[lane]]: !laneOn })}
                >
                  {laneOn ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
                <div className={`min-w-0 flex-1 ${laneOn && !gated ? '' : 'opacity-45'}`}>
                  <div className="text-[11px] font-medium leading-tight">{LANE_INFO[lane].label}</div>
                  <p className="text-[9px] leading-tight text-muted-foreground line-clamp-2">
                    {LANE_INFO[lane].help}
                  </p>
                </div>
                {/* A visible add button — the click-the-lane gesture stays as an
                    accelerator, but it can no longer be the only way in. */}
                <div className="mt-0.5 flex shrink-0 flex-col gap-0.5">
                  <button
                    className="rounded border border-border bg-background p-0.5 text-muted-foreground hover:text-primary hover:border-primary/50 disabled:opacity-30"
                    disabled={gated || !laneOn}
                    aria-label={LANE_INFO[lane].add}
                    title={LANE_INFO[lane].add}
                    onClick={() => addToLane(lane)}
                  >
                    <Plus className="size-3" />
                  </button>
                  {/* Shots are the only lane with two ways in: a bare prompt
                      window, or one that already has a picture pinned in it. */}
                  {lane === 'shots' && (
                    <button
                      className="rounded border border-border bg-background p-0.5 text-muted-foreground hover:text-primary hover:border-primary/50 disabled:opacity-30"
                      disabled={!laneOn}
                      aria-label="Add a shot with an image or clip at the playhead"
                      title="Add a shot with an image or clip at the playhead"
                      onClick={() => void addShotWithMedia(currentSec)}
                    >
                      <ImagePlus className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div ref={scrollerRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width }}>
            {/* Ruler — click or drag anywhere on it to move the playhead. */}
            <div
              className="relative border-b border-border select-none cursor-pointer"
              style={{ height: RULER_H }}
              onPointerDown={drag('ruler', undefined, onScrub)}
              onClick={(e) => onScrub(snappedSecAt(e.clientX, 'ruler'))}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0" style={{ left: t * zoom }}>
                  <div className="w-px h-full bg-border" />
                  <span className="absolute top-0.5 left-1 text-[9px] text-muted-foreground tabular-nums">
                    {unit === 'sec' ? `${t}s` : Math.round(t * value.fps)}
                  </span>
                </div>
              ))}
            </div>

            {LANES.map((lane) => {
              const gated = lane === 'motion' && !motionEnabled
              const off = value[LANE_SWITCH[lane]] === false
              return (
                <div
                  key={lane}
                  ref={(el) => { laneRefs.current[lane] = el }}
                  data-lane={lane}
                  data-lane-off={off || undefined}
                  title={LANE_INFO[lane].help}
                  className={`relative select-none border-b border-border/50 last:border-b-0 ${
                    gated || off ? 'opacity-40 pointer-events-none' : 'cursor-copy'
                  }`}
                  style={{ height: ROW_H }}
                  onClick={(e) => {
                    const sec = snappedSecAt(e.clientX, lane)
                    if (lane === 'shots') addShot(sec)
                    else void addMedia(lane, sec)
                  }}
                >
                  {laneBody(lane)}
                  {lane === 'shots' && off && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                      Shots off — the whole clip uses just the global prompt.
                    </span>
                  )}
                  {lane === 'shots' && !off && value.segments.length === 0 && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                      No shots — the whole clip runs on the global prompt. Click here to add one.
                    </span>
                  )}
                </div>
              )
            })}

            {/* Playhead — one line across ruler and every lane, and the thing
                every `+` button and the program monitor agree on. */}
            <div
              className="pointer-events-none absolute top-0 z-20"
              style={{ left: currentSec * zoom, height: RULER_H + LANES.length * ROW_H }}
            >
              <div className="h-full w-px bg-action" />
              <div
                className="pointer-events-auto absolute -top-0.5 -left-1.5 h-3 w-3 cursor-col-resize touch-none rounded-sm bg-action"
                onPointerDown={drag('ruler', undefined, onScrub)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A grabbable block edge. Sits *inside* the block rather than straddling it, so
 * the block's own `overflow-hidden` cannot clip half the hit area away — which
 * is exactly what made the old shot boundary so hard to catch.
 */
function Handle({
  side, onPointerDown,
}: {
  side: Edge
  onPointerDown: (e: React.PointerEvent) => void
}) {
  return (
    <div
      className={`group/h absolute inset-y-0 z-10 w-2.5 cursor-col-resize touch-none ${
        side === 'left' ? 'left-0' : 'right-0'
      }`}
      onPointerDown={onPointerDown}
      // A resize is not a selection, and it is certainly not a lane click that
      // would drop another item where the pointer came up.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-foreground/30 transition-colors group-hover/h:bg-primary" />
    </div>
  )
}

/**
 * Delete, on the block itself. The inspector has a bin and Delete works on the
 * selection, but neither is where the hand goes first — "I cannot delete this"
 * was the report that started all of it.
 */
function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      className="absolute right-0.5 top-0.5 z-20 hidden rounded bg-background/80 p-0.5 text-muted-foreground hover:text-destructive group-hover/block:block"
      aria-label="Delete"
      title="Delete (or select it and press Delete)"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRemove() }}
    >
      <X className="size-3" />
    </button>
  )
}

/**
 * One stretch of the film: its prompt, and the picture pinned into it if it has
 * one. Prompt and picture share a block because that is upstream's model — the
 * node reads `seg.prompt` and `seg.imageFile` off the same main-track segment.
 */
function ShotBlock({
  shot, index, zoom, durationSeconds, active, live,
  onClick, onDoubleClick, onPointerDown, onResize, onRemove,
}: {
  shot: DirectorShot
  index: number
  zoom: number
  durationSeconds: number
  active: boolean
  live: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
  onResize: (edge: Edge) => (e: React.PointerEvent) => void
  onRemove: () => void
}) {
  const isVideo = shot.kind === 'video'
  const still = usePoster(isVideo && shot.file ? shot.file : '')
  // Drawn only as far as the render goes. A block may hang over the end — that
  // is how a final frame gets pinned — but the track must not grow to match.
  const shown = Math.max(
    0.05,
    Math.min(shot.startSec + shot.lengthSec, durationSeconds) - shot.startSec,
  )

  return (
    <div
      className={`group/block absolute top-1 bottom-1 flex overflow-hidden rounded border cursor-col-resize touch-none transition-colors ${
        active
          ? 'border-primary bg-primary/25 ring-1 ring-primary'
          : live
            ? 'border-action/60 bg-action/10'
            : 'border-border bg-muted/50'
      }`}
      style={{ left: shot.startSec * zoom, width: Math.max(20, shown * zoom) }}
      title={`${index + 1} · ${shot.startSec.toFixed(1)}s–${(shot.startSec + shot.lengthSec).toFixed(1)}s${
        shot.file ? ` · ${shot.file}${shot.isEndFrame ? ' (end frame)' : ''}` : ''
      }\n${shot.prompt || 'No prompt yet'}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      {/* The picture sits at the head of the block — that is where the node pins
          it, unless it is marked as the end frame. */}
      {shot.file && (
        <div className={`relative h-full w-12 shrink-0 bg-muted ${shot.isEndFrame ? 'order-last' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ComfyUI input preview */}
          <img
            src={isVideo ? (still ?? '') : comfyInputUrl(shot.file)}
            alt=""
            className="h-full w-full object-cover pointer-events-none"
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] text-white">
            {isVideo ? 'clip' : shot.isEndFrame ? 'end' : 'img'}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1 px-2 py-1">
        <span className="mb-0.5 flex items-center gap-1">
          <span className={`rounded px-1 text-[9px] font-semibold tabular-nums ${
            live ? 'bg-action text-background' : 'bg-muted-foreground/25'
          }`}>
            {index + 1}
          </span>
          <span className="text-[9px] tabular-nums text-muted-foreground">
            {shot.lengthSec.toFixed(1)}s
          </span>
        </span>
        <span className="block text-[11px] leading-tight line-clamp-2 text-foreground/80">
          {shot.prompt || <span className="italic text-muted-foreground">no prompt</span>}
        </span>
      </div>
      <Handle side="left" onPointerDown={onResize('left')} />
      <Handle side="right" onPointerDown={onResize('right')} />
      <RemoveButton onRemove={onRemove} />
    </div>
  )
}

/**
 * An audio or motion clip. Split out because each one loads its own artwork —
 * a waveform or a poster frame — and hooks cannot be called from inside the
 * lane's map callback.
 */
function MediaClip({
  lane, clip, zoom, active, onClick, onPointerDown, onResize, onRemove,
}: {
  lane: 'audio' | 'motion'
  clip: { id: string; startSec: number; lengthSec: number; file: string }
  zoom: number
  active: boolean
  onClick: (e: React.MouseEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
  onResize: (edge: Edge) => (e: React.PointerEvent) => void
  onRemove: () => void
}) {
  const peaks = useWaveform(lane === 'audio' ? clip.file : '')
  const still = usePoster(lane === 'motion' ? clip.file : '')

  return (
    <div
      className={`group/block absolute top-1 bottom-1 rounded border cursor-col-resize touch-none overflow-hidden ${
        active ? 'border-primary bg-primary/20 ring-1 ring-primary' : 'border-border bg-muted/50'
      }`}
      style={{ left: clip.startSec * zoom, width: Math.max(6, clip.lengthSec * zoom) }}
      title={`${clip.file} · ${clip.lengthSec.toFixed(1)}s`}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {lane === 'audio' && peaks && peaks.length > 0 && (
        <svg
          className="absolute inset-0 h-full w-full text-action/70"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={peaksPath(peaks)} fill="currentColor" />
        </svg>
      )}
      {lane === 'motion' && still && (
        // eslint-disable-next-line @next/next/no-img-element -- canvas-captured data URL
        <img src={still} alt="" className="absolute inset-y-0 left-0 h-full w-auto opacity-70" />
      )}
      <span className="relative block truncate px-1.5 pt-1 text-[10px] font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
        {clip.file}
      </span>
      <Handle side="left" onPointerDown={onResize('left')} />
      <Handle side="right" onPointerDown={onResize('right')} />
      <RemoveButton onRemove={onRemove} />
    </div>
  )
}
