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

// Whether the last accepted job was MiniMax H3 — i.e. whether ComfyUI's output
// cache is currently holding H3 conditioning latents. See the flush note in
// `submitPrompt`.
let lastWasH3 = false

/** True if the graph runs any MiniMax H3 node (`…ImageToVideo`, `…ReferenceToVideo`, `…SigmaShift`). */
function isMinimaxH3(prompt: unknown): boolean {
  const nodes = (prompt ?? {}) as Record<string, { class_type?: string }>
  return Object.values(nodes).some((n) => n?.class_type?.startsWith('MiniMaxH3') === true)
}

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
 * H3 is the exception, and it needs the flush for a different reason than VRAM
 * contention. H3 packs VAE-encoded video *and* audio latents into its
 * conditioning — `minimax_payload`, a `CONDConstant` carrying
 * `cond_video_latents` / `cond_audio_latents` (`comfy/model_base.py`) — so
 * ComfyUI's per-node output cache pins them and `unload_all_models()` never
 * frees them. Two H3 jobs in a row run on the same weights, so the rule above
 * skips the flush, and every render's AV latents stay resident: that is the
 * "the Nth H3 render kills ComfyUI" failure, which reads as an OOM or a driver
 * fault rather than a leak. Only `free_memory` clears them (main.py calls
 * `PromptExecutor.reset()` on that flag).
 *
 * Keyed off the *previous* job, not this one — nothing is pinned before the
 * first H3 render, and the flush costs a full checkpoint reload. There is no
 * cheaper middle setting: `/free` ignores `unload_models: false` (server.py
 * only sets the flag when truthy) and main.py then defaults it to `free_memory`,
 * so a cache reset always unloads the weights too.
 *
 * ComfyUI answers 200 as long as ANY output node's chain validates — branches
 * that fail (e.g. a missing model file) are silently dropped from execution
 * and only reported in `node_errors`. Treat that as failure, and dequeue the
 * partial job so the surviving branches don't burn GPU time on a render the
 * user will never get.
 */
export async function submitPrompt(body: Record<string, unknown>): Promise<string> {
  const models = modelsOf(body.prompt)
  if ((models && lastModels && models !== lastModels) || lastWasH3) {
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
  // the previous model resident, so remember models only on success. Same for
  // the H3 flag: a rejected graph never ran, so it pinned nothing.
  if (models) lastModels = models
  lastWasH3 = isMinimaxH3(body.prompt)
  return j.prompt_id
}
