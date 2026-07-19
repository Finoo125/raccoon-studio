'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, FolderOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AppSettings } from '@/lib/settings/settings'

interface PathsBlock { modelsDir: string | null; outputDir: string | null; logsDir: string | null; projectsDir: string | null }

export default function SettingsForm() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [paths, setPaths] = useState<PathsBlock | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/settings')
      const json = await res.json()
      setSettings(json.settings)
      setPaths(json.paths)
    })()
  }, [])

  if (!settings) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setSettings((await res.json()).settings)
      toast.success('Settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const openFolder = async (p: string) => {
    const res = await fetch('/api/system/open-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }),
    })
    if (!res.ok) toast.error('Could not open folder')
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Connection</h2>
        <Field label="Ollama base URL">
          <Input value={settings.ollamaBaseUrl} onChange={(e) => set('ollamaBaseUrl', e.target.value)} className="font-mono text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ollama timeout (ms)">
            <Input type="number" value={settings.ollamaTimeoutMs} onChange={(e) => set('ollamaTimeoutMs', Number(e.target.value))} className="font-mono text-sm" />
          </Field>
          <Field label="Ollama num_ctx">
            <Input type="number" value={settings.ollamaNumCtx} onChange={(e) => set('ollamaNumCtx', Number(e.target.value))} className="font-mono text-sm" />
          </Field>
        </div>
        <Field label="ComfyUI base URL">
          <Input value={settings.comfyuiBaseUrl} onChange={(e) => set('comfyuiBaseUrl', e.target.value)} className="font-mono text-sm" />
        </Field>
        <Field label="ffmpeg path (optional)">
          <Input
            value={settings.ffmpegPath}
            onChange={(e) => set('ffmpegPath', e.target.value)}
            placeholder="Leave empty to use ffmpeg from PATH"
            className="font-mono text-sm"
          />
          <span className="block text-xs text-muted-foreground">
            Used by Movie Maker export and media probing. ffprobe is expected next to it.
          </span>
        </Field>
        <Button onClick={save} disabled={saving} className="h-10">
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : 'Save'}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Paths (read-only)</h2>
        <p className="text-xs text-muted-foreground">Paths are set at launch; editing them requires restarting ComfyUI.</p>
        {paths && (Object.entries(paths) as [string, string | null][]).map(([key, val]) => (
          <div key={key} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{key.replace('Dir', '')}</span>
            <span className="flex-1 truncate font-mono text-xs">{val ?? '— not set —'}</span>
            {val && (
              <>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy" onClick={() => { void navigator.clipboard.writeText(val); toast.success('Copied') }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Open folder" onClick={() => void openFolder(val)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
