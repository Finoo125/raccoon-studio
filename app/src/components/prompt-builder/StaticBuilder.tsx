'use client'

import { useState } from 'react'
import { Shuffle, X } from 'lucide-react'
import { TEMPLATES, assemblePrompt, randomSelection, type PromptMode } from '@/lib/prompt-builder/templates'

/**
 * Renders the chip categories for `mode` and reports the assembled prompt on
 * every change. The parent keys this component by `mode`, so a mode switch
 * remounts it and resets selections — no reset effect needed.
 */
export default function StaticBuilder({
  mode,
  onPrompt,
}: {
  mode: PromptMode
  onPrompt: (text: string) => void
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})

  const toggle = (catId: string, optId: string) => {
    const cur = selected[catId] ?? []
    const nextCat = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId]
    const next = { ...selected, [catId]: nextCat }
    setSelected(next)
    onPrompt(assemblePrompt(mode, next))
  }

  const randomize = () => {
    const next = randomSelection(mode)
    setSelected(next)
    onPrompt(assemblePrompt(mode, next))
  }

  const clear = () => {
    setSelected({})
    onPrompt('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          onClick={randomize}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          <Shuffle className="h-4 w-4" /> Randomize
        </button>
        <button
          onClick={clear}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" /> Clear
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {TEMPLATES[mode].map((cat) => (
        <div key={cat.id} className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-sm font-medium text-foreground">{cat.label}</div>
          <div className="flex flex-wrap gap-2">
            {cat.options.map((opt) => {
              const on = (selected[cat.id] ?? []).includes(opt.id)
              return (
                <button
                  key={opt.id}
                  onClick={() => toggle(cat.id, opt.id)}
                  className={
                    'rounded-full border px-3 py-1 text-xs ' +
                    (on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground')
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}
