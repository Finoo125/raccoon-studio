'use client'

import { setUiMode, useUiMode, type UiMode } from '@/lib/ui-mode'

const LABELS: Record<UiMode, string> = { simple: 'Simple', advanced: 'Advanced' }

/** The one Simple | Advanced switch, in the header of Generate Image, Generate Video, Models and Photo Editing. */
export default function SimpleAdvancedSwitch({ className = '' }: { className?: string }) {
  const mode = useUiMode()
  return (
    <div role="group" aria-label="Simple or Advanced" className={`inline-flex rounded-lg border border-border bg-muted/30 p-0.5 ${className}`}>
      {(['simple', 'advanced'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setUiMode(m)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            mode === m
              ? 'bg-gradient-to-br from-primary to-[#ffa64d] text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  )
}
