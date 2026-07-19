'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useGalleryStore } from '@/lib/gallery/store'

export default function CompareOverlay({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { images, selectedIds } = useGalleryStore()
  const items = images.filter((i) => selectedIds.includes(i.id)).slice(0, 4)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open || items.length < 2) return null

  const rows: { label: string; get: (i: (typeof items)[number]) => string | undefined }[] = [
    { label: 'Prompt', get: (i) => i.metadata.prompt },
    { label: 'Model', get: (i) => i.metadata.model },
    { label: 'Sampler', get: (i) => i.metadata.sampler },
    { label: 'Steps', get: (i) => i.metadata.steps?.toString() },
    { label: 'CFG', get: (i) => i.metadata.cfg?.toString() },
    { label: 'Seed', get: (i) => i.metadata.seed?.toString() },
    { label: 'Size', get: (i) => (i.metadata.width && i.metadata.height ? `${i.metadata.width}×${i.metadata.height}` : undefined) },
    { label: 'LoRAs', get: (i) => i.metadata.loras?.join(', ') },
  ]

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-sm font-semibold text-white">Compare {items.length} items</span>
        <button onClick={() => onOpenChange(false)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20">
          <X className="h-4 w-4" /> Close
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((i) => (
            <div key={i.id} className="flex flex-col gap-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
                {i.media === 'video'
                  ? <video src={i.url} controls className="h-full w-full object-contain" />
                  : <Image src={i.url} alt={i.filename} fill unoptimized className="object-contain" />}
              </div>
              <div className="space-y-1.5 rounded-lg bg-white/5 p-3 text-xs text-white/90">
                {rows.map((r) => (
                  <div key={r.label}>
                    <span className="text-white/50">{r.label}: </span>
                    <span className="break-words">{r.get(i) ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
