'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEditorStore } from './editor-store'
import { selectSelectedClip } from './editor-selectors'
import { useEditorActions } from './editor-actions'

function NumberField({
  id,
  label,
  value,
  step = 0.1,
  min,
  onCommit,
}: {
  id: string
  label: string
  value: number
  step?: number
  min?: number
  onCommit: (value: number) => void
}) {
  const commit = (raw: string) => {
    const n = parseFloat(raw)
    if (!Number.isFinite(n) || n === value) return
    onCommit(n)
  }
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        id={id}
        key={`${id}-${value}`}
        type="number"
        step={step}
        min={min}
        defaultValue={Number(value.toFixed(3))}
        className="h-7 text-xs"
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}

export default function ClipPropertiesPanel() {
  const selected = useEditorStore(selectSelectedClip)
  const actions = useEditorActions()
  const [pendingVolume, setPendingVolume] = useState<number | null>(null)

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-center text-xs text-muted-foreground">
        Select a clip on the timeline to edit its properties.
      </div>
    )
  }

  const { clip, asset } = selected
  const volume = pendingVolume ?? clip.volume

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2 min-w-0">
        <p className="text-xs font-medium truncate flex-1">{asset?.filename ?? 'Missing asset'}</p>
        <Badge variant="secondary" className="capitalize">{asset?.kind ?? '?'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="clip-start"
          label="Start (s)"
          value={clip.startSec}
          min={0}
          onCommit={(v) => {
            if (!actions.moveClip(clip.id, v)) toast.error('Position collides with another clip')
          }}
        />
        <div />
        <NumberField
          id="clip-in"
          label="In (s)"
          value={clip.inSec}
          min={0}
          onCommit={(v) => actions.trimClip(clip.id, 'start', clip.startSec + (v - clip.inSec))}
        />
        <NumberField
          id="clip-out"
          label="Out (s)"
          value={clip.outSec}
          min={0}
          onCommit={(v) => actions.trimClip(clip.id, 'end', clip.startSec + (v - clip.inSec))}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="clip-volume" className="text-[10px] text-muted-foreground">
          Volume — {Math.round(volume * 100)}%
        </Label>
        <input
          id="clip-volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          className="w-full accent-primary"
          onChange={(e) => setPendingVolume(Number(e.target.value) / 100)}
          onPointerUp={() => {
            if (pendingVolume !== null) {
              actions.setClipVolume(clip.id, pendingVolume)
              setPendingVolume(null)
            }
          }}
        />
      </div>

      <NumberField
        id="clip-crossfade"
        label="Crossfade with previous (s)"
        value={clip.crossfadeWithPrevious ?? 0}
        min={0}
        onCommit={(v) => {
          if (!actions.setCrossfade(clip.id, v)) {
            toast.error('Crossfade not possible here (first clip on track, or no room)')
          }
        }}
      />

      <Button
        variant="destructive"
        size="lg"
        className="mt-auto"
        onClick={actions.deleteSelection}
      >
        <Trash2 data-icon="inline-start" />
        Delete clip
      </Button>
    </div>
  )
}
