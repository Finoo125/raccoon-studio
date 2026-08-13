'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, Clapperboard, Pause, Play, Repeat, SkipBack, SkipForward,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/lib/generation/studio-store'
import { pickShotMedia } from './lane-media'
import { IC_LORAS, assetInstalled } from '@/lib/models/ltx23-assets'
import VideoCanvas from '../VideoCanvas'
import RecentVideoRail from '../RecentVideoRail'
import { BriefPanel, GenerateButton, ModeSwitch, RESOLUTION_TIERS } from '../VideoFormPanels'
import { useVideoForm } from '../video-form-context'
import DirectorInspector, { type InspectorTab } from './DirectorInspector'
import DirectorTimelineEditor, { type Selection } from './DirectorTimeline'

const MIN_TIMELINE = 200
/** Grip + header + toolbar + ruler + four 56px lanes, so nothing is clipped on open. */
const DEFAULT_TIMELINE = 350

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The Director page: four zones, each answering one question.
 *
 *   left = what it's about · right = how it renders
 *   bottom = when things happen · center = what you got
 *
 * It replaces the ordinary two-column video page rather than docking onto it,
 * the way an NLE gives each stage of the job its own whole-window layout. The
 * form state behind it is identical — both layouts read `video-form-context` —
 * so switching modes never loses what you typed.
 */
