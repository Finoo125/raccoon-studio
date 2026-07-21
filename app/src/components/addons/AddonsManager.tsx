'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAddonStore } from '@/lib/addons/store'
import { Button } from '@/components/ui/button'

interface AddonInfo {
  id: string
  label: string
  href: string
  requires: { models?: { name: string; path: string; url: string }[] } | null
  unlocked: boolean
}

export default function AddonsManager() {
  const [addons, setAddons] = useState<AddonInfo[]>([])
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

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Add-ons</h1>
        <p className="text-sm text-muted-foreground">
          Supporter add-ons aren&apos;t ready yet — they&apos;ll show up here when they are.
        </p>
      </header>

      <ul className="space-y-3">
        {addons.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <span className="font-medium">{a.label}</span>
            {/* ponytail: unlock flow (key input + POST /api/addons) still lives server-side; restore this button when add-ons ship */}
            <Button variant="outline" size="sm" disabled>
              Soon Available
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
