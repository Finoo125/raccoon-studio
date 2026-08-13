'use client'

import { useEffect, useState } from 'react'
import { downscaleFileToB64 } from '@/lib/generation/image-b64'
import { uploadImageBlob } from '@/lib/generation/upload'
import { SHOT_LENGTH_SEC, type DirectorShot } from '@/lib/workflows/director-timeline'

/**
 * Artwork for the timeline lanes: audio waveforms and motion poster frames.
 *
 * Both are cached in module-level maps keyed by the uploaded filename, and both
 * cache the *promise* rather than the value — two clips of the same file, or a
 * re-render while a decode is in flight, must not start a second decode or read
 * a half-filled entry.
 *
 * Nothing here reaches the timeline JSON. A saved timeline is a brief someone
 * might read or hand-edit; 200 floats per audio clip and a base64 JPEG per
 * motion clip would bury it.
 */

const waveforms = new Map<string, Promise<number[] | null>>()
const posters = new Map<string, Promise<string | null>>()

const PEAK_COUNT = 200

/** Timeline media lives in ComfyUI's input dir; reach it through the app proxy. */
export function comfyInputUrl(filename: string) {
  const cut = filename.lastIndexOf('/')
  const subfolder = cut < 0 ? '' : filename.slice(0, cut)
  const name = cut < 0 ? filename : filename.slice(cut + 1)
  return `/api/comfyui/view?filename=${encodeURIComponent(name)}&subfolder=${encodeURIComponent(subfolder)}&type=input`
}

async function decodePeaks(buf: ArrayBuffer): Promise<number[]> {
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(buf)
    const data = audio.getChannelData(0)
    const per = Math.max(1, Math.floor(data.length / PEAK_COUNT))
    const out: number[] = []
    for (let i = 0; i < PEAK_COUNT; i++) {
      let max = 0
      const end = Math.min((i + 1) * per, data.length)
      for (let j = i * per; j < end; j++) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
      out.push(max)
    }
    // Normalise against the loudest peak so a quiet recording still draws as a
    // waveform rather than a flat line.
    const ceiling = Math.max(0.01, ...out)
    return out.map((v) => v / ceiling)
  } finally {
    void ctx.close()
  }
}

/**
 * Peaks for an audio clip, 0..1, `PEAK_COUNT` of them. Pass `file` at upload
 * time to decode the bytes already in hand; without it the file is fetched back
 * out of ComfyUI (the path a loaded-from-JSON timeline takes).
 */
export function waveform(filename: string, file?: File): Promise<number[] | null> {
  let p = waveforms.get(filename)
  if (!p) {
    p = (async () => {
      try {
        const buf = file
          ? await file.arrayBuffer()
          : await (await fetch(comfyInputUrl(filename))).arrayBuffer()
        return await decodePeaks(buf)
      } catch {
        return null // no waveform is a cosmetic loss; the clip still works
      }
    })()
    waveforms.set(filename, p)
  }
  return p
}

/**
 * A JPEG data URL of the first frame of a video clip.
 *
 * `max` caps the longest side — 96 for a lane thumbnail, larger for the prompt
 * enhancer's vision pass — and is part of the cache key, so the two sizes never
 * serve each other's bytes.
 */
export function poster(filename: string, file?: File, max = 96): Promise<string | null> {
  const key = `${filename}|${max}`
  let p = posters.get(key)
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      const objectUrl = file ? URL.createObjectURL(file) : null
      const video = document.createElement('video')
      const done = (out: string | null) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        resolve(out)
      }
      video.preload = 'metadata'
      video.muted = true
      // Frame 0 is black in a lot of encodes, so nudge past it before grabbing.
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
      }
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas')
          // Fit the clip's own aspect rather than a fixed 16:9 box — a portrait
          // clip used to be squashed flat, which the vision pass would read as
          // the shot's actual framing.
          const w = video.videoWidth || 16
          const h = video.videoHeight || 9
          const scale = Math.min(1, max / Math.max(w, h))
          canvas.width = Math.max(1, Math.round(w * scale))
          canvas.height = Math.max(1, Math.round(h * scale))
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
          done(canvas.toDataURL('image/jpeg', 0.6))
        } catch {
          done(null)
        }
      }
      video.onerror = () => done(null)
      video.src = objectUrl ?? comfyInputUrl(filename)
    })
    posters.set(key, p)
  }
  return p
}

/** Longest side of a shot picture handed to the enhancer's vision pass. */
const VISION_PX = 512

