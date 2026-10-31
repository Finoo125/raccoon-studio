'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Check, Clapperboard, ExternalLink, Film, Loader2, Lock, Package, PencilRuler, Puzzle,
  SlidersHorizontal, type LucideIcon,
} from 'lucide-react'
import { useAddonStore } from '@/lib/addons/store'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SUBSCRIBE_PAGES, UNLOCK_URL } from '@/lib/addons/membership'
import { cn } from '@/lib/utils'

interface AddonInfo {
  id: string
  label: string
  href: string
  /** lucide-react icon name from the registry. */
  icon: string
  /** One line on what it does. */
  blurb: string | null
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
/** The registry's icon names for add-ons; anything else falls back to a puzzle piece. */
const ICONS: Record<string, LucideIcon> = { SlidersHorizontal, Clapperboard, Package, Film, PencilRuler }

const REFUSAL: Record<string, string> = {
  malformed: 'That does not look like a complete key — copy the whole line from the unlock page, including the dot.',
  'bad-signature': 'That key was not issued for Raccoon Studio, or it was altered in transit. Paste it again straight from the source.',
  expired: 'That key has expired. Renewing your subscription issues a fresh one.',
  revoked: 'That key has been revoked. Get in touch if you think that is wrong.',
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
  const [loaded, setLoaded] = useState(false)
  const setUnlocked = useAddonStore((s) => s.setUnlocked)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/addons', { cache: 'no-store' })
    const data = (await res.json()) as { unlocked: string[]; addons: AddonInfo[] }
    setAddons(data.addons)
    setUnlocked(data.unlocked)
    setLoaded(true)
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
  // Everything a key can unlock is unlocked: the how-to steps have done their
  // job and fold to one line. Waits for the list, or a supporter would watch
  // the steps flash up and vanish on every visit.
  const allActive = loaded && addons.length > 0 && locked.length === 0

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6 md:p-8">
      {/* Header — the same shape as the Models page's. */}
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight leading-none">Supporters</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Extra tools for supporters, unlocked with a personal key.
          </p>
        </div>
      </div>

      {/* Spelled out as three steps. The previous copy assumed you already had a
          key and only explained where to paste it, which left anyone without one
          staring at a row that said "Locked" and nothing else. */}
      {allActive ? (
        <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-2.5 text-sm">
          <Check className="h-4 w-4 shrink-0 text-primary" />
          All supporter features are active on this machine.
        </p>
      ) : loaded && (
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Step n={1}>
            Subscribe on{' '}
            {SUBSCRIBE_PAGES.map((p, i) => (
              <Fragment key={p.href}>
                {i > 0 && ' or '}
                <a href={p.href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
                  {p.label}
                </a>
              </Fragment>
            ))}{' '}
            — skip this if you already do.
          </Step>
          <Step n={2}>
            <a href={UNLOCK_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
              Log in with {SUBSCRIBE_PAGES.map((p) => p.label).join(' or ')}
            </a>{' '}
            to get your personal key.
          </Step>
          {/* Not "covers new add-ons as they ship": a key lists its add-ons
              explicitly, so a new one needs a fresh key (the unlock page says so too). */}
          <Step n={3}>Paste it below. It stays active on this machine; a new add-on needs a fresh key.</Step>
        </ol>
      )}

      {/* data-tour: rung by the first-run tour's Supporters step — the key box is
          the one thing that page asks anything of you. */}
      <div data-tour="/add-ons" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <label htmlFor="addon-key" className="text-sm font-medium">
          Unlock key
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

      {/* One equal card per add-on: what it is, what it does, where it stands,
          and the one thing to do next. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {addons.map((a) => {
          const Icon = ICONS[a.icon] ?? Puzzle
          return (
            <li
              key={a.id}
              className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${a.unlocked ? 'border-primary/30' : 'border-border'}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{a.label}</p>
                  {a.blurb && <p className="mt-1 text-xs leading-snug text-muted-foreground">{a.blurb}</p>}
                </div>
                {a.unlocked ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                    <Check className="h-3.5 w-3.5" /> Active
                  </span>
                ) : a.release === 'soon' ? (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">Soon</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> Locked
                  </span>
                )}
              </div>
              <div className="mt-auto flex justify-end">
                {a.unlocked ? (
                  <Link href={a.href} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}>
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : a.release === 'soon' ? (
                  // Listed so people can see it coming, but no key unlocks it yet —
                  // so it must not offer one. A disabled button, not a hidden card.
                  <Button variant="outline" size="sm" disabled>
                    Soon available
                  </Button>
                ) : (
                  // A locked card needs somewhere to go, and that somewhere is the
                  // unlock flow — NOT the campaign page. Logging in there is
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
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Get a key <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </li>
          )
        })}
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

/** One of the three how-to-unlock steps, as an equal card. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}
