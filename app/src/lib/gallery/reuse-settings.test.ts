import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { galleryMetadataToGenerationParams, resolveWorkflowFromMetadata } from './reuse-settings'
import { workflows } from '@/lib/workflows'

describe('galleryMetadataToGenerationParams', () => {
  it('includes dynamic LoRA names and strengths', () => {
    expect(galleryMetadataToGenerationParams({
      prompt: 'a raccoon',
      seed: 42,
      loras: [
        { name: 'one.safetensors', strength: 0.5 },
        { name: 'two.safetensors', strength: 1.1 },
      ],
    })).toEqual({
      prompt: 'a raccoon',
      seed: 42,
      loras: [
        { name: 'one.safetensors', strength: 0.5 },
        { name: 'two.safetensors', strength: 1.1 },
      ],
    })
  })

  it('does not add an empty LoRA array', () => {
    expect(galleryMetadataToGenerationParams({ prompt: 'x', loras: [] }))
      .toEqual({ prompt: 'x' })
  })
})

describe('resolveWorkflowFromMetadata', () => {
  it('resolves the output folder the gallery actually records', () => {
    // The bug this replaces: `workflow` is the folder an image was written to,
    // so an id/name lookup found nothing and the form kept whatever preset was
    // open — the prompt arrived, the model did not.
    expect(resolveWorkflowFromMetadata({ workflow: 'ZIT' })?.id).toBe('z-image-turbo')
    expect(resolveWorkflowFromMetadata({ workflow: 'KREA2' })?.id).toBe('krea2-turbo')
    expect(resolveWorkflowFromMetadata({ workflow: 'ERNIE' })?.id).toBe('ernie-turbo')
    expect(resolveWorkflowFromMetadata({ workflow: 'Anima' })?.id).toBe('anima')
    expect(resolveWorkflowFromMetadata({ workflow: 'SDXL' })?.id).toBe('sdxl')
  })

  it('prefers the recorded model, which is the only thing that splits a shared folder', () => {
    // All three SDXL presets write to images/SDXL/, so the folder alone would
    // send every Pony render back as plain SDXL — different prompt tags,
    // different sampler, different upscaler.
    for (const w of workflows) {
      expect(resolveWorkflowFromMetadata({ workflow: 'SDXL', model: w.baseModel })?.id).toBe(w.id)
    }
  })

  it('still honours an id or a preset name', () => {
    expect(resolveWorkflowFromMetadata({ workflow: 'krea2-raw' })?.id).toBe('krea2-raw')
    expect(resolveWorkflowFromMetadata({ workflow: 'Anima Turbo' })?.id).toBe('anima-turbo')
  })

  it('gives up rather than guessing when nothing identifies the render', () => {
    expect(resolveWorkflowFromMetadata({})).toBeUndefined()
    expect(resolveWorkflowFromMetadata({ workflow: 'SomeFutureFolder' })).toBeUndefined()
  })

  it('maps every folder the image workflows can write to', () => {
    // The folder comes from each workflow JSON's `filename_prefix`
    // (`images/<folder>/%year%-…`). Reading them here means a new family fails
    // this test instead of silently falling through to "no preset".
    const dir = path.join(process.cwd(), 'workflows')
    const folders = new Set<string>()
    for (const file of fs.readdirSync(dir).filter((f) => f.startsWith('image_') && f.endsWith('.json'))) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const [, folder] of raw.matchAll(/"filename_prefix":\s*"images\/([^/"]+)\//g)) {
        folders.add(folder)
      }
    }
    expect(folders.size).toBeGreaterThan(0)
    for (const folder of folders) {
      expect(resolveWorkflowFromMetadata({ workflow: folder }), folder).toBeDefined()
    }
  })
})
