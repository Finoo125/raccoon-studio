'use client'

import { useState } from 'react'
import { Ban, Clapperboard, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DirectorRun } from '@/types/director'

export default function StoryboardStep({
  run, onUpdated,
}: {
  run: DirectorRun
  onUpdated: (run: DirectorRun) => void
}) {
  const [openingImagePrompt, setOpeningImagePrompt] = useState(run.openingImagePrompt)
  const [negativePrompt, setNegativePrompt] = useState(run.negativePrompt ?? '')
  const [beats, setBeats] = useState(run.beats.map((b) => b.videoPrompt))
  const [saving, setSaving] = useState(false)

  const setBeat = (i: number, text: string) =>
    setBeats((prev) => prev.map((b, idx) => (idx === i ? text : b)))

  const save = async (advance: boolean) => {
    setSaving(true)
    try {
      const updated: DirectorRun = {
        ...run,
        openingImagePrompt,
        negativePrompt: negativePrompt.trim() || undefined,
        beats: run.beats.map((b, i) => ({ ...b, videoPrompt: beats[i] ?? b.videoPrompt })),
        status: advance ? 'opening-image' : run.status,
      }
      const res = await fetch(`/api/director/${run.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run: updated }),
      })
      const data = (await res.json()) as { run?: DirectorRun; error?: string }
      if (!res.ok || !data.run) { toast.error(data.error ?? 'Save failed'); return }
      toast.success(advance ? 'Storyboard locked' : 'Saved')
      onUpdated(data.run)
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <p className="font-heading text-base font-semibold">Storyboard</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Review and fine-tune each shot before the film is rendered. The opening frame
          sets the look; every shot becomes one ~15s clip in sequence.
        </p>
      </div>

      {/* Scene setup — the establishing frame + what to avoid, full width on top */}
      <section className="grid gap-4">
        <GroupHeader>Scene setup</GroupHeader>

        <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-[2fr_1fr]">
          <Field
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            label="Opening frame"
            hint="The very first image of the film — describe the subject, setting, and mood."
          >
            <textarea
              value={openingImagePrompt}
              onChange={(e) => setOpeningImagePrompt(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field
            icon={<Ban className="h-3.5 w-3.5" />}
            label="Avoid"
            hint="Things to keep out of every shot — blur, watermarks, extra fingers…"
          >
            <Input value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Shot sequence — the storyboard proper, three roomy numbered panels per row */}
      <section className="grid gap-4">
        <GroupHeader>
          <span className="inline-flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5" /> Shot sequence
          </span>
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            {beats.length} {beats.length === 1 ? 'shot' : 'shots'}
          </span>
        </GroupHeader>

        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {beats.map((b, i) => (
            <li
              key={i}
              className="flex flex-col rounded-xl border border-border bg-card p-3 transition-colors focus-within:border-primary/40"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-heading text-sm font-semibold text-primary ring-1 ring-primary/20">
                  {i + 1}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Shot {i + 1}
                  <span className="ml-1 font-normal normal-case tracking-normal">· ~15s clip</span>
                </span>
              </div>
              <textarea
                value={b}
                onChange={(e) => setBeat(i, e.target.value)}
                rows={7}
                className="min-h-[10rem] w-full flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </li>
          ))}
        </ol>
      </section>

      <div className="flex gap-2">
        <Button size="lg" variant="outline" disabled={saving} onClick={() => void save(false)}>
          Save draft
        </Button>
        <Button size="lg" disabled={saving} onClick={() => void save(true)}>
          Continue to opening image
        </Button>
      </div>
    </div>
  )
}

/** A labelled field with an icon and a one-line hint above its control. */
function Field({
  icon, label, hint, children,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  )
}

/** Uppercase section divider, matching the Generate Videos form's group headers. */
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
