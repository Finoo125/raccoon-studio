'use client'
import { useCallback } from 'react'
import { useQueueStore } from '@/lib/comfyui/queue'
import { submitPrompt } from '@/lib/comfyui/submit'
import { awaitPromptOutputs } from '@/lib/comfyui/await-prompt'
import { buildDescribePicturePrompt, cleanDescription, describeQuestion } from '@/lib/video/describe'

/** Describe one Edit picture with the user's describer: 'builtin' (a ComfyUI job) or 'ollama:<model>'. */
export function useDescribePicture() {
  const clientId = useQueueStore((s) => s.clientId)
  const describe = useCallback(async (file: string, role: string | null, head: boolean, describeWith: string): Promise<string> => {
    const question = describeQuestion(role, head)
    if (describeWith === 'builtin') {
      const id = await submitPrompt({ prompt: buildDescribePicturePrompt(file, question), client_id: clientId, front: true })
      // Behind a running render it waits, like the face check.
      const out = await awaitPromptOutputs(id, { timeoutMs: 30 * 60_000 })
      return cleanDescription(out['desc:out']?.text?.[0] ?? '')
    }
    const model = describeWith.startsWith('ollama:') ? describeWith.slice('ollama:'.length) : ''
    const res = await fetch('/api/video/describe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file, role, head, model }) })
    const j = (await res.json()) as { text?: string; error?: string }
    if (!res.ok) throw new Error(j.error ?? res.statusText)
    return j.text ?? ''
  }, [clientId])
  return { describe }
}
