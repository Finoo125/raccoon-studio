import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getUnlockedFeatures } from '@/lib/addons/entitlement'
import { listedAddons, sellableAddonIds, visibleNav } from '@/lib/features/registry'
import { HELPER_LINK_ADDON, parseHandoff } from './helper-handoff'

const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const video = (params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  v: 1,
  workflowId: 'minimax-h3',
  params: {
    mode: 'ref2v',
    h3Checkpoint: 'eros',
    durationSeconds: 10,
    orientation: 'portrait',
    refImages: ['video-helper/mara.png', 'video-helper/gym.png'],
    refImageRoles: ['character', 'location'],
    prompt: 'For the target video, the attached references are used as follows: <Picture 1> is fully_preserved.',
    ...params,
  },
  ...extra,
})
const qwen = (params: Record<string, unknown> = {}) => ({
  v: 1,
  workflowId: 'qwen21-edit',
  params: { qwenReferences: ['video-helper/last-frame.png', 'video-helper/stage-3.png'], prompt: 'Match her physique.', ...params },
})

describe('parseHandoff', () => {
  it('turns a video link into an H3 references prefill for Generate Video', () => {
    const out = parseHandoff(encode(video({ continueFrom: 'video/MinimaxH3/2026-10-11/004702-MinimaxH3__00001_.mp4', keyframes: { end: { image: 'video-helper/kf.png', width: 720, height: 1280 } } })))
    expect(out).toEqual({
      page: '/generate-videos',
      prefill: {
        workflowId: 'minimax-h3',
        params: {
          videoModel: 'minimax-h3',
          mode: 'ref2v',
          h3Checkpoint: 'eros',
          durationSeconds: 10,
          orientation: 'portrait',
          refImages: ['video-helper/mara.png', 'video-helper/gym.png'],
          refImageRoles: ['character', 'location'],
          prompt: video().params.prompt,
          continueFrom: 'video/MinimaxH3/2026-10-11/004702-MinimaxH3__00001_.mp4',
          keyframes: { end: { image: 'video-helper/kf.png', width: 720, height: 1280 } },
        },
      },
    })
  })
  it('accepts the storyboard loop: SparseRef15, start and end pictures, a seed', () => {
    const kf = { image: 'video-helper/p0.png', width: 736, height: 1344 }
    const h = parseHandoff(encode(video({ h3Checkpoint: 'sparseref', keyframes: { start: kf, end: { ...kf, image: 'video-helper/p1.png' } }, seed: 324481168041 })))
    expect(h?.prefill.params).toMatchObject({
      h3Checkpoint: 'sparseref',
      seed: 324481168041,
      keyframes: { start: kf, end: { ...kf, image: 'video-helper/p1.png' } },
    })
  })
  it('maps up to two LoRAs onto the user LoRA slots', () => {
    const h = parseHandoff(encode(video({ loras: [{ name: 'MysticXXX_MMH3-V4.safetensors', strength: 1 }] })))
    expect(h?.prefill.params).toMatchObject({ lora1: 'MysticXXX_MMH3-V4.safetensors', lora1Strength: 1 })
    expect(h?.prefill.params.lora2).toBeUndefined()
  })
  it('keeps an old payload (end picture only, no LoRAs, no seed) exactly as before', () => {
    const h = parseHandoff(encode(video({ keyframes: { end: { image: 'video-helper/e.png', width: 736, height: 1344 } } })))
    expect(h?.prefill.params.seed).toBeUndefined()
    expect(h?.prefill.params.lora1).toBeUndefined()
    expect(h?.prefill.params.keyframes).toEqual({ end: { image: 'video-helper/e.png', width: 736, height: 1344 } })
  })
  it('clears a continuation and keyframes the link does not set', () => {
    const params = parseHandoff(encode(video()))!.prefill.params
    expect(params).toHaveProperty('continueFrom', undefined)
    expect(params).toHaveProperty('keyframes', undefined)
  })
  it('turns a Qwen link into a Qwen Edit prefill for Generate Image', () => {
    expect(parseHandoff(encode(qwen()))).toEqual({
      page: '/generate',
      prefill: {
        workflowId: 'qwen21-edit',
        params: { qwenReferences: ['video-helper/last-frame.png', 'video-helper/stage-3.png'], editChip: undefined, prompt: 'Match her physique.' },
      },
    })
  })
  it('takes a face close-up and voice samples, within the reference budget', () => {
    const params = parseHandoff(encode(video({
      refImages: ['video-helper/mara.png', 'video-helper/mara-face.png', 'video-helper/gym.png'],
      refImageRoles: ['character', 'face', 'location'],
      refAudios: ['video-helper/mara-voice.wav'],
    })))!.prefill.params
    expect(params.refImageRoles).toEqual(['character', 'face', 'location'])
    expect(params.refAudios).toEqual(['video-helper/mara-voice.wav'])
  })
  it('clears voice samples the link does not set', () => {
    expect(parseHandoff(encode(video()))!.prefill.params).toHaveProperty('refAudios', undefined)
  })
  const refused: [string, unknown][] = [
    ['four voice samples', video({ refAudios: Array(4).fill('v.wav') })],
    ['more than six references together', video({ refImages: Array(5).fill('a.png'), refImageRoles: Array(5).fill('character'), refAudios: ['v.wav', 'w.wav'] })],
    ['a voice sample that climbs out', video({ refAudios: ['../v.wav'] })],
    ['an unknown version', { ...video(), v: 2 }],
    ['an unknown workflow', { ...video(), workflowId: 'ltx23' }],
    ['an extra param', video({ turbo: 'fast' })],
    ['a LoRA with a folder', video({ loras: [{ name: '../x.safetensors', strength: 1 }] })],
    ['a LoRA in a subfolder', video({ loras: [{ name: 'a/b.safetensors', strength: 1 }] })],
    ['a LoRA that is not safetensors', video({ loras: [{ name: 'x.ckpt', strength: 1 }] })],
    ['three LoRAs', video({ loras: [1, 2, 3].map((i) => ({ name: `l${i}.safetensors`, strength: 1 })) })],
    ['a LoRA strength above 2', video({ loras: [{ name: 'x.safetensors', strength: 2.5 }] })],
    ['a LoRA with an extra key', video({ loras: [{ name: 'x.safetensors', strength: 1, clip: 1 }] })],
    ['a negative seed', video({ seed: -1 })],
    ['a fractional seed', video({ seed: 1.5 })],
    ['a seed as text', video({ seed: '42' })],
    ['a seed past 2^53', video({ seed: 2 ** 53 })],
    ['an unknown checkpoint', video({ h3Checkpoint: 'dasiwa' })],
    ['a middle keyframe', video({ keyframes: { middle: { image: 'video-helper/m.png', width: 736, height: 1344 } } })],
    ['a path that climbs out of input/', video({ refImages: ['../secret.png', 'b.png'] })],
    ['a URL as a picture', video({ refImages: ['http://evil.example/x.png', 'b.png'] })],
    ['roles that do not match the pictures', video({ refImageRoles: ['character'] })],
    ['an unknown role', video({ refImageRoles: ['character', 'style'] })],
    ['seven pictures', video({ refImages: Array(7).fill('a.png'), refImageRoles: Array(7).fill('character') })],
    ['a continuation that climbs out', video({ continueFrom: 'video/../../x.mp4' })],
    ['a length that is not a number', video({ durationSeconds: '10' })],
    ['a length outside 5–15 s', video({ durationSeconds: 30 })],
    ['a broken keyframe', video({ keyframes: { end: { image: 'k.png', width: -1, height: 10 } } })],
    ['five Qwen pictures', qwen({ qwenReferences: Array(5).fill('a.png') })],
    ['a non-text prompt', qwen({ prompt: 5 })],
  ]
  it.each(refused)('refuses %s', (_, payload) => {
    expect(parseHandoff(encode(payload))).toBeNull()
  })
  it('refuses broken base64 and broken JSON', () => {
    expect(parseHandoff('%%%')).toBeNull()
    expect(parseHandoff(Buffer.from('{not json').toString('base64url'))).toBeNull()
  })
})

describe('the Video Helper link add-on', () => {
  afterEach(() => {
    delete process.env.RACCOON_PRIVATE_ADDONS
    delete process.env.RACCOON_ENTITLEMENTS_FILE
  })
  it("opens only through the creator's RACCOON_PRIVATE_ADDONS", async () => {
    process.env.RACCOON_ENTITLEMENTS_FILE = path.join(os.tmpdir(), `rs-none-${process.pid}.json`)
    expect(await getUnlockedFeatures()).not.toContain(HELPER_LINK_ADDON)
    process.env.RACCOON_PRIVATE_ADDONS = HELPER_LINK_ADDON
    expect(await getUnlockedFeatures()).toContain(HELPER_LINK_ADDON)
  })
  it('is private: never sold, never listed, never a tab', () => {
    expect(sellableAddonIds()).not.toContain(HELPER_LINK_ADDON)
    expect(listedAddons().map((f) => f.id)).not.toContain(HELPER_LINK_ADDON)
    expect(visibleNav([HELPER_LINK_ADDON]).map((f) => f.id)).not.toContain(HELPER_LINK_ADDON)
  })
})
