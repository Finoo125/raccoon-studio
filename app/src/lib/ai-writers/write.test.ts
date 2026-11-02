import { describe, expect, it, vi } from 'vitest'
import { chatOpenAI, serverAddress, writeWith, type WriteDeps } from './write'
import { ensureRunning, spawnDetached, startApp, type StartDeps } from './start'
import { serverIdOf } from './openai-server'

const msgs = [{ role: 'user' as const, content: 'a cat as a knight' }]

function deps(over: Partial<WriteDeps> = {}): WriteDeps {
  return {
    builtin: vi.fn(async () => 'from built-in'),
    ollama: vi.fn(async () => 'from ollama'),
    openai: vi.fn(async () => 'from openai'),
    thinks: vi.fn(async () => true),
    saved: () => [{ id: 'sx', address: 'http://10.0.0.2:5000' }],
    lmsPort: () => 1234,
    ...over,
  }
}

const noThink = { chat_template_kwargs: { enable_thinking: false } }

describe('writeWith', () => {
  it('runs the built-in writer in ComfyUI', async () => {
    const d = deps()
    expect(await writeWith('builtin', msgs, d)).toBe('from built-in')
    expect(d.builtin).toHaveBeenCalledWith(msgs)
  })
  it('asks a thinking Ollama model not to think, and leaves others alone', async () => {
    const d = deps()
    await writeWith('ollama:qwen3.5:4b', msgs, d)
    expect(d.ollama).toHaveBeenCalledWith('qwen3.5:4b', msgs, { think: false })
    const plain = deps({ thinks: vi.fn(async () => false) })
    await writeWith('ollama:gemma3:12b', msgs, plain)
    expect(plain.ollama).toHaveBeenCalledWith('gemma3:12b', msgs, {})
  })
  it('sends LM Studio the model path and a short ttl so it unloads after writing', async () => {
    const d = deps()
    await writeWith('lmstudio:Sulphur/pe/pe.gguf', msgs, d)
    expect(d.openai).toHaveBeenCalledWith('http://127.0.0.1:1234', 'Sulphur/pe/pe.gguf', msgs, { ttl: 5 })
  })
  // Live 2026-10-10: three parallel requests to a cold LM Studio — the first loads the model, the other two 500 at once.
  it('queues LM Studio writes so a cold model loads once', async () => {
    let active = 0
    let most = 0
    const d = deps({ openai: vi.fn(async () => {
      most = Math.max(most, ++active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return 'ok'
    }) })
    await Promise.all([1, 2, 3].map(() => writeWith('lmstudio:S/pe/pe.gguf', msgs, d)))
    expect(d.openai).toHaveBeenCalledTimes(3)
    expect(most).toBe(1)
  })
  it('keeps the queue moving after a failed LM Studio write', async () => {
    const d = deps({ openai: vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue('second') })
    const [a, b] = await Promise.allSettled([1, 2].map(() => writeWith('lmstudio:S/pe/pe.gguf', msgs, d)))
    expect(a.status).toBe('rejected')
    expect(b).toEqual({ status: 'fulfilled', value: 'second' })
  })
  it('finds a server by id among the usual ports and the saved ones', async () => {
    const d = deps()
    await writeWith(`server:${serverIdOf('http://127.0.0.1:8080')}:qwen3-8b.gguf`, msgs, d)
    expect(d.openai).toHaveBeenLastCalledWith('http://127.0.0.1:8080', 'qwen3-8b.gguf', msgs, noThink, undefined)
    await writeWith('server:sx:m', msgs, d)
    expect(d.openai).toHaveBeenLastCalledWith('http://10.0.0.2:5000', 'm', msgs, noThink, undefined)
  })
  it('sends a saved server its key', async () => {
    const d = deps({ saved: () => [{ id: 'su', address: 'http://127.0.0.1:8888', apiKey: 'sk-unsloth-x' }] })
    await writeWith('server:su:unsloth/gemma-4-26B-A4B-it-GGUF', msgs, d)
    expect(d.openai).toHaveBeenLastCalledWith('http://127.0.0.1:8888', 'unsloth/gemma-4-26B-A4B-it-GGUF', msgs, noThink, 'sk-unsloth-x')
  })
  it('asks a server once without the thinking switch when it refuses it', async () => {
    const d = deps({ openai: vi.fn().mockRejectedValueOnce(new Error('400: unknown field')).mockResolvedValue('plain') })
    expect(await writeWith('server:sx:m', msgs, d)).toBe('plain')
    expect(d.openai).toHaveBeenLastCalledWith('http://10.0.0.2:5000', 'm', msgs, {}, undefined)
    const e = deps({ openai: vi.fn().mockRejectedValue(new Error('500: boom')) })
    await expect(writeWith('server:sx:m', msgs, e)).rejects.toThrow('500: boom')
    expect(e.openai).toHaveBeenCalledTimes(1)
  })
  it('never contacts a server it does not know', async () => {
    const d = deps()
    await expect(writeWith('server:sunknown:m', msgs, d)).rejects.toThrow('That AI server isn’t in the list any more. Scan again.')
    expect(d.openai).not.toHaveBeenCalled()
    expect(serverAddress('sunknown', [])).toBeNull()
  })
  it('refuses a malformed id', async () => {
    await expect(writeWith('chatgpt:4o', msgs, deps())).rejects.toThrow('Pick a writer first')
  })
})

describe('chatOpenAI', () => {
  it('reads the answer and ignores reasoning', async () => {
    const f = vi.fn(async () => Response.json({ choices: [{ message: { content: ' A cat. ', reasoning_content: 'Let me think' } }] }))
    expect(await chatOpenAI('http://a', 'm', msgs, { ttl: 5 }, f as unknown as typeof fetch)).toBe('A cat.')
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ model: 'm', messages: msgs, stream: false, ttl: 5 })
  })
  it('throws with the status when the server refuses', async () => {
    const f = async () => new Response('model not found', { status: 404 })
    await expect(chatOpenAI('http://a', 'm', msgs, {}, f as unknown as typeof fetch)).rejects.toThrow(/404.*model not found/)
  })
})

