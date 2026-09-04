'use client'

import { useState } from 'react'
import { Trash2, Heart, Tag, Download, Columns2, X, CheckSquare, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useGalleryStore } from '@/lib/gallery/store'
import { orderClipsForJoin } from '@/lib/video/join'

export default function GalleryBulkBar({ onCompare, onJoined }: { onCompare: () => void; onJoined: () => void }) {
  const { selectedIds, images, clearSelection, selectAll, removeImages } = useGalleryStore()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [tagValue, setTagValue] = useState('')
  const [joining, setJoining] = useState(false)

  if (selectedIds.length === 0) return null
  const count = selectedIds.length
  const selectedItems = images.filter((i) => selectedIds.includes(i.id))
  const allVideos = selectedItems.length > 0 && selectedItems.every((i) => i.media === 'video')

  const doDelete = async () => {
    const res = await fetch('/api/gallery/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds }),
    })
    const { deleted } = (await res.json()) as { deleted: string[] }
    removeImages(deleted)
    toast.success(`Deleted ${deleted.length} item${deleted.length === 1 ? '' : 's'}`)
  }

  const doFavorite = async () => {
    await Promise.all(selectedIds.map((id) =>
      fetch('/api/gallery/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value: true }),
      })))
    selectedIds.forEach((id) => {
      const img = images.find((i) => i.id === id)
      if (img && !img.favorite) useGalleryStore.getState().toggleFavorite(id)
    })
    toast.success(`Favorited ${count}`)
  }

  const doTag = async () => {
    const tag = tagValue.trim()
    if (!tag) return
    await fetch('/api/gallery/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, add: tag }),
    })
    useGalleryStore.setState((s) => ({
      images: s.images.map((i) =>
        selectedIds.includes(i.id) && !i.tags?.includes(tag)
          ? { ...i, tags: [...(i.tags ?? []), tag] } : i),
    }))
    setTagOpen(false); setTagValue('')
    toast.success(`Tagged ${count} with "${tag}"`)
  }

  /**
   * Concatenate the selected clips into one file.
   *
   * Ordered by creation time rather than by what was clicked first — see
   * `orderClipsForJoin`. The server re-checks that the clips actually match
   * (codec, size, and especially the 32 kHz audio rate), because a stream copy
   * cannot change format partway and fails silently when it has to.
   */
  const doJoin = async () => {
    setJoining(true)
    try {
      const ordered = orderClipsForJoin(selectedItems)
      const res = await fetch('/api/video/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: ordered.map((c) => ({ filename: c.filename, subfolder: c.subfolder })),
        }),
      })
      const data = (await res.json()) as { filename?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Join failed (${res.status})`)
      onJoined()
      clearSelection()
      toast.success(`Joined ${ordered.length} clips into ${data.filename}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Join failed')
    } finally {
      setJoining(false)
    }
  }

  const doDownload = () => {
    selectedItems.forEach((img, idx) => {
      // Stagger so the browser doesn't drop simultaneous downloads.
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = img.url; a.download = img.filename
        document.body.appendChild(a); a.click(); a.remove()
      }, idx * 300)
    })
    toast.success(`Downloading ${count}…`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/[0.06] px-4 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => selectAll(images.map((i) => i.id))}>
        <CheckSquare className="h-3.5 w-3.5" /> Select all
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void doFavorite()}>
        <Heart className="h-3.5 w-3.5" /> Favorite
      </Button>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setTagOpen((v) => !v)}>
        <Tag className="h-3.5 w-3.5" /> Tag
      </Button>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={doDownload}>
        <Download className="h-3.5 w-3.5" /> Download
      </Button>
      <Button size="sm" variant="outline" className="h-8 gap-1.5"
        disabled={count < 2 || count > 4} onClick={onCompare} title="Select 2–4 to compare">
        <Columns2 className="h-3.5 w-3.5" /> Compare
      </Button>
      {/* Videos only, and never mixed with stills: the join is a stream copy,
          so anything that is not a clip of the same shape cannot go in it. */}
      <Button size="sm" variant="outline" className="h-8 gap-1.5"
        disabled={joining || count < 2 || !allVideos}
        onClick={() => void doJoin()}
        title={allVideos ? 'Join the selected clips into one video, oldest first' : 'Select two or more videos'}>
        {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        Join clips
      </Button>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto h-8 gap-1.5" onClick={clearSelection}>
        <X className="h-3.5 w-3.5" /> Clear
      </Button>

      {tagOpen && (
        <div className="flex w-full items-center gap-2 pt-1">
          <Input autoFocus value={tagValue} onChange={(e) => setTagValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doTag() }}
            placeholder="Tag name…" className="h-8 max-w-xs text-sm" />
          <Button size="sm" className="h-8" onClick={() => void doTag()}>Add tag</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen} onOpenChange={setConfirmOpen}
        title={`Delete ${count} item${count === 1 ? '' : 's'}?`}
        description="This permanently removes the files from disk and cannot be undone."
        confirmLabel="Delete" destructive onConfirm={() => void doDelete()}
      />
    </div>
  )
}
