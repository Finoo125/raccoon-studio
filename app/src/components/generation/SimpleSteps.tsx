'use client'

import Link from 'next/link'
import { setUiMode } from '@/lib/ui-mode'

export interface SimpleStep { title: string; action?: React.ReactNode; body: React.ReactNode }

/** Simple's numbered steps, top to bottom in reading order (spec §2). */
export function SimpleSteps({ steps }: { steps: SimpleStep[] }) {
  return (
    <ol className="space-y-5">
      {steps.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[1.5rem_1fr] gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#ffa64d] text-xs font-bold text-primary-foreground">
            {i + 1}
          </span>
          <div className="min-w-0 space-y-2">
            <div className="flex min-h-6 items-center justify-between gap-2">
              <h3 className="text-sm font-semibold tracking-tight">{s.title}</h3>
              {s.action}
            </div>
            {s.body}
          </div>
        </li>
      ))}
    </ol>
  )
}

export interface SimpleCard { key: string; name: string; blurb: string; selected: boolean; onPick: () => void }

/** One flat card per model this install has — no family/variant layers (spec: model choice "A"). */
export function SimpleModelCards({ cards }: { cards: SimpleCard[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            // title = the model's name: the wiki capture's `[title="Anima Turbo"]` works in both modes.
            title={c.name}
            aria-pressed={c.selected}
            onClick={c.onPick}
            className={`rounded-xl border p-2.5 text-left transition-colors ${
              c.selected ? 'border-primary/60 bg-primary/[0.09]' : 'border-border bg-muted/20 hover:bg-muted/40'
            }`}
          >
            <span className="block text-sm font-semibold leading-tight">{c.name}</span>
            <span className="mt-1 block text-xs leading-snug text-muted-foreground line-clamp-2">{c.blurb}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Only the models you have are listed.{' '}
        <Link href="/models" className="font-medium text-foreground underline">Get more models</Link>
      </p>
    </div>
  )
}

/** The last line of every Simple page: what Advanced adds, with a link that switches. */
export function SimpleMoreHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {children} are in{' '}
      <button type="button" onClick={() => setUiMode('advanced')} className="font-medium text-foreground underline">
        Advanced
      </button>
      .
    </p>
  )
}
