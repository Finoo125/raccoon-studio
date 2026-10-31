import { describe, it, expect, vi } from 'vitest'
import { videoWriterRefusal } from './video-writer-gate'

const body = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).buffer as ArrayBuffer
const only = (...ids: string[]) => vi.fn(async (id: string) => ids.includes(id))

describe('videoWriterRefusal', () => {
  it('ignores other paths without asking', async () => {
    const u = only()
    expect(await videoWriterRefusal('prompt', body({}), u)).toBeNull()
    expect(u).not.toHaveBeenCalled()
  })
  it('refuses a locked t2v', async () => {
    const res = await videoWriterRefusal('rvn/generate_stream', body({ video_mode: 't2v' }), only())
    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Feature locked', feature: 'prompt-builder' })
  })
  it('lets Director owners write in director mode only', async () => {
    expect(await videoWriterRefusal('rvn/generate_stream', body({ video_mode: 'director' }), only('ltx-director'))).toBeNull()
    expect((await videoWriterRefusal('rvn/generate_stream', body({ video_mode: 't2v' }), only('ltx-director')))?.status).toBe(403)
  })
  it('allows when prompt-builder is unlocked', async () => {
    expect(await videoWriterRefusal('rvn/generate_stream', body({ video_mode: 'i2v' }), only('prompt-builder'))).toBeNull()
  })
  it('refuses an unparsable body when locked', async () => {
    const raw = new TextEncoder().encode('nope').buffer as ArrayBuffer
    expect((await videoWriterRefusal('rvn/generate_stream', raw, only('ltx-director')))?.status).toBe(403)
  })
  it.each([
    'rvn/../rvn/generate_stream', 'rvn/./generate_stream', 'rvn//generate_stream',
    'rvn/%2e%2e/rvn/generate_stream', 'rvn%2Fgenerate_stream', '%72vn/generate_stream',
    'rvn%252Fgenerate_stream', 'rvn\\generate_stream', '%zz',
  ])('refuses the variant %s when locked', async (p) => {
    expect((await videoWriterRefusal(p, body({ video_mode: 't2v' }), only()))?.status).toBe(403)
  })
  it('still ignores a different normalised path', async () => {
    expect(await videoWriterRefusal('rvn/x/../options', body({}), only())).toBeNull()
  })
})
