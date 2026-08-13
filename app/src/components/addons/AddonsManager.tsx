'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, Lock } from 'lucide-react'
import { useAddonStore } from '@/lib/addons/store'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PATREON_PAGE, UNLOCK_URL } from '@/lib/addons/membership'
import { cn } from '@/lib/utils'

interface AddonInfo {
  id: string
  label: string
  href: string
  requires: { models?: { name: string; path: string; url: string }[] } | null
  /** 'soon' = listed but not on sale yet; null = on sale. See registry.ts. */
  release: 'soon' | 'unlisted' | null
  unlocked: boolean
}

/**
 * Why a key was refused, in the user's terms. The API returns `verifyKey`'s
 * reason codes verbatim; showing those raw ("bad-signature") tells someone
 * nothing about what to do next, and the two cases that actually need different
 * actions — a typo versus a lapsed membership — look identical otherwise.
 */
const REFUSAL: Record<string, string> = {
  malformed: 'That does not look like a complete key — copy the whole line from Patreon, including the dot.',
  'bad-signature': 'That key was not issued for Raccoon Studio, or it was altered in transit. Paste it again straight from the source.',
  expired: 'That key has expired. Renewing the Patreon membership issues a fresh one.',
  revoked: 'That key has been revoked. Get in touch on Patreon if you think that is wrong.',
  unsupported: 'That key was made for a newer version of Raccoon Studio — update the app and try again.',
  'no-public-key': 'This build cannot check keys yet. That is a packaging fault, not something you did wrong.',
  'bad-request': 'Nothing was submitted — paste a key first.',
}

export default function AddonsManager() {
  const [addons, setAddons] = useState<AddonInfo[]>([])
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justUnlocked, setJustUnlocked] = useState<string[]>([])
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

  const activate = useCallback(async () => {
    const trimmed = key.trim()
    if (!trimmed) {
      setError(REFUSAL['bad-request'])
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      })
      const data = (await res.json()) as
        | { ok: true; features: string[] }
        | { ok: false; reason: string }
      if (!data.ok) {
        setError(REFUSAL[data.reason] ?? `That key was refused (${data.reason}).`)
        return
      }
      // A validly-signed key that grants nothing this build has released yet.
      // It is still stored, so it starts working the day that add-on ships.
      if (data.features.length === 0) {
        setError('That key checks out, but none of the add-ons it covers are available yet. It stays installed and will start working as soon as they are.')
        return
      }
      // The key is stored server-side; re-read rather than trusting the response,
      // so the list reflects every installed key and not just this one.
      setJustUnlocked(data.features)
      setKey('')
      await refresh()
    } catch {
      setError('Could not reach the app to check that key. Is Raccoon Studio still running?')
    } finally {
      setBusy(false)
    }
  }, [key, refresh])

  // Only the ones a key can actually unlock — the footer below talks about keys,
  // which says nothing useful about a "Soon available" row.
  const locked = addons.filter((a) => !a.unlocked && !a.release)

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Patreon</h1>
        {/* Spelled out as two numbered steps. The previous copy assumed you
            already had a key and only explained where to paste it, which left
            anyone without one staring at a row that said "Locked" and nothing
            else. */}
        <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
          <li>
            Support on{' '}
            <a href={PATREON_PAGE} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
              Patreon
            </a>{' '}
            — skip this if you already do.
          </li>
          <li>
            <a href={UNLOCK_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
              Log in with Patreon
            </a>{' '}
            to get your personal key.
          </li>
          <li>Paste it below. It stays active on this machine, and covers new add-ons as they ship.</li>
        </ol>
      </header>

      {/* data-tour: rung by the first-run tour's Patreon step — the key box is
          the one thing that page asks anything of you. */}
      <div data-tour="/add-ons" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <label htmlFor="addon-key" className="text-sm font-medium">
          Membership key
        </label>
        <div className="flex gap-2">
          <Input
            id="addon-key"
            value={key}
            placeholder="Paste your key here"
            spellCheck={false}
            autoComplete="off"
            className="h-9 flex-1 min-w-0 font-mono text-sm"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setKey(e.target.value); setError(null) }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void activate() }}
          />
          <Button className="h-9 shrink-0 px-4" disabled={busy} onClick={() => void activate()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Activate'}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && justUnlocked.length > 0 && (
          <p className="text-xs text-primary">
            Key accepted — unlocked {justUnlocked.length} add-on{justUnlocked.length === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {addons.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
          >
            <span className="flex items-center gap-2 font-medium">
              {!a.unlocked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              {a.label}
            </span>
            {a.unlocked ? (
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary">
                <Check className="h-4 w-4" /> Active
              </span>
            ) : a.release === 'soon' ? (
              // Listed so people can see it coming, but no key unlocks it yet —
              // so it must not offer one. A disabled button, not a hidden row.
              <Button variant="outline" size="sm" disabled className="shrink-0">
                Soon available
              </Button>
            ) : (
              // A locked row needs somewhere to go, and that somewhere is the
              // unlock flow — NOT the campaign page. Logging in with Patreon is
              // what actually produces a key; the campaign page just describes
              // the membership and leaves the user to find the flow themselves.
              //
              // An <a> styled with buttonVariants rather than a <Button>: this
              // Button has no `asChild`, so wrapping the link would nest an
              // anchor inside a button — invalid HTML, and middle-click and
              // "open in new tab" both stop working.
              <a
                href={UNLOCK_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
              >
                Get a key <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            )}
          </li>
        ))}
      </ul>

      {locked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Locked add-ons stay hidden in the app until a key unlocks them. Nothing else changes —
          the rest of Raccoon Studio works the same either way.
        </p>
      )}
    </div>
  )
}
