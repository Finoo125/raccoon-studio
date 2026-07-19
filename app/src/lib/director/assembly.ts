import { randomUUID } from 'crypto'
import type { MovieClip } from '@/types/movie'

export interface BeatClipInput {
  assetId: string
  durationSec: number
}

/**
 * Lay one clip per input end-to-end on a single track: each clip starts where the
 * previous ended (cumulative startSec), spans the whole asset (inSec 0 → duration),
 * full volume, no crossfade. Pure; ids are fresh per call.
 */
export function buildAssemblyClips(inputs: BeatClipInput[]): MovieClip[] {
  let start = 0
  return inputs.map((it) => {
    const clip: MovieClip = {
      id: randomUUID(),
      assetId: it.assetId,
      startSec: start,
      inSec: 0,
      outSec: it.durationSec,
      volume: 1,
    }
    start += it.durationSec
    return clip
  })
}
