'use client'

import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Props {
  label: string
  value: string
  strength: number
  onChange: (lora: string, strength: number) => void
}

export default function LoraSelector({ label, value, strength, onChange }: Props) {
  const [loras, setLoras] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/comfyui/object_info/LoraLoader')
      .then((r) => r.json())
      .then((d) => {
        const names = d?.LoraLoader?.input?.required?.lora_name?.[0] as string[] | undefined
        if (Array.isArray(names)) setLoras(names)
      })
      .catch(() => {
        // Fallback: try Lora Loader Stack
        fetch('/api/comfyui/object_info')
          .then(r => r.json())
          .then(d => {
            const names = (d as Record<string, {input?: {required?: Record<string, [string[]]>}}>)
              ?.LoraLoader?.input?.required?.lora_name?.[0] ?? []
            if (Array.isArray(names)) setLoras(names as string[])
          })
          .catch(() => {})
      })
  }, [])

  const active = Boolean(value)

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-1.5 transition-colors ${
        active ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
      }`}
    >
      <span className="w-12 shrink-0 pl-1 text-xs font-medium text-muted-foreground">{label}</span>

      {/* min-w-0 lets the trigger truncate long names instead of overflowing
          into the strength field */}
      <div className="min-w-0 flex-1">
        <Select value={value || 'none'} onValueChange={(v) => onChange((v ?? '') === 'none' ? '' : (v ?? ''), strength)}>
          <SelectTrigger className="h-8 w-full text-sm">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {loras.map((l) => (
              <SelectItem key={l} value={l}>{l.replace('.safetensors', '')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Strength stepper — only once a LoRA is chosen */}
      {active && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Str</span>
          <input
            type="number"
            step="0.05"
            min="0"
            max="2"
            value={strength}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(value, Number(e.target.value))}
            className="w-11 bg-transparent text-right text-sm font-mono tabular-nums outline-none"
            aria-label={`${label} strength`}
          />
        </div>
      )}
    </div>
  )
}
