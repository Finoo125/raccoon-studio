'use client'

import { useState } from 'react'
import { Shuffle, Plus, Trash2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import type { WildcardLists } from '@/lib/prompts/store'

export default function WildcardManager({ lists, onChange, onInsert }: {
  lists: WildcardLists
  onChange: (lists: WildcardLists) => void
  onInsert: (token: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const draftFor = (name: string) => drafts[name] ?? (lists[name] ?? []).join('\n')

  const put = async (name: string, text: string) => {
    const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
    const res = await fetch('/api/prompts/wildcards', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, items }),
    })
    onChange((await res.json()).wildcards)
    toast.success(`Saved __${name}__`)
  }

  const create = async () => {
    const n = newName.trim().replace(/[^A-Za-z0-9_-]/g, '')
    if (!n) return
    await put(n, '')
    setNewName('')
  }

  const remove = async (name: string) => {
    const res = await fetch(`/api/prompts/wildcards?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
    onChange((await res.json()).wildcards)
  }

  const names = Object.keys(lists).sort()

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-muted-foreground" />}>
        <Shuffle className="h-3.5 w-3.5" /> Wildcards
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Wildcard lists</DialogTitle>
          <DialogDescription>Reference a list in your prompt as <code>__name__</code>; one value per line.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create() }}
            placeholder="new list name (e.g. colors)" className="h-8 text-sm" />
          <Button size="sm" className="h-8 shrink-0" onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
        <div className="mt-1 max-h-[50vh] space-y-3 overflow-y-auto">
          {names.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">No lists yet.</p>}
          {names.map((name) => (
            <div key={name} className="space-y-1.5 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <code className="text-sm text-primary">__{name}__</code>
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => onInsert(`__${name}__`)}>Insert</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void put(name, draftFor(name))}><Save className="h-3.5 w-3.5" /></Button>
                <button onClick={() => void remove(name)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <Textarea value={draftFor(name)}
                onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                className="min-h-[80px] font-mono text-xs" placeholder="one value per line" />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
