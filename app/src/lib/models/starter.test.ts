// app/src/lib/models/starter.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STARTER_MODELS, NO_HARDWARE, H3_STOCK_CKPT, defaultPicks, downloadPlan, isInstalled, recommendedFor,
  starterFor, versionFor, videoFilesFor, videoStarterFor, whyNot, removalPlan, versionOnDiskMb,
} from './starter'
import type { Hardware } from '@/lib/hardware'
import { H3_REF2VA_CKPT, H3_REALISM_LORA, H3_SPARSEREF } from '@/lib/workflows/minimax-h3'
import { QWEN21_BFS_LORAS, QWEN21_TURBO_UNET } from '@/lib/workflows/qwen21'
import { IMAGE_PRESETS } from './image-presets'

const card = (vramGb: number | null, ramGb = 32): Hardware => ({ gpuName: 'x', vramGb, ramGb, freeDiskGb: 500 })
const m = (id: string) => STARTER_MODELS.find((x) => x.id === id)!

describe('the table itself', () => {
  it('every model has a downloadable file in every version', () => {
    for (const s of STARTER_MODELS) for (const v of s.versions) {
      expect(v.files.length).toBeGreaterThan(0)
      for (const f of v.files) expect(f.url).toMatch(/^https:\/\//)
    }
  })
  it('ids are unique', () => {
    expect(new Set(STARTER_MODELS.map((s) => s.id)).size).toBe(STARTER_MODELS.length)
  })
  it('the stock H3 checkpoint is the one the bundled graph loads', () => {
    const wf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../workflows/MinimaxH3.json'), 'utf8')) as Record<string, { class_type: string; inputs: { unet_name?: string } }>
    const unet = Object.values(wf).find((n) => n.class_type === 'UNETLoader')!
    expect(unet.inputs.unet_name).toBe(H3_STOCK_CKPT)
  })
})

describe('fitting a computer', () => {
  it('an "8 GB" card that reports 7.99 still counts as 8', () => {
    expect(versionFor(m('anima-turbo'), card(7.99))).not.toBeNull()
  })
  it('a full-size photo model does not fit 8 GB, and says why', () => {
    expect(versionFor(m('krea2-turbo'), card(8))).toBeNull()
    expect(whyNot(m('krea2-turbo'), card(8))).toBe('Needs 12 GB of graphics memory — yours has 8.')
  })
  it('12 GB: Krea2 Turbo, Krea2 RAW and Z-Image fit (GGUF test 2026-10-11), Ernie still needs 16', () => {
    for (const id of ['krea2-turbo', 'krea2-raw', 'z-image-turbo']) expect(whyNot(m(id), card(12))).toBeNull()
    expect(whyNot(m('ernie-turbo'), card(12))).toBe('Needs 16 GB of graphics memory — yours has 12.')
  })
  it('video needs 32 GB of RAM, and a 32 GB machine that reports 30.9 still counts', () => {
    expect(whyNot(m('h3-hybrid'), card(24, 16))).toBe('Needs 32 GB of RAM — yours has 16.')
    expect(whyNot(m('h3-hybrid'), card(24, 30.9))).toBeNull()
  })
  it('unknown graphics memory greys nothing and recommends nothing', () => {
    expect(whyNot(m('krea2-turbo'), card(null))).toBeNull()
    expect(versionFor(m('krea2-turbo'), card(null))).toBeNull()
    expect(recommendedFor('photo', card(null))).toBeNull()
    expect(defaultPicks(NO_HARDWARE, new Set())).toEqual([])
  })
})

describe('recommendations', () => {
  it('16 GB: Krea2 Turbo for photos, Anima Turbo for anime, no video yet', () => {
    expect(recommendedFor('photo', card(16))?.id).toBe('krea2-turbo')
    expect(recommendedFor('anime', card(16))?.id).toBe('anima-turbo')
    expect(recommendedFor('video', card(16))).toBeNull()
  })
  it('24 GB: H3 Hybrid for video', () => {
    expect(recommendedFor('video', card(24))?.id).toBe('h3-hybrid')
  })
  it('8 GB: nothing for photos, Anima for anime', () => {
    expect(recommendedFor('photo', card(8))).toBeNull()
    expect(recommendedFor('anime', card(8))?.id).toBe('anima-turbo')
  })
  it('12 GB: the photo models fit but none is recommended (untested on a real 12 GB card)', () => {
    expect(recommendedFor('photo', card(12))).toBeNull()
    expect(defaultPicks(card(12), new Set())).toEqual(['anima-turbo'])
  })
  it('pre-ticks photo + anime, never video, and nothing already installed', () => {
    expect(defaultPicks(card(24), new Set())).toEqual(['krea2-turbo', 'anima-turbo'])
    const anima = new Set(m('anima-turbo').versions[0].files.map((f) => f.name))
    expect(defaultPicks(card(24), anima)).toEqual(['krea2-turbo'])
  })
})

describe('downloads', () => {
  it('counts a shared file once and skips files already on disk', () => {
    const turbo = m('krea2-turbo').versions[0]
    const raw = m('krea2-raw').versions[0]
    const both = downloadPlan([turbo, raw], new Set())
    const shared = turbo.files.filter((f) => raw.files.some((r) => r.name === f.name))
    expect(shared.length).toBeGreaterThan(0)
    expect(both.files.length).toBe(turbo.files.length + raw.files.length - shared.length)
    const onDisk = new Set(turbo.files.map((f) => f.name))
    expect(downloadPlan([turbo], onDisk)).toEqual({ files: [], totalMb: 0 })
  })
  it('installed means every file of a version is on disk', () => {
    const files = m('anima-turbo').versions[0].files.map((f) => f.name)
    expect(isInstalled(m('anima-turbo'), new Set(files))).toBe(true)
    expect(isInstalled(m('anima-turbo'), new Set(files.slice(1)))).toBe(false)
  })
})

describe('the Generate pages\' lookups', () => {
  it('the setup never offers or opens picture editing: no recommendation, no default tick', () => {
    expect(defaultPicks(card(32), new Set())).not.toContain('qwen21-edit')
    expect(m('qwen21-edit').samplePrompt).toBeUndefined()
  })
  it('finds the starter model of an image preset, and none for SDXL', () => {
    expect(starterFor('krea2-turbo')?.id).toBe('krea2-turbo')
    expect(starterFor('sdxl')).toBeNull()
  })
  it('H3 needs its checkpoint plus the shared encoder and VAEs', () => {
    const hybrid = videoFilesFor('minimax-h3', 'hybrid')
    expect(hybrid[0]).toBe(m('h3-hybrid').versions[0].files[0].name)
    expect(hybrid).toHaveLength(4)
    expect(videoFilesFor('minimax-h3', 'base')[0]).toBe(H3_STOCK_CKPT)
    expect(videoFilesFor('minimax-h3', undefined, 'ref2v')[0]).toBe(H3_REF2VA_CKPT)
    // Edit runs on reference conditioning, so it loads the ref2va checkpoint too (minimax-h3.ts).
    expect(videoFilesFor('minimax-h3', 'base', 'edit')[0]).toBe(H3_REF2VA_CKPT)
  })
  it('SparseRef15 needs its file, the shared files and its turbo LoRA, and has no starter download', () => {
    const files = videoFilesFor('minimax-h3', 'sparseref', 'ref2v')
    expect(files[0]).toBe(H3_SPARSEREF.ckpt)
    expect(files).toContain(H3_SPARSEREF.lora.name)
    expect(files).toHaveLength(5)
    expect(videoStarterFor('minimax-h3', 'sparseref')).toBeNull()
  })
  it('LTX and Director share one file list and one starter model', () => {
    expect(videoFilesFor('ltx23-director')).toEqual(videoFilesFor('ltx23'))
    expect(videoStarterFor('ltx23')?.id).toBe('ltx23')
    expect(videoStarterFor('minimax-h3', 'base')).toBeNull()
  })
})

describe('installed, sizes and removal', () => {
  const names = (id: string, opts: { optional?: boolean } = {}) =>
    m(id).versions[0].files.filter((f) => opts.optional === undefined || !!f.optional === opts.optional).map((f) => f.name)

  it("Krea2's built-in LoRAs and the Lenovo look LoRA are optional: a model without them is installed", () => {
    expect(names('krea2-turbo', { optional: true }).length).toBe(3)
    expect(isInstalled(m('krea2-turbo'), new Set(names('krea2-turbo', { optional: false })))).toBe(true)
  })
  it('the size on disk counts what is there', () => {
    const onDisk = new Set(names('anima-turbo'))
    const total = m('anima-turbo').versions[0].files.reduce((n, f) => n + f.sizeMb, 0)
    expect(versionOnDiskMb(m('anima-turbo'), onDisk)).toBe(total)
  })
  it('Remove keeps a file another installed model still needs', () => {
    // qwen_image_vae.safetensors is shared by Krea2 and Anima
    const onDisk = new Set([...names('krea2-turbo'), ...names('anima-turbo')])
    const plan = removalPlan(m('krea2-turbo'), onDisk).map((f) => f.name)
    expect(plan).toContain('krea2_turbo_fp8_scaled.safetensors')
    expect(plan).not.toContain('qwen_image_vae.safetensors')
  })
  it('Remove takes the shared files when nothing else needs them', () => {
    const onDisk = new Set(names('krea2-turbo'))
    expect(removalPlan(m('krea2-turbo'), onDisk).map((f) => f.name)).toContain('qwen_image_vae.safetensors')
  })
  it('H3 Hybrid keeps the text encoder while 10Eros is installed', () => {
    const onDisk = new Set([...names('h3-hybrid'), ...names('h3-eros')])
    const plan = removalPlan(m('h3-hybrid'), onDisk).map((f) => f.name)
    expect(plan).toEqual([m('h3-hybrid').versions[0].files[0].name])
  })
  it("Remove keeps what it is told to: Krea2's text encoder, the built-in writer", () => {
    const onDisk = new Set(names('krea2-turbo'))
    const plan = removalPlan(m('krea2-turbo'), onDisk, ['qwen3vl_4b_fp8_scaled.safetensors']).map((f) => f.name)
    expect(names('krea2-turbo')).toContain('qwen3vl_4b_fp8_scaled.safetensors')
    expect(plan).toContain('krea2_turbo_fp8_scaled.safetensors')
    expect(plan).not.toContain('qwen3vl_4b_fp8_scaled.safetensors')
  })
  it('never plans a file that is not on disk', () => {
    expect(removalPlan(m('krea2-turbo'), new Set())).toEqual([])
  })
  it("an H3 model is installed only with its OWN checkpoint (the catalog's optional flag is relative to stock H3)", () => {
    const shared = names('h3-hybrid').slice(1)
    expect(isInstalled(m('h3-hybrid'), new Set([...names('h3-eros')]))).toBe(false)
    expect(isInstalled(m('h3-hybrid'), new Set([H3_STOCK_CKPT, ...shared]))).toBe(false)
    expect(isInstalled(m('h3-eros'), new Set([H3_STOCK_CKPT, ...shared]))).toBe(false)
    expect(isInstalled(m('h3-hybrid'), new Set(names('h3-hybrid')))).toBe(true)
  })
  it('Qwen Edit is the Turbo files plus the optional head-swap LoRA; ready without it', () => {
    const edit = m('qwen21-edit')
    expect(edit.opens).toEqual({ page: 'image', preset: 'qwen21-edit' })
    expect(starterFor('qwen21-edit')?.id).toBe('qwen21-edit')
    // the Turbo preset's optional Lenovo look LoRA (2026-10-14) rides along, then the head-swap LoRA
    expect(names('qwen21-edit', { optional: true })).toEqual(['qwen21_lenovo_ultrareal_v1.safetensors', QWEN21_BFS_LORAS.alternative])
    expect(names('qwen21-edit', { optional: false })).toEqual(
      IMAGE_PRESETS.find((p) => p.id === 'qwen21-turbo')!.files.filter((f) => !f.optional).map((f) => f.name),
    )
    expect(isInstalled(edit, new Set(names('qwen21-edit', { optional: false })))).toBe(true)
  })
  it('Qwen Edit offers from 16 GB and is never recommended', () => {
    expect(whyNot(m('qwen21-edit'), card(12))).toBe('Needs 16 GB of graphics memory — yours has 12.')
    expect(whyNot(m('qwen21-edit'), card(16))).toBeNull()
    expect(m('qwen21-edit').recommend).toBeUndefined()
  })
  it("Remove takes Qwen Edit's files although the Advanced Turbo preset shares its main file", () => {
    const onDisk = new Set(names('qwen21-edit'))
    expect(removalPlan(m('qwen21-edit'), onDisk).map((f) => f.name).sort()).toEqual(names('qwen21-edit').sort())
  })
  it('Remove keeps the Qwen encoder and VAE while the Qwen base model is on disk', () => {
    const base = IMAGE_PRESETS.find((p) => p.id === 'qwen21')!.files[0].name
    const plan = removalPlan(m('qwen21-edit'), new Set([...names('qwen21-edit'), base])).map((f) => f.name)
    expect(plan.sort()).toEqual([QWEN21_TURBO_UNET, QWEN21_BFS_LORAS.alternative].sort())
  })
  it('H3 Hybrid keeps the shared files and the realism adapter while stock H3 is on disk', () => {
    const onDisk = new Set([...names('h3-hybrid'), H3_STOCK_CKPT])
    expect(removalPlan(m('h3-hybrid'), onDisk).map((f) => f.name)).toEqual([m('h3-hybrid').versions[0].files[0].name])
  })
  it('every H3 package brings the realism adapter along, optional so it never blocks "installed"', () => {
    for (const id of ['h3-hybrid', 'h3-eros']) {
      const realism = m(id).versions[0].files.find((f) => f.name === H3_REALISM_LORA)
      expect(realism?.optional).toBe(true)
      expect(isInstalled(m(id), new Set(names(id, { optional: false })))).toBe(true)
    }
  })
})
