import { describe, it, expect } from 'vitest'
import { awaitPromptOutputs } from './await-prompt'

const noSleep = async () => {}

function historyOf(...frames: unknown[]) {
  const queue = [...frames]
  return async () => (queue.length > 1 ? queue.shift() : queue[0]) as never
}

describe('awaitPromptOutputs', () => {
  it('returns the node outputs once the prompt completes', async () => {
    const outputs = { 'det:detect': { images: [{ filename: 'a.png', subfolder: '', type: 'input' }] } }
    const out = await awaitPromptOutputs('p1', {
      sleep: noSleep,
      history: historyOf({ p1: { status: { completed: true }, outputs } }),
    })
    expect(out['det:detect'].images?.[0].filename).toBe('a.png')
  })

  it('keeps polling while the prompt is still queued', async () => {
    // An absent record is "not started yet", not "finished with nothing".
    const out = await awaitPromptOutputs('p1', {
      sleep: noSleep,
      history: historyOf({}, {}, { p1: { status: { completed: true }, outputs: { n: { text: ['ok'] } } } }),
    })
    expect(out.n.text).toEqual(['ok'])
  })

  it('throws on an errored prompt instead of returning nothing', async () => {
    // Empty outputs would read as "no faces in this frame" — a different
    // problem, with a different fix, and the user would go looking for it.
    await expect(
      awaitPromptOutputs('p1', {
        sleep: noSleep,
        history: historyOf({ p1: { status: { completed: false, status_str: 'error' } } }),
      }),
    ).rejects.toThrow(/error/i)
  })

  it("carries the node's own error message", async () => {
    await expect(
      awaitPromptOutputs('p1', {
        sleep: noSleep,
        history: historyOf({ p1: { status: { completed: false, status_str: 'error', messages: [
          ['execution_start', {}],
          ['execution_error', { exception_message: 'RaccoonDetectFaces: no face found in this frame' }],
        ] } } }),
      }),
    ).rejects.toThrow(/no face found in this frame/)
  })

  it('gives up rather than polling forever', async () => {
    await expect(
      awaitPromptOutputs('p1', { sleep: noSleep, timeoutMs: 0, history: historyOf({}) }),
    ).rejects.toThrow(/timed out/i)
  })

  it('surfaces a completed prompt that produced no outputs as an empty record', async () => {
    const out = await awaitPromptOutputs('p1', {
      sleep: noSleep,
      history: historyOf({ p1: { status: { completed: true } } }),
    })
    expect(out).toEqual({})
  })
})
