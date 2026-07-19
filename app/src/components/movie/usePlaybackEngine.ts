'use client'

import { useEffect, useState } from 'react'
import { clipEnd, sortClips, timelineDuration } from '@/lib/movies/timeline-core'
import type { MovieAsset, MovieClip, MovieTrack } from '@/types/movie'
import { useEditorStoreApi } from './editor-store'
import { useEditorActions } from './editor-actions'

const SYNC_EPS = 0.15
const PRELOAD_AHEAD_SEC = 3

export const mediaUrl = (asset: MovieAsset) =>
  `/api/movies/media?path=${encodeURIComponent(asset.path)}`

export interface PlaybackEngine {
  registerVideoSlot: (trackId: string, slot: 'a' | 'b', el: HTMLVideoElement | null) => void
  registerImage: (clipId: string, el: HTMLImageElement | null) => void
  registerAudio: (clipId: string, el: HTMLAudioElement | null) => void
  registerClock: (el: HTMLElement | null) => void
}

interface SlotEls { a: HTMLVideoElement | null; b: HTMLVideoElement | null }
interface SlotClips { a: string | null; b: string | null }

function setMediaTime(el: HTMLMediaElement, sec: number): void {
  if (el.readyState >= 1) {
    el.currentTime = sec
  } else {
    el.addEventListener('loadedmetadata', () => { el.currentTime = sec }, { once: true })
  }
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Imperative playback core: a rAF loop reads the store lazily, advances the
 * playhead while playing, and drives the registered <video>/<img>/<audio>
 * elements (currentTime sync, play/pause, crossfade opacity, volume) plus the
 * timeline playhead line and the clock readout — all without store writes.
 * The store playhead is only committed on pause/stop; external playhead
 * changes (ruler scrub) are adopted each frame.
 */
export function usePlaybackEngine(): PlaybackEngine {
  const api = useEditorStoreApi()
  const actions = useEditorActions()

  const [internal] = useState(() => {
    const videoEls = new Map<string, SlotEls>()
    const slotClips = new Map<string, SlotClips>()
    const imageEls = new Map<string, HTMLImageElement>()
    const audioEls = new Map<string, HTMLAudioElement>()
    const clock: { el: HTMLElement | null } = { el: null }
    const engine: PlaybackEngine = {
      registerVideoSlot: (trackId, slot, el) => {
        const pair = videoEls.get(trackId) ?? { a: null, b: null }
        pair[slot] = el
        videoEls.set(trackId, pair)
        if (!el) {
          const clips = slotClips.get(trackId)
          if (clips) clips[slot] = null
        }
      },
      registerImage: (clipId, el) => {
        if (el) imageEls.set(clipId, el)
        else imageEls.delete(clipId)
      },
      registerAudio: (clipId, el) => {
        if (el) audioEls.set(clipId, el)
        else audioEls.delete(clipId)
      },
      registerClock: (el) => { clock.el = el },
    }
    return { videoEls, slotClips, imageEls, audioEls, clock, engine }
  })

  useEffect(() => {
    let raf = 0
    const playhead = { current: 0 }
    let lastStorePlayhead = -1
    let lastTick = 0
    let wasPlaying = false

    const allMedia = (): HTMLMediaElement[] => {
      const out: HTMLMediaElement[] = []
      for (const pair of internal.videoEls.values()) {
        if (pair.a) out.push(pair.a)
        if (pair.b) out.push(pair.b)
      }
      out.push(...internal.audioEls.values())
      return out
    }

    const commitPlayhead = () => {
      lastStorePlayhead = playhead.current
      actions.setPlayhead(playhead.current)
    }

    const coveringClips = (clips: MovieClip[], t: number, assets: Map<string, MovieAsset>) =>
      clips.filter((c) => {
        const a = assets.get(c.assetId)
        return a && !a.offline && c.startSec <= t && t < clipEnd(c)
      })

    const fadeOpacity = (clip: MovieClip, t: number): number => {
      const fade = clip.crossfadeWithPrevious ?? 0
      if (fade > 0 && t < clip.startSec + fade) return clamp01((t - clip.startSec) / fade)
      return 1
    }

    const driveVideoTrack = (
      track: MovieTrack,
      trackIdx: number,
      t: number,
      playing: boolean,
      assets: Map<string, MovieAsset>,
    ) => {
      const clips = sortClips(track.clips)
      const covering = coveringClips(clips, t, assets)
      const incomingId = covering.length > 1 ? covering[covering.length - 1].id : null
      const coveringVideo = covering.filter((c) => assets.get(c.assetId)?.kind === 'video')
      const next = clips.find((c) => {
        const a = assets.get(c.assetId)
        return a?.kind === 'video' && !a.offline && c.startSec > t && c.startSec <= t + PRELOAD_AHEAD_SEC
      })

      const els = internal.videoEls.get(track.id)
      if (els) {
        const want = [...coveringVideo]
        if (want.length < 2 && next) want.push(next)
        const wantIds = new Set(want.map((c) => c.id))
        const pair = internal.slotClips.get(track.id) ?? { a: null, b: null }
        internal.slotClips.set(track.id, pair)

        for (const clip of want.slice(0, 2)) {
          if (pair.a === clip.id || pair.b === clip.id) continue
          const free: 'a' | 'b' | null =
            !pair.a || !wantIds.has(pair.a) ? 'a' : !pair.b || !wantIds.has(pair.b) ? 'b' : null
          if (!free) break
          pair[free] = clip.id
          const el = els[free]
          const asset = assets.get(clip.assetId)
          if (el && asset) {
            const url = mediaUrl(asset)
            if (el.dataset.src !== url) {
              el.dataset.src = url
              el.src = url
            }
            setMediaTime(el, clip.inSec)
          }
        }

        for (const slot of ['a', 'b'] as const) {
          const el = els[slot]
          if (!el) continue
          const clip = pair[slot] ? clips.find((c) => c.id === pair[slot]) : undefined
          const active = clip && coveringVideo.some((c) => c.id === clip.id)
          if (!clip || !active) {
            el.style.opacity = '0'
            el.muted = true
            if (!el.paused) el.pause()
            if (clip && Math.abs(el.currentTime - clip.inSec) > SYNC_EPS) setMediaTime(el, clip.inSec)
            continue
          }
          el.style.opacity = String(fadeOpacity(clip, t))
          el.style.zIndex = String(trackIdx * 2 + (clip.id === incomingId ? 1 : 0))
          el.muted = false
          el.volume = clamp01(clip.volume)
          const wantTime = t - clip.startSec + clip.inSec
          if (Math.abs(el.currentTime - wantTime) > SYNC_EPS) setMediaTime(el, wantTime)
          if (playing) {
            if (el.paused) void el.play().catch(() => {})
          } else if (!el.paused) {
            el.pause()
          }
        }
      }

      for (const clip of clips) {
        if (assets.get(clip.assetId)?.kind !== 'image') continue
        const img = internal.imageEls.get(clip.id)
        if (!img) continue
        const active = covering.some((c) => c.id === clip.id)
        img.style.opacity = active ? String(fadeOpacity(clip, t)) : '0'
        img.style.zIndex = String(trackIdx * 2 + (clip.id === incomingId ? 1 : 0))
      }
    }

    const driveAudioTrack = (
      track: MovieTrack,
      t: number,
      playing: boolean,
      assets: Map<string, MovieAsset>,
    ) => {
      for (const clip of track.clips) {
        const el = internal.audioEls.get(clip.id)
        if (!el) continue
        const asset = assets.get(clip.assetId)
        const active = asset && !asset.offline && clip.startSec <= t && t < clipEnd(clip)
        if (!active) {
          if (!el.paused) el.pause()
          continue
        }
        el.volume = clamp01(clip.volume)
        const wantTime = t - clip.startSec + clip.inSec
        if (Math.abs(el.currentTime - wantTime) > SYNC_EPS) setMediaTime(el, wantTime)
        if (playing) {
          if (el.paused) void el.play().catch(() => {})
        } else if (!el.paused) {
          el.pause()
        }
      }
    }

    const frame = (now: number) => {
      const state = api.getState()
      const { tracks, assets: assetList } = state.editorModel
      const session = state.session
      const duration = timelineDuration(tracks)

      // Adopt external playhead changes (ruler scrub, lane click)
      if (session.playheadSec !== lastStorePlayhead) {
        lastStorePlayhead = session.playheadSec
        playhead.current = session.playheadSec
      }

      const playing = session.isPlaying
      if (playing && !wasPlaying) lastTick = now
      if (playing) {
        playhead.current += (now - lastTick) / 1000
        lastTick = now
      }
      if (!playing && wasPlaying) {
        for (const el of allMedia()) if (!el.paused) el.pause()
        commitPlayhead()
      }
      wasPlaying = playing
      if (playing && duration > 0 && playhead.current >= duration) {
        playhead.current = duration
        actions.setIsPlaying(false)
      }

      const t = playhead.current
      const assets = new Map(assetList.map((a) => [a.id, a]))
      let videoIdx = 0
      for (const track of tracks) {
        if (track.kind === 'video') driveVideoTrack(track, videoIdx++, t, playing, assets)
        else driveAudioTrack(track, t, playing, assets)
      }

      const phEl = document.querySelector<HTMLElement>('[data-movie-playhead]')
      if (phEl) phEl.style.transform = `translateX(${t * session.zoom}px)`
      if (internal.clock.el) {
        internal.clock.el.textContent = `${formatClock(t)} / ${formatClock(duration)}`
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [api, actions, internal])

  return internal.engine
}