describe('starting apps', () => {
  const sd = (over: Partial<StartDeps> = {}): StartDeps => {
    let up = false
    return {
      ollamaLocal: true,
      probe: vi.fn(async () => up),
      launch: vi.fn(async () => { up = true }),
      waitMs: 300, pollMs: 10,
      ...over,
    }
  }
  it('starts a switched-off local Ollama once, even when three writes ask at the same time', async () => {
    const d = sd()
    await Promise.all([1, 2, 3].map(() => ensureRunning({ kind: 'ollama', model: 'x' }, d)))
    expect(d.launch).toHaveBeenCalledTimes(1)
  })
  it('leaves a running app alone', async () => {
    const d = sd({ probe: vi.fn(async () => true) })
    await ensureRunning({ kind: 'lmstudio', model: 'x' }, d)
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('never starts an Ollama on another machine', async () => {
    const d = sd({ ollamaLocal: false })
    await ensureRunning({ kind: 'ollama', model: 'x' }, d)
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('does nothing for the built-in writer and servers', async () => {
    const d = sd()
    await ensureRunning({ kind: 'builtin' }, d)
    await ensureRunning({ kind: 'server', server: 's', model: 'm' }, d)
    expect(d.probe).not.toHaveBeenCalled()
  })
  // Final review: the setup's "Starting Ollama" step ran right after the installer had started it.
  it('does not launch an app that already answers', async () => {
    const d = sd({ probe: vi.fn(async () => true) })
    await startApp('ollama', d)
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('turns a failed launch into plain words', async () => {
    const d = sd({ launch: vi.fn(async () => { throw new Error('Command failed: C:\\Users\\a\\.lmstudio\\bin\\lms.exe server start') }) })
    await expect(startApp('lmstudio', d)).rejects.toThrow('LM Studio didn’t start. Open it, or choose another writer.')
  })
  it('survives a program that cannot be started at all', async () => {
    spawnDetached('C:/no/such/folder/nothing.exe', [])
    await new Promise((r) => setTimeout(r, 300))
  })
  it('says so in plain words when the app never answers', async () => {
    const d = sd({ launch: vi.fn(async () => {}) })
    await expect(startApp('ollama', d)).rejects.toThrow('Ollama didn’t start. Open it from the Start menu, or choose another writer.')
    await expect(startApp('lmstudio', d)).rejects.toThrow('LM Studio didn’t start. Open it, or choose another writer.')
  })
})
