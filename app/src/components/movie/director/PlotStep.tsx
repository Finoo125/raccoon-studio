'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CLIP_SECONDS, MIN_TARGET_SECONDS, MAX_TARGET_SECONDS,
  type DirectorRun, type DirectorImageModel,
} from '@/types/director'

const IMAGE_MODELS: { id: DirectorImageModel; label: string }[] = [
  { id: 'anima', label: 'Anima (anime)' },
  { id: 'z-image-turbo', label: 'Z-Image Turbo (photoreal)' },
]

export default function PlotStep({
  run, onUpdated,
}: {
  run: DirectorRun
  onUpdated: (run: DirectorRun) => void
}) {
  const [name, setName] = useState(run.name)
  const [plot, setPlot] = useState(run.plot)
  const [imageModel, setImageModel] = useState<DirectorImageModel>(run.imageModel)
  const [targetSeconds, setTargetSeconds] = useState(run.targetSeconds)
  const [ollamaModel, setOllamaModel] = useState(run.ollamaModel)
  const [models, setModels] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)

  const beatCount = Math.max(1, Math.round(targetSeconds / CLIP_SECONDS))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/director/ollama-models', { cache: 'no-store' })
        const data = (await res.json()) as { models: string[] }
        if (cancelled) return
        setModels(data.models)
        if (!ollamaModel && data.models[0]) setOllamaModel(data.models[0])
      } catch {
        /* leave empty; user sees the warning below */
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = async () => {
    if (!plot.trim()) { toast.error('Write a plot first'); return }
    if (!ollamaModel) { toast.error('Pick an Ollama model first'); return }
    setGenerating(true)
    try {
      const updated: DirectorRun = { ...run, name, plot, imageModel, targetSeconds, ollamaModel, beatCount }
      const putRes = await fetch(`/api/director/${run.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run: updated }),
      })
      if (!putRes.ok) throw new Error('save failed')

      const res = await fetch(`/api/director/${run.id}/storyboard`, { method: 'POST' })
      const data = (await res.json()) as { run?: DirectorRun; error?: string }
      if (!res.ok || !data.run) {
        toast.error(data.error ?? 'Storyboard generation failed')
        return
      }
      toast.success('Storyboard ready')
      onUpdated(data.run)
    } catch {
      toast.error('Storyboard generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <p className="font-heading text-base font-semibold">Plot</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Describe your story and pick how it gets made — the director turns it into a
          shot-by-shot storyboard you&apos;ll refine next.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {/* Main — film name + the plot, given room to breathe */}
        <div className="grid content-start gap-4 lg:order-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Film name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled film" />
          </label>

          <label className="grid min-h-0 gap-1.5">
            <span className="text-sm font-medium">Plot</span>
            <textarea
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              placeholder="Describe the story you want to film…"
              className="min-h-[16rem] w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-[24rem]"
            />
          </label>
        </div>

        {/* Sidebar — production settings + the generate action */}
        <aside className="grid content-start gap-5 rounded-xl border border-border bg-muted/20 p-4 lg:order-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Production
          </p>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Image model</span>
            <div className="grid gap-2">
              {IMAGE_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setImageModel(m.id)}
                  className={
                    'rounded-lg border px-3 py-2 text-left text-sm transition-colors ' +
                    (imageModel === m.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Ollama model</span>
            <select
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {models.length === 0 && <option value="">No models found</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {models.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No Ollama models detected. Start Ollama and `ollama pull` a model.
              </span>
            )}
          </label>

          <label className="grid gap-1.5">
            <span className="flex items-baseline justify-between text-sm font-medium">
              Target length
              <span className="text-xs font-normal text-muted-foreground">
                {targetSeconds}s · {beatCount} beats
              </span>
            </span>
            <input
              type="range"
              min={MIN_TARGET_SECONDS}
              max={MAX_TARGET_SECONDS}
              step={CLIP_SECONDS}
              value={targetSeconds}
              onChange={(e) => setTargetSeconds(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <span className="text-xs text-muted-foreground">{CLIP_SECONDS}s per clip</span>
          </label>

          <Button size="lg" className="w-full" disabled={generating} onClick={() => void generate()}>
            {generating ? 'Generating storyboard…' : 'Generate storyboard'}
          </Button>
        </aside>
      </div>
    </div>
  )
}
