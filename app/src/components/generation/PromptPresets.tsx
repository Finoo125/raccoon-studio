'use client'

import { useState } from 'react'
import { Bookmark, Trash2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PromptPreset } from '@/lib/prompts/store'

export default function PromptPresets({ prompt, negative, onApply }: {
  prompt: string
  negative?: string
  onApply: (p: { prompt: string; negative?: string }) => void
}) {
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [name, setName] = useState('')

  const load = async () => {
    try { setPresets((await (await fetch('/api/prompts/presets')).json()).presets) } catch { /* offline */ }
  }

  const save = async () => {
    const n = name.trim()
    if (!n) return
    if (!prompt.trim()) { toast.error('Enter a prompt first'); return }
    const res = await fetch('/api/prompts/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, prompt, negative }),
    })
    setPresets((await res.json()).presets); setName('')
    toast.success(`Saved preset "${n}"`)
  }

  const remove = async (id: string) => {
    setPresets((await (await fetch(`/api/prompts/presets?id=${id}`, { method: 'DELETE' })).json()).presets)
  }

  return (
    <Popover onOpenChange={(o) => { if (o) void load() }}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-muted-foreground" />}>
        <Bookmark className="h-3.5 w-3.5" /> Presets
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            placeholder="Save current as…" className="h-8 text-sm" />
          <Button size="sm" className="h-8 shrink-0" onClick={() => void save()}><Save className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
          {presets.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No presets yet.</p>}
          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <button className="flex-1 truncate text-left text-sm hover:text-primary"
                onClick={() => onApply({ prompt: p.prompt, negative: p.negative })} title={p.prompt}>
                {p.name}
              </button>
              <button onClick={() => void remove(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
