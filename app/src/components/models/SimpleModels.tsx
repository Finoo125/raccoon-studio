'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DownloadModelButton from '@/components/setup/DownloadModelButton'
import { useHardware, useOnDisk } from '@/components/setup/hooks'
import { cn } from '@/lib/utils'
import {
  COMMUNITY_ROWS, NO_HARDWARE, STARTER_MODELS, fmtGb, isInstalled, recommendedFor, removalPlan,
  versionOnDiskMb, whyNot, type StarterGroup, type StarterModel,
} from '@/lib/models/starter'
import { PORTAL_URL } from '@/lib/portal'
import { PROMPT_HELPER_ADDON, useAddonLock } from '@/lib/addons/useAddonLock'
import { KREA2_TEXT_ENCODER } from '@/lib/video/describe'

const GROUPS: { id: StarterGroup; title: string }[] = [
  { id: 'photo', title: 'Photos' },
  { id: 'anime', title: 'Anime & illustration' },
  { id: 'video', title: 'Video' },
  { id: 'edit', title: 'Picture editing' },
]

/** Where "Make a picture / Make a clip" goes. Preset only — no sample prompt — so Generate keeps the saved session (presetOnlyLink). */
const openHref = (m: StarterModel) => m.opens.page === 'image' ? `/generate?workflow=${m.opens.preset}` : '/generate-videos'

const chip = 'rounded-lg border border-border bg-muted/30 px-2.5 py-1'

/** Simple Models (spec §5): your computer, your models, get more, your own models. */
export default function SimpleModels({ onSearchCivitai, onAddFile }: { onSearchCivitai: () => void; onAddFile: () => void }) {
  const { hw } = useHardware()
  const { onDisk, unknown, reload } = useOnDisk()
  const [removing, setRemoving] = useState<StarterModel | null>(null)
  // Krea2's text encoder is also Help me write's built-in writer: a supporter keeps it (owner, 2026-10-26).
  const helper = useAddonLock(PROMPT_HELPER_ADDON)
  const keep = helper.loaded && !helper.locked ? [KREA2_TEXT_ENCODER] : []
  const keptWriter = !!removing && !!onDisk && keep.length > 0 &&
    removalPlan(removing, onDisk).some((f) => f.name === KREA2_TEXT_ENCODER)
  const card = hw ?? NO_HARDWARE
  const mine = onDisk ? STARTER_MODELS.filter((m) => isInstalled(m, onDisk)) : []
  const more = STARTER_MODELS.filter((m) => !mine.includes(m))

  // Every file is tried; what stays is named. The disk scan finds a file by name anywhere
  // (subfolders, a shared models folder), the delete only at <models>/<folder>/<name>, so a
  // 404 means "lives elsewhere", not "gone".
  const remove = async (m: StarterModel) => {
    const files = onDisk ? removalPlan(m, onDisk, keep) : []
    const elsewhere: string[] = []
    const failed: string[] = []
    for (const f of files) {
      const res = await fetch('/api/models/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: f.folder, name: f.name }),
      }).catch(() => null)
      if (res?.ok) continue
      ;(res?.status === 404 ? elsewhere : failed).push(f.name)
    }
    if (!elsewhere.length && !failed.length) toast.success(`Removed ${m.name}`)
    else toast.error(`${m.name} is not fully removed`, {
      description: [
        failed.length ? `Could not delete ${failed.join(', ')} — still in use? Stop the job using it and try again.` : '',
        elsewhere.length ? `${elsewhere.join(', ')} sits in another folder (a subfolder, or a shared models folder) — delete it in Advanced → My Models.` : '',
      ].filter(Boolean).join(' '),
    })
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {hw?.gpuName && <span className={chip}>{hw.gpuName}</span>}
        {hw?.vramGb != null && <span className={chip}><b>{Math.round(hw.vramGb)} GB</b> graphics memory</span>}
        {hw?.ramGb != null && <span className={chip}><b>{Math.round(hw.ramGb)} GB</b> RAM</span>}
        {hw?.freeDiskGb != null && <span className={chip}><b>{Math.round(hw.freeDiskGb)} GB</b> free</span>}
        <Link href="/setup" className="text-xs text-muted-foreground underline">not right?</Link>
      </div>

      {unknown && (
        <p className="text-sm text-muted-foreground">
          The studio can&apos;t see this computer&apos;s models folder — use Advanced to manage files.
        </p>
      )}

      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your models <span className="text-sm font-normal text-muted-foreground">ready to use</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex items-baseline gap-2">
                  <b className="text-sm">{m.name}</b>
                  <span className="ml-auto flex items-center gap-1 text-xs text-green-500"><CheckCircle className="h-3.5 w-3.5" /> Ready</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{m.blurb}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="mr-auto text-xs text-muted-foreground">{fmtGb(versionOnDiskMb(m, onDisk!))} GB on disk</span>
                  <Link href={openHref(m)} className={cn(buttonVariants({ size: 'sm' }), 'h-8 text-xs')}>
                    {m.group === 'edit' ? 'Edit a picture' : m.opens.page === 'image' ? 'Make a picture' : 'Make a clip'}
                  </Link>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setRemoving(m)}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Get more</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {GROUPS.filter((g) => more.some((m) => m.group === g.id)).map((g) => {
            const rec = recommendedFor(g.id, card)
            return (
              <div key={g.id} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h3>
                {more.filter((m) => m.group === g.id).map((m) => {
                  const why = whyNot(m, card)
                  return (
                    <div key={m.id} className={`rounded-xl border border-border bg-card p-3.5 ${why ? 'opacity-55' : ''}`}>
                      <div className="flex items-baseline gap-2">
                        <b className="text-sm">{m.name}</b>
                        {rec?.id === m.id && <span className="rounded bg-primary/20 px-1.5 text-[10px] font-bold text-primary">fits your computer</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{m.blurb}</p>
                      {why
                        ? <p className="mt-2 text-xs text-amber-400/90">{why}</p>
                        : <div className="mt-3"><DownloadModelButton model={m} compact className="h-8 w-full text-xs" /></div>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          Your own models <span className="text-sm font-normal text-muted-foreground">SDXL, Pony, Illustrious and more, made by the community</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 text-xs" onClick={onSearchCivitai}>Search Civitai</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onAddFile}>+ Add a model file…</Button>
          {PORTAL_URL && <a href={PORTAL_URL} target="_blank" rel="noreferrer" className="text-xs underline">Aria lineup on the Portal ↗</a>}
        </div>
        <p className="text-xs text-muted-foreground">{COMMUNITY_ROWS[0].blurb}</p>
      </section>

      <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Every single file, and extras like face swap and ControlNet, are in Advanced (switch at the top).
      </p>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o) setRemoving(null) }}
        title={removing ? `Remove ${removing.name}?` : ''}
        description={removing && onDisk
          ? `Frees ${fmtGb(removalPlan(removing, onDisk, keep).reduce((n, f) => n + f.sizeMb, 0))} GB. Files another model still uses stay.` +
            (keptWriter ? ' Its text encoder stays too: Help me write’s built-in writer runs on it.' : '')
          : ''}
        confirmLabel="Remove"
        onConfirm={() => { if (removing) void remove(removing) }}
      />
    </div>
  )
}