export default function DirectorLayout() {
  const { workflow, params } = useVideoForm()
  const timeline = useStudioStore((s) => s.directorTimeline)
  const setTimeline = useStudioStore((s) => s.setDirectorTimeline)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentSec, setCurrentSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('render')
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [icLoras, setIcLoras] = useState<{ name: string; label: string }[]>([])

  const activeVideoUrl = useStudioStore((s) => s.activeVideoUrl)

  // Which IC-LoRAs are installed — the motion lane stays read-only without one.
  useEffect(() => {
    let alive = true
    fetch('/api/comfyui/object_info/LoraLoader')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const names = d?.LoraLoader?.input?.required?.lora_name?.[0] as string[] | undefined
        const installed = new Set(names ?? [])
        setIcLoras(IC_LORAS.filter((l) => assetInstalled(l.name, installed)))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // The monitor is the clock: the playhead follows the video, and scrubbing the
  // timeline writes back. Re-bound whenever the canvas swaps in a new clip.
  useEffect(() => {
    const el = videoRef.current
    if (!el) {
      setPlaying(false)
      return
    }
    const onTime = () => setCurrentSec(el.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [activeVideoUrl])

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop
  }, [loop, activeVideoUrl])

  /**
   * Selecting always brings the inspector back to the selection tab, so picking
   * a second shot after a detour into Render shows the shot rather than staying
   * on the settings. Paired here rather than in an effect inside the inspector,
   * which would have to guess when a "new" selection began.
   */
  const select = useCallback((s: Selection | null) => {
    setSelection(s)
    setInspectorTab(s ? 'selection' : 'render')
  }, [])

  /** Scrub: move the playhead, and take the video with it when there is one. */
  const scrub = useCallback((sec: number) => {
    setCurrentSec(sec)
    const el = videoRef.current
    if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(sec, el.duration)
  }, [])

  const step = (frames: number) => scrub(Math.max(0, currentSec + frames / params.fps))

  /** Pin a picture into a shot that already exists. */
  const attachMedia = async (shotId: string) => {
    try {
      const picture = await pickShotMedia()
      if (!picture) return
      const t = useStudioStore.getState().directorTimeline
      setTimeline({
        ...t,
        segments: t.segments.map((s) =>
          // The shot keeps its own length: the block is already where the
          // director put it, and a clip simply contributes the frames that fit.
          s.id === shotId ? { ...s, ...picture, lengthSec: s.lengthSec } : s,
        ),
      })
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  // Drag the top edge of the timeline to resize it.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = timelineH
    const move = (ev: PointerEvent) =>
      setTimelineH(Math.min(window.innerHeight * 0.7, Math.max(MIN_TIMELINE, startH - (ev.clientY - startY))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tier = RESOLUTION_TIERS.find((t) => t.id === (params.vramMode ?? 'high'))
  const shape = workflow.orientations.find((o) => o.value === params.orientation)
  const hasVideo = Boolean(activeVideoUrl)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar: the mode, the spec, and the action ─────────────────────── */}
      <div className="flex items-center gap-3 shrink-0 border-b border-border bg-card/60 px-3 py-1.5">
        <Clapperboard className="size-4 text-primary shrink-0" />
        <ModeSwitch compact />
        <div className="flex-1" />
        <span className="hidden md:block text-xs tabular-nums text-muted-foreground">
          {params.durationSeconds}s · {params.fps}fps · {tier?.label} · {shape?.label}
          {' · '}
          {timeline.segments.length} shot{timeline.segments.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <GenerateButton compact />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Left: the brief ───────────────────────────────────────────────── */}
        <aside className="w-[22rem] shrink-0 border-r border-border bg-card overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="font-heading text-lg font-bold tracking-tight leading-none">The brief</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What the whole clip is about. Per-shot detail goes on the timeline.
            </p>
          </div>
          <BriefPanel />
        </aside>

        {/* ── Center: the program monitor ───────────────────────────────────── */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex-1 min-h-0 flex">
            <VideoCanvas videoRef={videoRef} hideControls />
          </div>
          <div className="flex items-center gap-1 shrink-0 border-t border-border bg-card/60 px-3 py-1.5">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={!hasVideo} onClick={() => step(-1)} title="Back one frame" aria-label="Back one frame"
            >
              <SkipBack className="size-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={!hasVideo} onClick={togglePlay}
              title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              disabled={!hasVideo} onClick={() => step(1)} title="Forward one frame" aria-label="Forward one frame"
            >
              <SkipForward className="size-4" />
            </Button>
            <span className="ml-2 text-xs tabular-nums text-muted-foreground">
              {fmt(currentSec)} / {fmt(params.durationSeconds)}
            </span>
            <div className="flex-1" />
            <Button
              variant={loop ? 'default' : 'ghost'} className="h-7 px-2 text-xs"
              onClick={() => setLoop((v) => !v)} title="Loop playback"
            >
              <Repeat className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Right: the inspector ──────────────────────────────────────────── */}
        <aside className="w-[20rem] shrink-0 border-l border-border bg-card">
          <DirectorInspector
            timeline={timeline}
            onChange={setTimeline}
            selection={selection}
            onSelect={select}
            durationSeconds={params.durationSeconds}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            onAttachMedia={attachMedia}
          />
        </aside>

        <RecentVideoRail collapsible />
      </div>

      {/* ── Bottom: the timeline ───────────────────────────────────────────── */}
      {/* Flex column, not a percentage calc: the header, toolbar and resize grip
          are all different heights, and a calc that guesses them clipped the
          bottom lane clean off. */}
      <div
        className="shrink-0 flex flex-col border-t border-border bg-card"
        style={{ height: timelineOpen ? timelineH : undefined }}
      >
        {timelineOpen && (
          <div
            className="shrink-0 h-1.5 w-full cursor-row-resize bg-transparent hover:bg-primary/30 transition-colors"
            onPointerDown={startResize}
            title="Drag to resize the timeline"
          />
        )}
        {/* Three-track grid so the hide control sits dead centre whatever the
            summary text says — at the right-hand end it read as a stray icon. */}
        <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1 text-xs border-b border-border/60">
          <span className="flex items-center gap-2 min-w-0">
            <Clapperboard className="size-3.5 shrink-0 text-primary" />
            <span className="font-medium uppercase tracking-wide">Timeline</span>
            <span className="truncate text-muted-foreground">
              {timeline.segments.length} shot{timeline.segments.length === 1 ? '' : 's'} over{' '}
              {params.durationSeconds}s
            </span>
          </span>

          <button
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground"
            onClick={() => setTimelineOpen((v) => !v)}
            aria-expanded={timelineOpen}
            aria-label={timelineOpen ? 'Hide timeline' : 'Show timeline'}
          >
            {timelineOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            {timelineOpen ? 'Hide timeline' : 'Show timeline'}
          </button>

          <span />
        </div>

        {timelineOpen && (
          <div className="flex-1 min-h-0">
            <DirectorTimelineEditor
              value={timeline}
              onChange={setTimeline}
              durationSeconds={params.durationSeconds}
              motionEnabled={icLoras.length > 0}
              icLoras={icLoras}
              icLora={timeline.motionIcLora}
              onIcLoraChange={(v) => setTimeline({ ...timeline, motionIcLora: v })}
              selection={selection}
              onSelect={select}
              currentSec={currentSec}
              onScrub={scrub}
            />
          </div>
        )}
      </div>
    </div>
  )
}