/**
 * One shot's picture as a raw base64 JPEG for the prompt enhancer — the still
 * itself, or a frame lifted out of a pinned clip.
 *
 * Resolves null rather than throwing: an unreadable picture costs the enhancer
 * one image, and must never take the whole enhance down with it.
 */
export async function shotVisionB64(shot: DirectorShot): Promise<string | null> {
  if (!shot.file) return null
  try {
    if (shot.kind === 'video') {
      const url = await poster(shot.file, undefined, VISION_PX)
      return url ? (url.split(',', 2)[1] ?? null) : null
    }
    const blob = await (await fetch(comfyInputUrl(shot.file))).blob()
    return (await downscaleFileToB64(blob, VISION_PX)) || null
  } catch {
    return null
  }
}

function useCached<T>(filename: string, load: (f: string) => Promise<T | null>): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    // Callers pass '' for the lane they are not on, so this hook can be called
    // unconditionally — don't turn that into a doomed request.
    if (!filename) return
    let alive = true
    void load(filename).then((v) => {
      if (alive) setValue(v)
    })
    return () => {
      alive = false
    }
  }, [filename, load])
  return value
}

export const useWaveform = (filename: string) => useCached(filename, waveform)
export const usePoster = (filename: string) => useCached(filename, poster)

/** Ask for one file. Resolves null when the dialog is dismissed. */
export function pickFile(accept: string) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

/**
 * Pixel size and — for anything with a soundtrack or a timebase — duration,
 * read in the browser. No server-side probe: the bytes are already here.
 */
export function probeMedia(file: File) {
  return new Promise<{ w: number; h: number; duration: number }>((resolve) => {
    const url = URL.createObjectURL(file)
    const done = (out: { w: number; h: number; duration: number }) => {
      URL.revokeObjectURL(url)
      resolve(out)
    }
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight, duration: 0 })
      img.onerror = () => done({ w: 0, h: 0, duration: 0 })
      img.src = url
      return
    }
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video')
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      done({
        w: (el as HTMLVideoElement).videoWidth ?? 0,
        h: (el as HTMLVideoElement).videoHeight ?? 0,
        // 5 s is the fallback for a file whose metadata the browser will not
        // read — better a wrong clip length than a zero-length one.
        duration: Number.isFinite(el.duration) ? el.duration : 5,
      })
    el.onerror = () => done({ w: 0, h: 0, duration: 5 })
    el.src = url
  })
}

/**
 * Pick an image or a clip, upload it, and return it as the picture half of a
 * shot. Shared because a picture arrives two ways — a new shot from the
 * timeline, and "add an image" on a shot that already exists — and both have to
 * record exactly the same fields or the builder loses the aspect ratio or the
 * trim. Throws on upload failure; the caller owns the message.
 */
export async function pickShotMedia(): Promise<Partial<DirectorShot> | null> {
  const file = await pickFile('image/*,video/*')
  if (!file) return null
  const isVideo = file.type.startsWith('video')
  const [filename, probe] = await Promise.all([uploadImageBlob(file, file.name), probeMedia(file)])
  // Prime the artwork cache from the bytes already in hand — cheaper and more
  // reliable than fetching the file straight back out of ComfyUI.
  if (isVideo) void poster(filename, file)
  return {
    file: filename,
    strength: 1,
    lengthSec: isVideo ? probe.duration : SHOT_LENGTH_SEC,
    // Recorded because the node sizes the whole render from the FIRST picture;
    // without it we can only guess the aspect.
    ...(probe.w ? { width: probe.w, height: probe.h } : {}),
    ...(isVideo
      ? { kind: 'video' as const, trimStartSec: 0, sourceDurationSec: probe.duration }
      : {}),
  }
}

/**
 * Peaks as an SVG path over a 0..100 × 0..100 viewBox, mirrored about the
 * centre line. One path beats 200 rects — these redraw on every zoom change.
 */
export function peaksPath(peaks: number[]): string {
  if (peaks.length === 0) return ''
  const step = 100 / peaks.length
  const top = peaks.map((v, i) => `${(i * step).toFixed(2)},${(50 - v * 48).toFixed(2)}`)
  const bottom = peaks.map((_, i) => {
    const j = peaks.length - 1 - i // walk back along the same peaks
    return `${(j * step).toFixed(2)},${(50 + peaks[j] * 48).toFixed(2)}`
  })
  return `M${top.join('L')}L${bottom.join('L')}Z`
}
