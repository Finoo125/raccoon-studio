export type AssetKind = 'video' | 'audio' | 'image'
export type AssetSource = 'gallery' | 'imported'

export interface MovieAsset {
  id: string
  kind: AssetKind
  source: AssetSource
  /** Absolute path on the server filesystem */
  path: string
  filename: string
  /** Media duration in seconds; 0 for still images */
  durationSec: number
  width?: number
  height?: number
  hasAudio: boolean
  /** Set at project load when the file is missing on disk */
  offline?: boolean
}

export interface MovieClip {
  id: string
  assetId: string
  /** Position on the timeline in seconds */
  startSec: number
  /** Trim window inside the asset (media time); images use 0..duration */
  inSec: number
  outSec: number
  /** 0..1 */
  volume: number
  /**
   * Crossfade with the clip immediately before it on the same track.
   * Implies the clip overlaps the previous clip by this many seconds
   * (startSec === prevEnd - crossfadeWithPrevious).
   */
  crossfadeWithPrevious?: number
}

export type TrackKind = 'video' | 'audio'

export interface MovieTrack {
  id: string
  kind: TrackKind
  /** Kept sorted by startSec. Array order of video tracks = bottom to top. */
  clips: MovieClip[]
}

export interface MovieSettings {
  width: number
  height: number
  fps: number
}

export interface MovieProject {
  id: string
  name: string
  createdAt: string
  modifiedAt: string
  settings: MovieSettings
  assets: MovieAsset[]
  tracks: MovieTrack[]
}

export interface MovieProjectSummary {
  id: string
  name: string
  createdAt: string
  modifiedAt: string
}

/** Default clip length for still images dropped on the timeline */
export const DEFAULT_IMAGE_CLIP_SEC = 5
