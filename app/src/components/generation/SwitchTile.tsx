'use client'

import type { ReactNode } from 'react'
import { Info, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** The little on/off track every switch on the Generate panel draws. */
export function Knob({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-input'}`}>
      <span
        className={`pointer-events-none mt-0.5 inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform ${
          on ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </span>
  )
}

interface SwitchTileProps {
  label: string
  icon?: LucideIcon
  on: boolean
  onToggle: () => void
  disabled?: boolean
  /** What the switch does — shown on hover. */
  hint?: string
  /** Why it is disabled or forced on — always visible, under the row. */
  note?: string
}

/**
 * A compact switch for a row of switches (`flex flex-wrap`): the switches share
 * the row's width equally, however many a preset shows. Its `note` and any
 * {@link TileBody} carry `order-last basis-full`, so whatever a switch opens
 * lands under the whole row and no switch moves when another is turned on.
 * Components that own a switch and its settings render both as siblings (a
 * `contents` wrapper) to take part in that ordering.
 */
export function SwitchTile({ label, icon: Icon, on, onToggle, disabled, hint, note }: SwitchTileProps) {
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        title={note ?? hint}
        className={`flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed ${
          on ? 'border-primary/40 bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50'
        } ${disabled && !on ? 'opacity-55' : ''}`}
      >
        <Knob on={on} />
        {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
        <span className="truncate">{label}</span>
      </button>
      {note && (
        <p className="order-last basis-full text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{label}:</span> {note}
        </p>
      )}
    </>
  )
}

/** Settings a switched-on {@link SwitchTile} opens, placed under its row. */
export function TileBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="order-last basis-full space-y-2 rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

/** ⓘ — long explanations live here instead of standing on the panel. */
export function InfoTip({ children, label = 'More info' }: { children: ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[60vh] w-96 max-w-[90vw] space-y-2 overflow-y-auto p-3 text-xs leading-relaxed text-muted-foreground"
        align="start"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
