import { describe, expect, it } from 'vitest'
import { fileKey, summarize } from './download-client'
import type { Transfer } from './transfers'

const t = (key: string, status: Transfer['status'], received = 0, total = 100, alreadyExists = false): Transfer =>
  ({ key, name: key.split('/')[1], dir: key.split('/')[0], status, receivedBytes: received, totalBytes: total, value: 0, startedAt: 0, alreadyExists })

describe('summarize', () => {
  it('is not done while a file is still running or has not appeared yet', () => {
    expect(summarize([t('loras/a', 'done', 100)], ['loras/a', 'vae/b']).done).toBe(false)
    expect(summarize([t('loras/a', 'running', 40)], ['loras/a']).done).toBe(false)
  })
  it('adds up the bytes of only the files asked about', () => {
    const s = summarize([t('loras/a', 'running', 40), t('vae/b', 'running', 10), t('x/other', 'running', 999)], ['loras/a', 'vae/b'])
    expect([s.receivedBytes, s.totalBytes]).toEqual([50, 200])
  })
  it('reports a failed file and is then not done', () => {
    const s = summarize([t('loras/a', 'error'), t('vae/b', 'done', 100)], ['loras/a', 'vae/b'])
    expect(s.done).toBe(false)
    expect(s.failed.map((f) => f.key)).toEqual(['loras/a'])
  })
  it('knows whether anything new landed (only then does the engine need a restart)', () => {
    expect(summarize([t('loras/a', 'done', 100, 100, true)], ['loras/a']).wroteAny).toBe(false)
    expect(summarize([t('loras/a', 'done', 100)], ['loras/a'])).toMatchObject({ done: true, wroteAny: true })
  })
})

describe('fileKey', () => {
  it('matches the server\'s transfer key', () => {
    expect(fileKey({ folder: 'diffusion_models', name: 'x.safetensors' })).toBe('diffusion_models/x.safetensors')
  })
})
