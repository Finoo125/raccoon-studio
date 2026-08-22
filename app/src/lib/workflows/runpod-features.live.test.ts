/**
 * The application around the renders, exercised on a real RunPod pod.
 *
 *   RUNPOD_BASE=https://<pod>-8080.proxy.runpod.net RUNPOD_PASS=<password> \
 *     node_modules/.bin/vitest run src/lib/workflows/runpod-features.live.test.ts
 *
 * Sibling of `runpod.live.test.ts`, which covers the model families. Split
 * because they fail for unrelated reasons and are run at different moments: a
 * render failure is a model or VRAM problem, a failure here is the app itself.
 *
 * Everything goes through the pod's ONE published port, so each call travels
 * proxy → Next route → disk/ComfyUI exactly as a browser's would.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildFaceModelPrompt } from './build-face-model'

const BASE = process.env.RUNPOD_BASE
const PASS = process.env.RUNPOD_PASS
const LIVE = Boolean(BASE && PASS)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let cookie = ''

interface HistoryEntry { status?: { completed?: boolean } }

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'raccoon', password: PASS! }),
    redirect: 'manual',
  })
  const m = /rs_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')
  if (!m) throw new Error(`pod login failed: http ${res.status}`)
  return `rs_session=${m[1]}`
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } })

const json = (b: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
})

describe.skipIf(!LIVE)('RunPod pod — application features', () => {
  beforeAll(async () => { cookie = await login() })

  /**
   * THE headline check — the bug this whole exercise started from.
   *
   * It could not be verified on the 1.2.3 image: the Start button spawned a
   * mode-644 script through `sh -c` and exited 126, and because nothing else
   * could restart ComfyUI, one press bricked the pod. So this runs first on
   * every rebuilt image.
   */
  it('Start and Stop actually control ComfyUI', async () => {
    const online = async () =>
      ((await (await api('/api/comfyui-control/detect')).json()) as { online: boolean }).online

    expect(await online(), 'ComfyUI should be up before we stop it').toBe(true)

    expect((await api('/api/comfyui-control/stop', { method: 'POST' })).status).toBe(200)
    for (let i = 0; i < 20 && (await online()); i++) await sleep(1000)
    expect(await online(), 'Stop left ComfyUI running').toBe(false)

    const start = await api('/api/comfyui-control/start', { method: 'POST' })
    expect(start.status, 'Start was refused').toBe(200)

    // Boot loads every custom-node pack; 45-90 s is normal.
    let up = false
    for (let i = 0; i < 90 && !up; i++) {
      await sleep(3000)
      up = await online()
    }
    if (!up) {
      const phase = await (await api('/api/comfyui-control/detect')).json()
      throw new Error(`Start did not bring ComfyUI back: ${JSON.stringify(phase)}`)
    }
    console.log('[runpod] OK Start/Stop control ComfyUI')
  }, 6 * 60_000)

  it('backup round-trips: create, inspect, restore', async () => {
    const dest = '/workspace/e2e-backup.tar'
    // includeModels:false deliberately — the models dir is tens of GB and the
    // point here is the archive mechanism, not tar's throughput.
    const create = await api('/api/backup/create', json({ destPath: dest, includeModels: false }))
    expect(create.status, await create.clone().text().catch(() => '')).toBe(200)

    let settled = false
    for (let i = 0; i < 150 && !settled; i++) {
      await sleep(2000)
      // The route wraps it: { job: {...} }. Reading the top level instead made
      // a working backup look like one that never finished.
      const { job } = (await (await api('/api/backup/job')).json()) as
        { job?: { phase?: string; error?: string; running?: boolean; done?: boolean } }
      if (job?.error) throw new Error(`backup failed: ${job.error}`)
      settled = Boolean(job) && (job!.running === false || job!.done === true ||
        job!.phase === 'done' || job!.phase === 'idle' || job!.phase === 'error')
    }
    expect(settled, 'backup job never finished').toBe(true)

    const inspect = await api('/api/backup/inspect', json({ srcPath: dest }))
    expect(inspect.status, await inspect.clone().text().catch(() => '')).toBe(200)
    console.log(`[runpod] backup inspect → ${JSON.stringify(await inspect.json()).slice(0, 200)}`)

    const restore = await api('/api/backup/restore', json({ srcPath: dest }))
    expect(restore.status, await restore.clone().text().catch(() => '')).toBe(200)
    console.log('[runpod] OK backup create → inspect → restore')
  }, 12 * 60_000)

  it('builds a ReActor face model that ComfyUI then offers back', async () => {
    const gal = (await (await api('/api/gallery?refresh=true')).json()) as
      { images?: { filename: string; subfolder?: string }[] }
    const src = gal.images?.[0]
    expect(src, 'need at least one render to harvest a face from').toBeTruthy()

    const bytes = Buffer.from(await (await api(
      `/api/comfyui/view?filename=${encodeURIComponent(src!.filename)}` +
      `&subfolder=${encodeURIComponent(src!.subfolder ?? '')}&type=output`)).arrayBuffer())
    const form = new FormData()
    form.append('image', new File([bytes], 'e2e-refface.png', { type: 'image/png' }))
    form.append('overwrite', 'true')
    form.append('type', 'input')
    expect((await api('/api/comfyui/upload/image', { method: 'POST', body: form })).status).toBe(200)

    const graph = buildFaceModelPrompt({ faceFilenames: ['e2e-refface.png'], modelName: 'e2e_face' })
    const sub = await api('/api/comfyui/prompt', json({ prompt: graph, client_id: 'e2e-bfm' }))
    expect(sub.status, await sub.clone().text().catch(() => '')).toBe(200)
    const { prompt_id: id } = (await sub.json()) as { prompt_id: string }

    for (let i = 0; i < 90; i++) {
      await sleep(2000)
      const h = await api(`/api/comfyui/history/${id}`)
      if (h.status !== 200) continue
      const e = ((await h.json()) as Record<string, HistoryEntry>)[id]
      if (!e) continue
      if (e.status?.completed === false) throw new Error('face-model build reported failure')
      if (e.status?.completed) break
    }

    // The real proof is ComfyUI offering it back as a loadable face model —
    // the build node is an OUTPUT_NODE and produces no image to check.
    const oi = await (await api('/api/comfyui/object_info/ReActorLoadFaceModel')).json()
    expect(JSON.stringify(oi), 'ComfyUI does not list the face model just built').toContain('e2e_face')
    console.log('[runpod] OK face model built and listed')
  }, 8 * 60_000)

  it('gallery tag and favourite round-trip', async () => {
    const list = async () => ((await (await api('/api/gallery?refresh=true')).json()) as
      { images?: { id: string; tags?: string[]; favorite?: boolean }[] }).images ?? []
    const before = await list()
    expect(before.length).toBeGreaterThan(0)
    const id = before[0].id

    expect((await api('/api/gallery/tags', json({ ids: [id], add: 'e2e-tag' }))).status).toBe(200)
    expect((await api('/api/gallery/favorite', json({ id, value: true }))).status).toBe(200)

    const after = (await list()).find((i) => i.id === id)
    expect(after?.tags ?? [], 'tag did not persist').toContain('e2e-tag')
    expect(after?.favorite, 'favourite did not persist').toBe(true)

    // Leave the gallery as we found it.
    await api('/api/gallery/tags', json({ ids: [id], remove: 'e2e-tag' }))
    await api('/api/gallery/favorite', json({ id, value: false }))
    console.log('[runpod] OK gallery tag + favourite')
  }, 3 * 60_000)

  /**
   * Entitlement-gated, not broken. Photo Editing went on sale 2026-08-22, so
   * this is no longer a release hold-back — but a pod with no unlock key
   * installed must still get 403. A 200 here would mean a paid add-on is free
   * to anyone who deploys the template, which is the more expensive bug of the
   * two and the reason this check survives the add-on shipping.
   */
  it('photo editor still needs an unlock key', async () => {
    const r = await api('/api/photo-edit/save', json({ filename: 'x.png', dataUrl: 'data:,' }))
    expect(r.status, 'a paid add-on must not be reachable without a key').toBe(403)
    console.log('[runpod] OK photo editor correctly gated')
  }, 60_000)

  it('settings persist across a write', async () => {
    const marker = 'http://10.9.9.9:1234'
    expect((await api('/api/settings', { ...json({ ollamaBaseUrl: marker }), method: 'PUT' })).status).toBe(200)
    const back = (await (await api('/api/settings')).json()) as { settings?: { ollamaBaseUrl?: string } }
    expect(back.settings?.ollamaBaseUrl).toBe(marker)
    await api('/api/settings', { ...json({ ollamaBaseUrl: 'http://127.0.0.1:11434' }), method: 'PUT' })
    console.log('[runpod] OK settings persist')
  }, 60_000)
})
