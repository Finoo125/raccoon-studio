'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStudioStore } from '@/lib/generation/studio-store'

export default function OutputBar({
  prompt,
  onChange,
}: {
  prompt: string
  onChange: (v: string) => void
}) {
  const router = useRouter()
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const text = prompt.trim()

  const copy = async () => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    toast.success('Prompt copied')
  }
  const toImage = () => {
    if (!text) return
    router.push(`/generate?prompt=${encodeURIComponent(text)}`)
  }
  const toVideo = () => {
    if (!text) return
    setPrefill({ workflowId: '', params: { prompt: text } })
    router.push('/generate-videos')
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <textarea
        className="min-h-24 w-full resize-y rounded-md border border-input bg-background p-2 text-sm text-foreground"
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your built prompt will appear here…"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} disabled={!text}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          Copy
        </button>
        <button onClick={toImage} disabled={!text}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
          Send to Generate Image
        </button>
        <button onClick={toVideo} disabled={!text}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
          Send to Generate Video
        </button>
      </div>
    </div>
  )
}
