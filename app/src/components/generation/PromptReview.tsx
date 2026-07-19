'use client'

import { useState } from 'react'
import { Loader2, Wand2, Square, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

interface PromptReviewProps {
  status: string
  isStreaming: boolean
  error: string | null
  prompt: string
  onPromptChange: (v: string) => void
  onRefine: (instruction: string) => void
  onStop: () => void
}

export default function PromptReview({
  status, isStreaming, error,
  prompt, onPromptChange, onRefine, onStop,
}: PromptReviewProps) {
  const [refineText, setRefineText] = useState('')

  return (
    <div className="space-y-2">
      {/* Status / stop */}
      {(isStreaming || status) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isStreaming && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <span className="min-w-0 flex-1 truncate">{status}</span>
          {isStreaming && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onStop}>
              <Square className="h-3 w-3 mr-1" /> Stop
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Editable confirmed prompt */}
      <div className="space-y-2">
        <SectionLabel>Final prompt</SectionLabel>
        <Textarea
          placeholder="Enhance an idea above, or write/paste the final cinematic prompt here…"
          className="min-h-[160px] resize-y leading-relaxed text-sm font-mono"
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onPromptChange(e.target.value)}
        />
      </div>

      {/* Refine + kill */}
      <div className="flex gap-2">
        <Input
          placeholder="Refine: e.g. make beat 2 rougher"
          className="h-9 flex-1 text-sm"
          value={refineText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRefineText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && refineText.trim() && !isStreaming) {
              onRefine(refineText.trim())
              setRefineText('')
            }
          }}
        />
        <Button
          variant="outline"
          className="h-9 px-3 text-sm shrink-0"
          disabled={isStreaming || !refineText.trim() || !prompt.trim()}
          onClick={() => { onRefine(refineText.trim()); setRefineText('') }}
        >
          <Wand2 className="h-4 w-4 mr-1.5" /> Refine
        </Button>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center text-sm font-semibold tracking-tight">
      <span className="mr-2 h-3.5 w-1 rounded-full bg-primary/70" />
      {children}
    </label>
  )
}
