'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Heart, Images, Wand2, Play, Check } from 'lucide-react'
import { useGalleryStore } from '@/lib/gallery/store'
import { dateKeyOf } from '@/lib/gallery/folders'
import type { GalleryImage } from '@/types/gallery'

const PAD = 16 // p-4 around the grid
const GAP = 12 // gap-3 between tiles
const ASPECT = 4 / 3 // tile height / width (aspect-[3/4])
const OVERSCAN_ROWS = 3 // rows rendered beyond the viewport, each side
const TILE_TARGET = 190 // px — drives column count; max 7 wide per design

function colsForWidth(width: number): number {
  if (width <= 0) return 1
  return Math.max(2, Math.min(7, Math.floor(width / TILE_TARGET)))
}

/**
 * Windowed image grid: only the rows near the viewport are mounted, so the DOM
 * (and the number of full-size images loaded) stays bounded no matter how many
 * thousands of images exist. The grid is uniform fixed-aspect, so row geometry
 * is computed directly rather than measured per item.
 */
/**
 * @param onPick - Optional click handler. When provided (e.g. the photo-editing
 *   image chooser), clicking a tile calls this instead of opening the inspector.
 */
export default function GalleryGrid({ onPick }: { onPick?: (img: GalleryImage) => void } = {}) {
  const { images, loading, selected, setSelected, selectedFolder, mediaMode, selecting, selectedIds, toggleSelect } = useGalleryStore()

  // Scope to the browsed date folder; null = all images.
  const visible = useMemo(
    () => (selectedFolder ? images.filter((img) => dateKeyOf(img) === selectedFolder) : images),
    [images, selectedFolder],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [view, setView] = useState({ width: 0, height: 0, scrollTop: 0 })

  // Track the scroll container's size.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Track scroll position (rAF-throttled to one update per frame).
  const onScroll = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (el) setView((v) => (v.scrollTop === el.scrollTop ? v : { ...v, scrollTop: el.scrollTop }))
    })
  }, [])

  // Jump back to the top when the browsed folder changes. Resetting the DOM
  // scroll fires onScroll, which updates the window — no setState here.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [selectedFolder])

  // Row geometry + the visible window.
  const cols = colsForWidth(view.width)
  const contentWidth = Math.max(0, view.width - PAD * 2)
  const colWidth = (contentWidth - GAP * (cols - 1)) / cols
  const rowStride = colWidth * ASPECT + GAP
  const rowCount = Math.ceil(visible.length / cols)
  const totalHeight = rowCount > 0 ? PAD * 2 + rowCount * rowStride - GAP : 0

  // Clamp to the real scroll range so a stale scrollTop (e.g. right after
  // switching to a shorter folder) can never window past the content.
  const scrollTop = Math.min(view.scrollTop, Math.max(0, totalHeight - view.height))
  const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / rowStride) - OVERSCAN_ROWS)
  const rowsInView = Math.ceil(view.height / rowStride) + OVERSCAN_ROWS * 2
  const lastRow = Math.min(rowCount, firstRow + rowsInView)
  const startIndex = firstRow * cols
  const endIndex = Math.min(visible.length, lastRow * cols)
  const slice = colWidth > 0 ? visible.slice(startIndex, endIndex) : []
  const offsetY = PAD + firstRow * rowStride

  if (loading) {
    return (
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div
          className="grid gap-3 p-4"
          style={{ gridTemplateColumns: `repeat(${colsForWidth(view.width) || 5}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: 21 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="flex flex-col items-center justify-center h-full gap-5 py-24 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
            <Images className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              No {mediaMode === 'video' ? 'videos' : 'images'} yet
            </h2>
            <p className="text-sm text-muted-foreground max-w-xs text-balance">
              {mediaMode === 'video'
                ? 'Videos you generate will be collected here. Make your first clip to get started.'
                : 'Images you create will be collected here. Make your first one to get started.'}
            </p>
          </div>
          <Link
            href={mediaMode === 'video' ? '/generate-videos' : '/generate'}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <Wand2 className="h-4 w-4" />
            {mediaMode === 'video' ? 'Generate a video' : 'Start generating'}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: offsetY,
            left: PAD,
            right: PAD,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {slice.map((img) => (
            <GalleryCard
              key={img.id}
              img={img}
              isSelected={onPick ? false : selected?.id === img.id}
              selecting={!onPick && selecting}
              checked={selectedIds.includes(img.id)}
              onClick={() =>
                onPick ? onPick(img)
                : selecting ? toggleSelect(img.id)
                : setSelected(img)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function GalleryCard({
  img,
  isSelected,
  selecting,
  checked,
  onClick,
}: {
  img: GalleryImage
  isSelected: boolean
  selecting: boolean
  checked: boolean
  onClick: () => void
}) {
  return (
    <div
      className={`relative group cursor-pointer rounded-lg overflow-hidden ring-1 transition-all duration-200 ${
        checked
          ? 'ring-2 ring-primary'
          : isSelected
          ? 'ring-2 ring-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]'
          : 'ring-border/60 hover:ring-primary/40'
      }`}
      onClick={onClick}
    >
      {selecting && (
        <div className={`absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border-2 ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/80 bg-black/30'}`}>
          {checked && <Check className="h-3.5 w-3.5" />}
        </div>
      )}
      <div className="aspect-[3/4] bg-muted relative">
        {img.media === 'video' ? (
          <>
            {/* preload="metadata" pulls just enough to render the first frame as
                the tile poster, without streaming the whole clip. */}
            <video
              src={img.url}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            />
            <span className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="h-3.5 w-3.5 fill-current" />
            </span>
          </>
        ) : (
          <Image
            src={img.thumbnailUrl}
            alt={img.metadata.prompt ?? img.filename}
            fill
            loading="lazy"
            decoding="async"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            unoptimized
            sizes="(max-width: 640px) 33vw, (max-width: 1536px) 20vw, 14vw"
          />
        )}
      </div>

      {img.favorite && (
        <div className="absolute top-2 right-2">
          <Heart className="h-4 w-4 fill-rose-500 text-rose-500 drop-shadow-md" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent p-2.5 pt-6 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
        <p className="text-white text-[10px] leading-snug line-clamp-2">
          {img.metadata.prompt ?? img.filename}
        </p>
      </div>
    </div>
  )
}
