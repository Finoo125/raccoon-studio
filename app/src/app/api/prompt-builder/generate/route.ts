import { NextResponse } from 'next/server'
import { assertEntitled } from '@/lib/addons/guard'
import { writerErrorMessage } from '@/lib/ai-writers/errors'
import { ensureRunning } from '@/lib/ai-writers/start'
import { TEST_IDEA } from '@/lib/ai-writers/test-idea'
import { serverAddress, writeWith } from '@/lib/ai-writers/write'
import { parseWriterId } from '@/lib/ai-writers/writer-id'
import { getSettings } from '@/lib/settings/settings'
import { workflows } from '@/lib/workflows'
import { promptLimit } from '@/lib/workflows/z-image-turbo'
import { listOllamaVisionModels } from '@/lib/director/ollama'
import { buildEditMessages } from '@/lib/prompt-builder/edit-writer'
import type { H3EditKind } from '@/lib/workflows/minimax-h3'
import { buildMessages, type PromptTask } from '@/lib/prompt-builder/enhance'
import { fitToLimit, promptStyleOf, tidyTags } from '@/lib/prompt-builder/picks'
import { WriterTimeout } from '@/lib/prompt-builder/writer'
import { cleanModelText } from '@/lib/prompts/clean-model-text'
import { wildcardTokens } from '@/lib/prompts/wildcards-expand'

interface Body { task?: PromptTask | 'edit'; editKind?: string; frameB64?: string; idea?: string; prompt?: string; workflowId?: string; engine?: string; count?: number; test?: boolean }

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: Request) {
  const parsed = ((await req.json().catch(() => null)) ?? {}) as Body
  // The add-on boundary: everything below is the paid part. A setup "Test write" may also pass for a
  // Director-only owner, but then the server writes its own fixed idea — nothing the client sends.
  const test = parsed.test === true
  const denied = await assertEntitled('prompt-builder')
  if (denied && !(test && !(await assertEntitled('ltx-director')))) return denied
  const body: Body = test
    ? { task: 'write', idea: TEST_IDEA, prompt: '', workflowId: parsed.workflowId, engine: parsed.engine, count: 1 }
    : parsed
  const task = body.task
  const idea = body.idea?.trim() ?? ''
  const prompt = body.prompt ?? ''
  const engine = body.engine ?? ''
  const workflow = workflows.find((w) => w.id === body.workflowId)
  const ref = parseWriterId(engine)

  if (task === 'edit') return writeEdit(body, idea, prompt, engine)
  if (task !== 'write' && task !== 'improve') return fail('Unknown task', 400)
  if (!workflow) return fail('Unknown model preset', 400)
  if (task === 'write' && !idea) return fail('Type your idea first', 400)
  if (task === 'improve' && !prompt.trim()) return fail('The prompt is empty', 400)
  if (!ref) return fail('Pick a writer first', 400)

  const count = Math.min(3, Math.max(1, Math.floor(Number(body.count) || 1)))
  const limit = promptLimit(workflow.loraFamily)
  const style = promptStyleOf(workflow)
  const messages = buildMessages(task, style, prompt, idea, limit)
  const words = (err: unknown) =>
    writerErrorMessage(err, ref, ref.kind === 'server' ? serverAddress(ref.server, getSettings().aiServers) ?? undefined : undefined)

  // A switched-off Ollama or LM Studio starts by itself — once, before the versions.
  try {
    await ensureRunning(ref)
  } catch (err) {
    return fail(words(err), 502)
  }
  // Each version is its own call — built-in: its own ComfyUI job and seed.
  const settled = await Promise.allSettled(Array.from({ length: count }, () => writeWith(engine, messages)))
  const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
  if (!answers.length) {
    const err = (settled[0] as PromiseRejectedResult).reason
    if (err instanceof WriterTimeout) return fail(err.message, 504)
    return fail(words(err), 502)
  }

  // A tag preset's quality prefix (Pony's score_ tags) is load-bearing; put it back if the writer dropped it,
  // whole or in part — tidyTags then removes the doubles.
  const head = (workflow.defaultParams.prompt ?? '').replace(/[\s,]+$/, '')
  const finish = (raw: string): string => {
    let out = cleanModelText(raw)
    if (out && head && prompt.startsWith(head) && !out.startsWith(head)) out = `${head}, ${out}`
    if (style === 'tags') out = tidyTags(out, prompt)
    return fitToLimit(out, limit)
  }
  const answered = answers.map(finish).filter(Boolean)
  if (!answered.length) return fail('The writer returned nothing usable — try again', 502)
  // A writer that hands the description back word for word has written nothing (an LM Studio prompt
  // enhancer did, three times out of three) — and the dialog would change nothing without a word.
  const plain = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const usable = answered.filter((out) => plain(out) !== plain(prompt))
  if (!usable.length) return fail('The writer gave your description back unchanged. Try again, or pick another writer.', 502)
  // Told to keep __wildcards__, the 4B writer still resolves them — every time
  // in the live check (__color__ → crimson). Never lose one silently.
  const tokens = wildcardTokens(prompt)
  const kept = [...new Set(usable.filter((out) => tokens.every((w) => out.includes(w))))]
  if (!kept.length) {
    const lost = tokens.filter((w) => !usable[0].includes(w))
    return fail(`The writer can't keep wildcards like ${lost.join(', ')}, so your prompt was left as it was. ` +
      'Take them out, let the writer polish it, then put them back.', 422)
  }
  return NextResponse.json({ prompts: kept })
}

