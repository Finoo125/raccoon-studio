'use client'

import { useRef } from 'react'
import { Plus, X, Loader2, History, Images, ScanFace, LayoutGrid } from 'lucide-react'
import { useImagePicker } from './PickImageDialog'
import { headSwapChipDisabled, editPictureLimit, type EditChip, type BfsVariant } from '@/lib/workflows/qwen21'
import { inputViewUrl } from '@/lib/generation/upload'

interface Props {
  /** ComfyUI input-dir filenames, picture order, gap-free. */
  pictures: string[]
  slots: number
  chip?: EditChip
  bfsVariant: BfsVariant
  /** Which BFS files ComfyUI lists. */
  bfsInstalled: Record<BfsVariant, boolean>
  /** An upload is in flight. */
  busy: boolean
  /** Newest finished result, offered as "add the last result"; null when none. */
  lastResultUrl: string | null
  onAddFile: (file: File) => void
  onAddUrl: (url: string) => void
  onRemove: (index: number) => void
  onChip: (chip: EditChip) => void
  onBfsVariant: (variant: BfsVariant) => void
  /** Simple: the step names the slots and its own "What to do" step holds the chips. */
  simple?: boolean
}

/**
 * The Qwen-Image 2.1 Edit preset's pictures: slot 1 is the picture being
 * edited, 2-4 are references. Slots fill in order — only the next empty one
 * takes a picture, and removing one shifts the rest left — so a slot's number
 * is always the picture number an instruction names. The chips fill the
 * instruction (the form owns the params); this component only drives the UI.
 */
export default function EditPicturesInput({
  pictures, slots, chip, bfsVariant, bfsInstalled, busy, lastResultUrl,
  onAddFile, onAddUrl, onRemove, onChip, onBfsVariant, simple = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { openPicker, pickerDialog } = useImagePicker(fileRef, onAddFile)
  const label = (i: number) =>
    i === 0 ? 'Picture to edit' : chip === 'bfs' && i === 1 ? 'Head to bring in' : `Picture ${i + 1}`
  const anyBfs = bfsInstalled.alternative || bfsInstalled['v1.1']
  // Slots past what the chip's instruction names never reach the graph.
  const limit = editPictureLimit(chip)
  const chipName = chip === 'bfs' ? 'Head swap' : 'Character sheet'
  const chipClass = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-45 ${
      on ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/50'
    }`

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onAddFile(f)
          if (fileRef.current) fileRef.current.value = ''
        }}
      />
      {pickerDialog}
      {!simple && (
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Images className="h-4 w-4 text-primary" /> Pictures
        </p>
      )}
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: slots }, (_, i) => {
          const name = pictures[i]
          const isNext = i === pictures.length
          const unused = i >= limit
          return (
            <div
              key={i}
              className={`min-w-0 space-y-1${unused ? ' opacity-40' : ''}`}
              title={unused ? `Not used by ${chipName}` : undefined}
            >
              {name ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ComfyUI input via the local proxy */}
                  <img src={inputViewUrl(name)} alt={label(i)} className="aspect-square w-full rounded-lg object-cover ring-1 ring-border" />
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove ${label(i)}`}
                    className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 hover:bg-background"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={!isNext || busy}
                  aria-label={`Add ${label(i)}`}
                  className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border bg-background hover:bg-muted/50 disabled:opacity-40"
                >
                  {busy && isNext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </button>
              )}
              <p className="truncate text-center text-[11px] text-muted-foreground">
                {unused ? 'Not used' : label(i)}{i === 0 ? ' *' : ''}
              </p>
            </div>
          )
        })}
      </div>
      {lastResultUrl && pictures.length < slots && (
        <button
          type="button"
          onClick={() => onAddUrl(lastResultUrl)}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-60"
        >
          <History className="h-3.5 w-3.5" /> Add the last result
        </button>
      )}

      {!simple && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={chip === 'bfs'}
              disabled={headSwapChipDisabled(bfsInstalled, chip)}
              title={anyBfs ? 'Swap the whole head, hair included, from picture 2 into picture 1' : 'Get the BFS head-swap LoRA on the Models page'}
              onClick={() => onChip('bfs')}
              className={chipClass(chip === 'bfs')}
            >
              <ScanFace className="h-4 w-4" /> Head swap (BFS)
            </button>
            <button
              type="button"
              aria-pressed={chip === 'sheet'}
              title="Turn the person in picture 1 into a three-view character sheet for MiniMax H3"
              onClick={() => onChip('sheet')}
              className={chipClass(chip === 'sheet')}
            >
              <LayoutGrid className="h-4 w-4" /> Character sheet
            </button>
          </div>
          {!anyBfs && (
            <p className="text-xs text-muted-foreground">Head swap needs the BFS LoRA — get it on the Models page.</p>
          )}

          {chip === 'bfs' && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {(['alternative', 'v1.1'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={bfsVariant === v}
                    onClick={() => onBfsVariant(v)}
                    className={chipClass(bfsVariant === v)}
                  >
                    {v === 'alternative' ? 'Alternative' : 'v1.1'}
                    {!bfsInstalled[v] && <span className="text-xs text-muted-foreground"> — not installed</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Alternative held likeness and body better in our test; v1.1 is the author&apos;s pick. Only swap in a person who has agreed to it.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
