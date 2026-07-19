interface NodeError {
  class_type?: string
  errors?: { message?: string; details?: string }[]
}

interface SubmitResponse {
  prompt_id: string
  node_errors?: Record<string, NodeError>
}

// The big-model loader inputs identify which weights a job runs on. LoRA /
// VAE / encoder swaps don't count — ComfyUI patches or reloads those cheaply
// without holding two full checkpoints in VRAM.
const MODEL_INPUT_KEYS = ['ckpt_name', 'unet_name']

// Weights the last submitted job ran on ('' until a model-bearing job runs).
// Module-level on purpose: every generation path funnels through submitPrompt.
let lastModels = ''

function modelsOf(prompt: unknown): string {
  const found = new Set<string>()
  const nodes = (prompt ?? {}) as Record<string, { inputs?: Record<string, unknown> }>
  for (const node of Object.values(nodes)) {
    for (const key of MODEL_INPUT_KEYS) {
      const v = node?.inputs?.[key]
      if (typeof v === 'string' && v && v !== 'None') found.add(v)
    }
  }
  return [...found].sort().join('|')
}

/**
 * POST a prompt graph to ComfyUI (via the proxy) and return the prompt id.
 *
 * Switching to different model weights than the previous job first asks
 * ComfyUI to unload its cached models (POST /free — honored between jobs), so
 * the incoming checkpoint doesn't fight the old one for VRAM. Same weights =
 * no flush, the cache stays warm.
 *
 * ComfyUI answers 200 as long as ANY output node's chain validates — branches
 * that fail (e.g. a missing model file) are silently dropped from execution
 * and only reported in `node_errors`. Treat that as failure, and dequeue the
 * partial job so the surviving branches don't burn GPU time on a render the
 * user will never get.
 */
export async function submitPrompt(body: Record<string, unknown>): Promise<string> {
  const models = modelsOf(body.prompt)
  if (models && lastModels && models !== lastModels) {
    await fetch('/api/comfyui/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }).catch(() => undefined) // best-effort — never block the render on a flush
  }
  const res = await fetch('/api/comfyui/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  const j = (await res.json()) as SubmitResponse
  const errs = Object.values(j.node_errors ?? {})
  if (errs.length > 0) {
    void fetch('/api/comfyui/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [j.prompt_id] }),
    }).catch(() => {})
    const summary = errs
      .slice(0, 3)
      .map((n) => {
        const e = n.errors?.[0]
        return [n.class_type, e?.message, e?.details].filter(Boolean).join(': ')
      })
      .join('; ')
    throw new Error(`ComfyUI rejected part of the graph (missing model?) — ${summary}`)
  }
  // Only a job ComfyUI accepted actually loads weights — a rejected one leaves
  // the previous model resident, so remember models only on success.
  if (models) lastModels = models
  return j.prompt_id
}
