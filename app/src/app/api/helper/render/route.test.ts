import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/addons/guard', () => ({ assertEntitled: async () => null }))
vi.mock('@/lib/settings/settings', () => ({ getSettings: () => ({ comfyuiBaseUrl: 'http://comfy.test' }) }))

import { POST } from './route'
import { GET } from './[promptId]/route'
import { H3_SPARSEREF } from '@/lib/workflows/minimax-h3'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const body = {
  v: 1, workflowId: 'minimax-h3',
  params: {
    mode: 'ref2v', h3Checkpoint: 'sparseref', durationSeconds: 10, orientation: 'portrait',
    refImages: ['video-helper/p0.png'], refImageRoles: ['character'], prompt: 'x', seed: 5,
  },
}
const post = (b: unknown) => POST(new NextRequest('http://localhost:3000/api/helper/render', {
  method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }))
/** ComfyUI answering object_info with the given installed files, and /prompt with an id. */
const comfy = (unets: string[], loras: string[]) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.endsWith('/object_info/UNETLoader')) return Response.json({ UNETLoader: { input: { required: { unet_name: [unets] } } } })
  if (url.endsWith('/object_info/LoraLoaderModelOnly')) return Response.json({ LoraLoaderModelOnly: { input: { required: { lora_name: [loras] } } } })
  if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'abc', node_errors: {} })
  return new Response('not found', { status: 404 })
}))

describe('POST /api/helper/render', () => {
  it('submits the graph and returns the prompt id and seed', async () => {
    comfy([H3_SPARSEREF.ckpt], [H3_SPARSEREF.lora.name])
    const res = await post(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ promptId: 'abc', seed: 5 })
  })

  it('refuses a checkpoint or LoRA that is not installed', async () => {
    comfy([], [])
    const res = await post(body)
    expect(res.status).toBe(409)
    expect((await res.json()).missing).toEqual([H3_SPARSEREF.ckpt, H3_SPARSEREF.lora.name])
  })

  it('refuses an invalid payload with 400', async () => {
    expect((await post({ v: 1, workflowId: 'minimax-h3', params: {} })).status).toBe(400)
  })

  it('answers 502 when ComfyUI is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect((await post(body)).status).toBe(502)
  })
})

describe('GET /api/helper/render/[promptId]', () => {
  const get = (id: string) => GET(new NextRequest(`http://localhost:3000/api/helper/render/${id}`), { params: Promise.resolve({ promptId: id }) })

  it('is 404 unknown for an id ComfyUI never saw', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/queue')
      ? Response.json({ queue_running: [], queue_pending: [] }) : Response.json({})))
    const res = await get('nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ status: 'unknown', files: [] })
  })

  it('is queued while the queue still holds it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/queue')
      ? Response.json({ queue_running: [], queue_pending: [[1, 'abc', {}, {}, []]] }) : Response.json({})))
    expect(await (await get('abc')).json()).toEqual({ status: 'queued', files: [] })
  })

  it('answers 502 when ComfyUI is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect((await get('abc')).status).toBe(502)
  })
})
