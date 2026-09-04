import { describe, it, expect, vi, afterEach } from 'vitest'
import { submitPrompt } from './submit'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('submitPrompt', () => {
  it('returns the prompt id on a clean accept', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ prompt_id: 'p1', number: 1, node_errors: {} })))
    await expect(submitPrompt({ prompt: {}, client_id: 'c' })).resolves.toBe('p1')
  })

  it('throws on HTTP error with the body text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid prompt', { status: 400 })))
    await expect(submitPrompt({ prompt: {} })).rejects.toThrow('invalid prompt')
  })

  it('frees ComfyUI VRAM only when the prompt runs different model weights than the last submit', async () => {
    // A Response body is single-read — mint a fresh one per fetch call.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(ok({ prompt_id: 'p', number: 1, node_errors: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const freeCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/comfyui/free').length
    const ckpt = (name: string) => ({
      prompt: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: name } } },
    })

    // First submit — nothing loaded before, nothing to free.
    await submitPrompt(ckpt('modelA.safetensors'))
    expect(freeCalls()).toBe(0)

    // Same model again — keep it cached, no free.
    await submitPrompt(ckpt('modelA.safetensors'))
    expect(freeCalls()).toBe(0)

    // A utility graph with no model loaders must neither flush nor forget A.
    await submitPrompt({ prompt: { '1': { class_type: 'SaveImage', inputs: {} } } })
    expect(freeCalls()).toBe(0)

    // Different checkpoint — unload the old weights BEFORE submitting the job.
    await submitPrompt(ckpt('modelB.safetensors'))
    expect(freeCalls()).toBe(1)
    const urls = fetchMock.mock.calls.map(([u]) => u)
    expect(urls.indexOf('/api/comfyui/free')).toBeLessThan(urls.lastIndexOf('/api/comfyui/prompt'))

    // UNET-based family counts as a model switch too.
    await submitPrompt({
      prompt: { '57:28': { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors' } } },
    })
    expect(freeCalls()).toBe(2)
  })

  it('treats a 200 with node_errors as failure and dequeues the partial job', async () => {
    // ComfyUI accepts a graph whose render branch failed validation (e.g. a
    // model file is missing) as long as any output node validates — the video
    // output is silently dropped. That must surface as an error.
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        prompt_id: 'p2',
        number: 2,
        node_errors: {
          '1084': {
            class_type: 'VAELoader',
            errors: [{ message: 'Value not in list', details: "vae_name: 'taeltx2_3.safetensors' not in []" }],
          },
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitPrompt({ prompt: {} })).rejects.toThrow(/VAELoader.*Value not in list.*taeltx2_3/)
    const dequeue = fetchMock.mock.calls.find(([url]) => url === '/api/comfyui/queue')
    expect(dequeue).toBeTruthy()
    expect(JSON.parse(dequeue![1].body as string)).toEqual({ delete: ['p2'] })
  })

  it('frees after an H3 job even though the weights did not change', async () => {
    // H3 pins VAE-encoded video+audio latents in ComfyUI's output cache via its
    // `minimax_payload` conditioning, and unload_all_models() never frees them —
    // so the same-weights rule above would let them accumulate until ComfyUI dies.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(ok({ prompt_id: 'p', number: 1, node_errors: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const freeCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/comfyui/free').length
    const h3 = {
      prompt: {
        '1': { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' } },
        '5': { class_type: 'MiniMaxH3ImageToVideo', inputs: {} },
      },
    }

    // Nothing is pinned before the first H3 render — flushing here would only
    // cost a checkpoint reload. (One free for the switch off the previous test's
    // weights; the H3 rule must not add a second.)
    await submitPrompt(h3)
    const afterFirst = freeCalls()

    // Second H3 render, identical weights: the old rule saw no switch and skipped
    // the flush. This is the render that used to die.
    await submitPrompt(h3)
    expect(freeCalls()).toBe(afterFirst + 1)

    // Reference mode is the same model under a different conditioning node.
    await submitPrompt({ prompt: { '5': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: {} } } })
    expect(freeCalls()).toBe(afterFirst + 2)

    // A non-H3 graph clears the flag once it has flushed, so the next H3 job
    // does not pay for a cache that is already empty.
    await submitPrompt({ prompt: { '1': { class_type: 'SaveImage', inputs: {} } } })
    expect(freeCalls()).toBe(afterFirst + 3)
    await submitPrompt(h3)
    expect(freeCalls()).toBe(afterFirst + 3)
  })
})
