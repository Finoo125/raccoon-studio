import type { OutputImage } from '@/types/comfyui'

/**
 * A node's entry in a history record. `images` is what save/preview nodes
 * report; `text` is what a node returns through `ui.text` — which is how
 * `RaccoonVideoFaceSwap` gets its per-character coverage report back to the app.
 */
export interface PromptOutput {
  images?: OutputImage[]
  text?: string[]
}

interface HistoryShape {
  outputs?: Record<string, PromptOutput>
  status?: { completed?: boolean; status_str?: string; messages?: [string, { exception_message?: string }][] }
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_INTERVAL_MS = 400

async function fetchHistory(promptId: string): Promise<Record<string, HistoryShape>> {
  const res = await fetch(`/api/comfyui/history/${promptId}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`History unavailable (${res.status})`)
  return res.json()
}

/**
 * Wait for a short helper prompt to finish and hand back its node outputs.
 *
 * For jobs that are **not** renders: the swap picker's face detection takes
 * about a second and has no business appearing in the queue, so it polls
 * `/history` instead of going through the generation websocket. Anything that
 * takes minutes belongs in the queue, where the user can watch and cancel it.
 *
 * An errored prompt throws rather than returning empty outputs — an empty result
 * would read as "no faces in this frame", which is a different problem with a
 * different fix.
 */
export async function awaitPromptOutputs(
  promptId: string,
  opts: {
    timeoutMs?: number
    intervalMs?: number
    /** Injectable for tests, and for anything that is not the browser proxy. */
    history?: (promptId: string) => Promise<Record<string, HistoryShape>>
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<Record<string, PromptOutput>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const history = opts.history ?? fetchHistory
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const deadline = Date.now() + timeoutMs
  for (;;) {
    const entry = (await history(promptId))[promptId]
    if (entry?.status?.status_str === 'error') {
      // The node's own words when ComfyUI recorded them — a caller can then
      // tell "no face in this picture" from a real failure.
      const failure = entry.status.messages?.find(([kind]) => kind === 'execution_error')?.[1]?.exception_message
      throw new Error(failure ? `ComfyUI: ${failure}` : 'ComfyUI reported an error running this prompt')
    }
    if (entry?.status?.completed) return entry.outputs ?? {}
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for ComfyUI')
    }
    await sleep(intervalMs)
  }
}
