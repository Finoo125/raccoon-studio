import { describe, expect, it, vi } from 'vitest'
import { listSetups, startSetup, type SetupDeps, type SetupJob } from './setup-jobs'

const settle = async (job: SetupJob) => {
  for (let i = 0; i < 200 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 5))
  return job
}

function deps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    platform: 'win32', arch: 'x64',
    freeGb: vi.fn(async () => 177),
    download: vi.fn(async (spec, progress) => { progress(1, 2); return `${spec.root ?? 'M'}/${spec.dir}/${spec.name}` }),
    comfyUp: vi.fn(async () => true),
    startComfy: vi.fn(async () => {}),
    ollamaInstalled: vi.fn(() => false),
    installOllama: vi.fn(async () => {}),
    startOllama: vi.fn(async () => {}),
    pull: vi.fn(async (_m, progress) => { progress(3, 6.6) }),
    testWrite: vi.fn(async () => ({ sample: 'A cat in armor.', seconds: 1.8 })),
    removeFile: vi.fn(),
    modelsDir: 'C:\\comfy\\models', ollamaModelsDir: 'C:\\Users\\a\\.ollama\\models', downloadsRoot: 'C:\\app\\data',
    ...over,
  }
}

const labels = (j: SetupJob) => j.steps.map((s) => s.label)

describe('built-in setup', () => {
  it('downloads the text model, tests it, and names the writer', async () => {
    const d = deps()
    const job = await settle(startSetup({ kind: 'builtin' }, d) as SetupJob)
    expect(job.status).toBe('done')
    expect(labels(job)).toEqual(['Downloading Krea2’s text model', 'Writing a test description'])
    expect(job.steps.every((s) => s.state === 'done')).toBe(true)
    expect(d.download).toHaveBeenCalledWith(expect.objectContaining({ dir: 'text_encoders', name: 'qwen3vl_4b_fp8_scaled.safetensors' }), expect.any(Function))
    expect(job).toMatchObject({ writer: 'builtin', sample: 'A cat in armor.', seconds: 1.8 })
  })
  it('starts ComfyUI first when it is off', async () => {
    const d = deps({ comfyUp: vi.fn(async () => false) })
    const job = await settle(startSetup({ kind: 'builtin' }, d) as SetupJob)
    expect(labels(job)).toEqual(['Downloading Krea2’s text model', 'Starting ComfyUI', 'Writing a test description'])
    expect(d.startComfy).toHaveBeenCalledTimes(1)
  })
  it('refuses before downloading anything when the drive is too full', async () => {
    const d = deps({ freeGb: vi.fn(async () => 4) })
    const job = await settle(startSetup({ kind: 'builtin' }, d) as SetupJob)
    expect(job.status).toBe('error')
    expect(job.error).toBe('Not enough free space: needs 7 GB, C: has 4 GB.')
    expect(d.download).not.toHaveBeenCalled()
  })
})

describe('Ollama setup', () => {
  it('downloads, installs, starts, pulls the model, tests it and cleans up on Windows', async () => {
    const d = deps()
    const job = await settle(startSetup({ kind: 'ollama', model: 'qwen3.5:9b' }, d) as SetupJob)
    expect(job.status).toBe('done')
    expect(labels(job)).toEqual(['Downloading Ollama', 'Installing Ollama (no administrator rights needed)', 'Starting Ollama',
      'Downloading qwen3.5:9b', 'Writing a test description'])
    expect(d.download).toHaveBeenCalledWith(
      { url: 'https://ollama.com/download/OllamaSetup.exe', dir: 'downloads', name: 'OllamaSetup.exe', root: 'C:\\app\\data' }, expect.any(Function))
    expect(d.installOllama).toHaveBeenCalledWith('C:\\app\\data/downloads/OllamaSetup.exe')
    expect(d.pull).toHaveBeenCalledWith('qwen3.5:9b', expect.any(Function))
    expect(d.testWrite).toHaveBeenCalledWith('ollama:qwen3.5:9b')
    expect(d.removeFile).toHaveBeenCalledWith('C:\\app\\data/downloads/OllamaSetup.exe')
    expect(job.writer).toBe('ollama:qwen3.5:9b')
  })
  it('unpacks the Linux package for this machine', async () => {
    const d = deps({ platform: 'linux', arch: 'arm64' })
    const job = await settle(startSetup({ kind: 'ollama', model: 'qwen3.5:4b' }, d) as SetupJob)
    expect(labels(job)[1]).toBe('Unpacking Ollama')
    expect(d.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://ollama.com/download/ollama-linux-arm64.tar.zst' }), expect.any(Function))
  })
  it('skips the install when Ollama is already there', async () => {
    const d = deps({ ollamaInstalled: vi.fn(() => true) })
    const job = await settle(startSetup({ kind: 'ollama', model: 'qwen3.5:4b' }, d) as SetupJob)
    expect(labels(job)).toEqual(['Starting Ollama', 'Downloading qwen3.5:4b', 'Writing a test description'])
    expect(d.download).not.toHaveBeenCalled()
  })
  it('reports download progress on the running step', async () => {
    let release!: () => void
    const d = deps({ pull: vi.fn((_m, progress) => { progress(3.3, 6.6); return new Promise<void>((r) => { release = r }) }) })
    const job = startSetup({ kind: 'ollama', model: 'qwen3.5:9b' }, d) as SetupJob
    for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 5))
    expect(job.steps[3]).toMatchObject({ state: 'running', gb: 6.6, doneGb: 3.3 })
    release()
    await settle(job)
  })
  it('stops at a failing step with plain words and leaves the rest waiting', async () => {
    const d = deps({ pull: vi.fn(async () => { throw new Error('pull model manifest: 500') }) })
    const job = await settle(startSetup({ kind: 'ollama', model: 'qwen3.5:9b' }, d) as SetupJob)
    expect(job.status).toBe('error')
    expect(job.error).toBe('Ollama couldn’t download qwen3.5:9b. Try again, or pick a smaller model.')
    expect(job.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'error', 'waiting'])
    expect(d.testWrite).not.toHaveBeenCalled()
  })
  it('points to the manual install when the installer fails', async () => {
    const d = deps({ installOllama: vi.fn(async () => { throw new Error('exit code 5') }) })
    const job = await settle(startSetup({ kind: 'ollama', model: 'qwen3.5:9b' }, d) as SetupJob)
    expect(job.error).toBe('Windows stopped the Ollama installer. You can install it yourself from ollama.com/download.')
  })
  it('refuses a model that is not one of the offered ones', () => {
    expect(startSetup({ kind: 'ollama', model: 'llama3:70b' }, deps())).toEqual({ error: 'Unknown model' })
  })
  it('joins a setup that is already running instead of starting a second', async () => {
    let release!: () => void
    const d = deps({ download: vi.fn(() => new Promise<string>((r) => { release = () => r('f') })) })
    const a = startSetup({ kind: 'builtin' }, d) as SetupJob
    const b = startSetup({ kind: 'builtin' }, d) as SetupJob
    expect(b).toBe(a)
    expect(listSetups()).toContain(a)
    for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 5))
    release()
    await settle(a)
    expect(d.download).toHaveBeenCalledTimes(1)
  })
})
