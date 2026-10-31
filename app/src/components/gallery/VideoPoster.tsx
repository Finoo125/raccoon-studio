'use client'

import { useState } from 'react'
import type { GalleryImage } from '@/types/gallery'

/**
 * A clip's tile picture: the small JPEG of its first frame. When the server
 * can't make one (no ffmpeg) it shows the clip itself, as tiles did before —
 * megabytes per tile, but never a blank one.
 */
export default function VideoPoster({ video, className }: { video: GalleryImage; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <video src={video.url} muted playsInline preload="metadata" className={className} />
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local, already-small JPEG
    <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" className={className} onError={() => setFailed(true)} />
  )
}
