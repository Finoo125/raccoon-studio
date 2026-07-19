'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { PromptMode } from '@/lib/prompt-builder/templates'

export default function AiPanel({
  mode,
  task,
  onPrompt,
}: {
  mode: PromptMode
  task: 'enhance' | 'generate'
  onPrompt: (text: string) => void
}) {
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/prompt-builder/ollama-models')
        if (!res.ok) return
        const data = (await res.json()) as { models: string[] }
        setModels(data.models)
        setModel((m) => m || data.models[0] || '')
      } catch {
        /* Ollama offline — handled on run */
      }
    })()
  }, [])

  const run = async () => {
    if (!input.trim()) {
      toast.error('Enter some text first')
      return
    }
    if (!model) {
      toast.error('No Ollama model available')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/prompt-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, task, input, model }),
      })
      const data = (await res.json()) as { prompt?: string; error?: string }
      if (!res.ok || !data.prompt) {
        toast.error(data.error ?? 'Generation failed')
        return
      }
      onPrompt(data.prompt)
      toast.success(task === 'enhance' ? 'Prompt enhanced' : 'Prompt generated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="w-full rounded-md border border-input bg-background p-2 text-sm text-foreground"
      >
        {models.length === 0 && <option value="">No Ollama models found</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <textarea
        className="min-h-24 w-full resize-y rounded-md border border-input bg-background p-2 text-sm text-foreground"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={task === 'enhance' ? 'Paste a prompt to enhance…' : 'Describe your idea…'}
      />
      <button
        onClick={run}
        disabled={busy}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Working…' : task === 'enhance' ? 'Enhance with AI' : 'Generate with AI'}
      </button>
    </div>
  )
}
