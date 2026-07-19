'use client'

import { useCallback, useState } from 'react'
import type { PromptMode } from '@/lib/prompt-builder/templates'
import StaticBuilder from './StaticBuilder'
import AiPanel from './AiPanel'
import OutputBar from './OutputBar'

type Tab = 'static' | 'enhance' | 'generate'

export default function PromptBuilder() {
  const [mode, setMode] = useState<PromptMode>('photoreal')
  const [tab, setTab] = useState<Tab>('static')
  const [prompt, setPrompt] = useState('')

  const onPrompt = useCallback((text: string) => setPrompt(text), [])

  // Switching mode changes the whole vocabulary, so start the prompt fresh.
  const switchMode = (m: PromptMode) => {
    setMode(m)
    setPrompt('')
  }

  return (
    <div className="flex w-full flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Prompt Builder</h1>
        <div className="flex gap-1 rounded-full border border-border p-1">
          {(['photoreal', 'anime'] as PromptMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={
                'rounded-full px-3 py-1 text-xs capitalize ' +
                (mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 border-b border-border">
        {([['static', 'Templates'], ['enhance', 'AI Enhance'], ['generate', 'AI Generate']] as [Tab, string][]).map(
          ([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'px-3 py-2 text-sm ' +
                (tab === id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground')
              }
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === 'static' && <StaticBuilder key={mode} mode={mode} onPrompt={onPrompt} />}
      {tab === 'enhance' && <AiPanel mode={mode} task="enhance" onPrompt={onPrompt} />}
      {tab === 'generate' && <AiPanel mode={mode} task="generate" onPrompt={onPrompt} />}

      <OutputBar prompt={prompt} onChange={setPrompt} />
    </div>
  )
}