const EDIT_KINDS: readonly string[] = ['vfx', 'style', 'head']
/**
 * Longest instruction kept. A change plus its keep clause runs ~300 characters; live 2026-10-21,
 * qwen3.5:9b ran one of three versions on into a 6,000-character list of body parts.
 */
const EDIT_MAX_CHARS = 800

/** Video Edit's instruction writer: no preset, never the built-in writer, a frame only for a model that sees. */
async function writeEdit(body: Body, idea: string, prompt: string, engine: string) {
  const ref = parseWriterId(engine)
  if (!body.editKind || !EDIT_KINDS.includes(body.editKind)) return fail('Unknown kind of edit', 400)
  if (!idea) return fail('Type your idea first', 400)
  if (!ref) return fail('Pick a writer first', 400)
  if (ref.kind === 'builtin') return fail('Pick another writer — the built-in one doesn’t write video edits.', 400)

  const words = (err: unknown) =>
    writerErrorMessage(err, ref, ref.kind === 'server' ? serverAddress(ref.server, getSettings().aiServers) ?? undefined : undefined)
  try {
    await ensureRunning(ref)
  } catch (err) {
    return fail(words(err), 502)
  }
  // After ensureRunning: a switched-off Ollama lists no models, which would withhold the frame.
  const sees = !!body.frameB64 && ref.kind === 'ollama' && (await listOllamaVisionModels()).includes(ref.model)
  const messages = buildEditMessages(body.editKind as H3EditKind, idea, prompt, sees ? body.frameB64 : undefined)
  const count = Math.min(3, Math.max(1, Math.floor(Number(body.count) || 1)))
  const settled = await Promise.allSettled(Array.from({ length: count }, () => writeWith(engine, messages)))
  const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
  if (!answers.length) return fail(words((settled[0] as PromiseRejectedResult).reason), 502)

  const plain = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const answered = answers.map(cleanModelText).filter((out) => out && out.length <= EDIT_MAX_CHARS)
  if (!answered.length) return fail('The writer returned nothing usable — try again', 502)
  const usable = [...new Set(answered.filter((out) => plain(out) !== plain(prompt)))]
  if (!usable.length) return fail('The writer gave your instruction back unchanged. Try again, or pick another writer.', 502)
  return NextResponse.json({ prompts: usable, sees })
}
