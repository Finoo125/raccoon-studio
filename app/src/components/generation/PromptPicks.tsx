'use client'

import { useState, type ReactNode } from 'react'
import { Check, Dices, Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  litPick, phraseOf, picksFor, rowBlock, thumbPath, visibleRows,
  type PickRow, type PickRowId, type PromptPick, type PromptStyle,
} from '@/lib/prompt-builder/picks'

const BLOCK_NOTE = { person: 'Needs a person in Who', partners: 'Needs two or more people in Who' } as const

/**
 * The Prompt Helper's picture list: every topic as a row of picture cards, with 🔒
 * keep and 🎲 per row. 18+ topics and racy picks only with `nsfw`; a row the
 * current Who cannot do is dimmed with its reason (a lit card stays clickable, so
 * it can still be removed).
 */
export default function PromptPicks({ draft, style, keep, nsfw, rows = visibleRows(nsfw), onPick, onReroll, onToggleKeep }: {
  draft: string
  style: PromptStyle
  /** Rows kept from Surprise me; omitted (with `onToggleKeep`) where there is no Surprise me. */
  keep?: ReadonlySet<PickRowId>
  nsfw: boolean
  /** Which topics to show; every one the 18+ switch allows unless a caller narrows it. */
  rows?: PickRow[]
  onPick: (row: PickRow, pick: PromptPick) => void
  onReroll: (row: PickRow) => void
  onToggleKeep?: (id: PickRowId) => void
}) {
  return (
    <div className="space-y-5">
      {rows.map((row) => {
        const lit = litPick(draft, row, style)
        const kept = keep?.has(row.id) ?? false
        const block = rowBlock(draft, row, style)
        return (
          <section key={row.id} aria-label={row.label}>
            <RowHeader emoji={row.emoji} label={row.label} kept={kept} onToggleKeep={onToggleKeep && (() => onToggleKeep(row.id))}
              onReroll={() => onReroll(row)} rerollDisabled={!!block}>
              {row.nsfw && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">18+</span>}
              {block && <span className="text-[11px] font-normal text-muted-foreground">— {BLOCK_NOTE[block]}</span>}
            </RowHeader>
            <div className="flex flex-wrap gap-1.5">
              {picksFor(row, style, nsfw).map((p) => (
                <PickCard key={`${style}-${p.id}`} emoji={row.emoji} label={p.label} src={thumbPath(row, p, style)} on={lit?.id === p.id}
                  disabled={!!block && lit?.id !== p.id} title={phraseOf(p, style)} onClick={() => onPick(row, p)} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** A row's title with its 🔒 keep and 🎲 something-else buttons; `children` follow the title (badges, notes). */
export function RowHeader({ emoji, label, kept, onToggleKeep, onReroll, rerollDisabled, children }: {
  emoji: string
  label: string
  kept: boolean
  /** Omitted: no 🔒 (nothing to keep the row from). */
  onToggleKeep?: () => void
  onReroll: () => void
  rerollDisabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {emoji} {label}
        {children}
      </h3>
      <div className="flex items-center gap-1">
        {onToggleKeep && (
          <Button type="button" size="icon-xs" variant={kept ? 'default' : 'ghost'} aria-pressed={kept}
            aria-label={`Keep ${label}`}
            title={kept ? 'Kept — Surprise me leaves this row alone' : 'Keep this row when you click Surprise me'}
            onClick={onToggleKeep}>
            {kept ? <Lock /> : <LockOpen />}
          </Button>
        )}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Something else for ${label}`}
          title="Pick something else for this row" disabled={rerollDisabled} onClick={onReroll}>
          <Dices />
        </Button>
      </div>
    </div>
  )
}

/**
 * One picture card; without `src` (or when the picture fails to load) it shows
 * `emoji`. `children` replace the picture (the camera row's moving frame).
 */
export function PickCard({ emoji, label, src, on, disabled = false, title, onClick, children }: {
  emoji: string
  label: string
  src?: string
  on: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children?: ReactNode
}) {
  const [broken, setBroken] = useState(false)
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick} disabled={disabled}
      className={`w-[92px] rounded-lg p-1 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-primary/15 ring-2 ring-primary' : 'hover:bg-muted'}`}>
      <span className="relative mx-auto block h-[84px] w-[84px] overflow-hidden rounded-md bg-muted">
        {children ?? (broken || !src ? (
          <span className="grid h-full place-items-center text-3xl" aria-hidden>{emoji}</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- small static thumbnail from /public
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ))}
        {on && (
          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </span>
      <span className="mt-1 block text-xs leading-tight">{label}</span>
    </button>
  )
}
