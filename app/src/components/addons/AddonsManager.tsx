'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAddonStore } from '@/lib/addons/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Corrected to the real workers.dev URL during creator setup (worker/CREATOR-SETUP.md).
const UNLOCK_URL = 'https://raccoon-unlock.finoo125.workers.dev'

interface AddonInfo {
  id: string
  label: string
  href: string
  requires: { models?: { name: string; path: string; url: string }[] } | null
  unlocked: boolean
}

export default function AddonsManager() {
  const [addons, setAddons] = useState<AddonInfo[]>([])
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const setUnlocked = useAddonStore((s) => s.setUnlocked)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/addons', { cache: 'no-store' })
    const data = (await res.json()) as { unlocked: string[]; addons: AddonInfo[] }
    setAddons(data.addons)
    setUnlocked(data.unlocked)
  }, [setUnlocked])

  // refresh() awaits before any setState, so this is not a synchronous render cascade.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [refresh])

  const ensureModels = async (features: string[], currentAddons: AddonInfo[]) => {
    const wanted = currentAddons.filter((a) => features.includes(a.id))
    for (const a of wanted) {
      for (const m of a.requires?.models ?? []) {
        // Reuse the existing download endpoint; it is idempotent / skips present files.
        await fetch('/api/models/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: m.name, path: m.path, url: m.url }),
        }).catch(() => {})
      }
    }
  }

  const unlock = async () => {
    if (!key.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error(`That key didn't work (${data.reason ?? 'invalid'}).`)
        return
      }
      toast.success('Unlocked! The feature is now in your menu.')
      setKey('')
      await refresh()
      // Ensure any required ComfyUI models for newly-unlocked add-ons.
      // Pass current addons snapshot to avoid stale closure over the pre-refresh list.
      const freshRes = await fetch('/api/addons', { cache: 'no-store' })
      const freshData = (await freshRes.json()) as { unlocked: string[]; addons: AddonInfo[] }
      await ensureModels(data.features as string[], freshData.addons)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Add-ons</h1>
        <p className="text-sm text-muted-foreground">
          Unlock Patreon-supporter features with the key from your Patreon page.
        </p>
        <a
          href={UNLOCK_URL}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline underline-offset-4"
        >
          Get your unlock key with your Patreon login &rarr;
        </a>
      </header>

      <div className="flex gap-2">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your unlock key"
          className="font-mono text-xs"
        />
        <Button onClick={() => void unlock()} disabled={busy || !key.trim()}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>

      <ul className="space-y-3">
        {addons.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <span className="font-medium">{a.label}</span>
            <span className={a.unlocked ? 'text-green-500 text-sm font-medium' : 'text-muted-foreground text-sm'}>
              {a.unlocked ? 'Unlocked ✓' : 'Locked'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
