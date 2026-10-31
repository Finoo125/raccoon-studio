import { describe, it, expect } from 'vitest'
import { workflows } from './index'
import type { GenerationParams, WorkflowDefinition } from '@/types/workflow'
import type { ComfyUIPrompt } from '@/types/comfyui'

/**
 * The face detailer runs alongside the face swap, and BEFORE it. Both halves of
 * that are load-bearing, and both are counter-intuitive enough that they were
 * each "improved" away once and had to be measured back.
 *
 * **The detailer must not be skipped when a swap is active** — the builders force
 * it on, overriding an explicit `detailer: false`. It looks like pure waste (the
 * swap paints over the face the detailer just redrew) but removing it to save
 * ~3 s breaks face swap outright. Measured 2026-09-05 on ComfyUI
 * v0.34.2, Krea2 Turbo, a fresh ComfyUI per trial and a new seed per render:
 *
 *   detailer + swap in the graph     12/12 renders clean
 *   swap alone, detailer removed      3/12 -- only the FIRST render of each
 *                                     session works; every later one comes back
 *                                     a pure black frame, reported by ComfyUI as
 *                                     status_str "success"
 *
 * Something about the detailer's own model/clip/vae wiring keeps ComfyUI's model
 * manager honest across renders; without it the second Krea2 load silently
 * produces garbage. The mechanism is not fully understood — what is certain is
 * the 12/12 vs 3/12.
 *
 * **And it must run BEFORE the swap.** A redraw over an already-swapped face
 * destroys the identity, ArcFace cosine against the source photo, 3 seeds:
 *
 *   detailer -> swap (this order)      0.8531  +/- 0.016
 *   swap only (no detailer)            0.8508  +/- 0.007   <-- but see above
 *   swap -> detailer @0.15 denoise     0.5340  +/- 0.041
 *
 * So this order costs nothing on identity and is the only arrangement that also
 * survives repeated renders. It keeps detailing every OTHER face in the frame
 * too, since the swap only ever replaces `face_index: 0`.
 *
 * Pinned structurally, by walking the graph rather than trusting the order of
 * the calls in the builder, because nothing else in the suite would notice a
 * regression: every arrangement produces a graph that renders a plausible
 * picture, and the failure only shows up on the SECOND render of a session.
 */
const base = (over: Partial<GenerationParams>): GenerationParams =>
  ({ prompt: 'x', width: 832, height: 1216, seed: 1, ...over } as GenerationParams)

const withSwap = (over: Partial<GenerationParams> = {}) =>
  base({ faceSwap: true, inputImage: 'face.png', ...over })

/** Families whose builder wires a face swap at all (Anima has detailer only). */
const swapFamilies = workflows.filter((w) => w.buildPrompt(withSwap())['swap:mask'] !== undefined)

/** The SaveImage node the swap/detailer chains wrap, found by class. */
function saveNode(g: ComfyUIPrompt): string {
  const id = Object.keys(g).find((k) => g[k].class_type === 'SaveImage')
  if (!id) throw new Error('no SaveImage in graph')
  return id
}

/**
 * Walks the image inputs back from SaveImage, returning the class chain.
 *
 * The post-processing nodes all disagree on what to call their main image input
 * — SaveImage `images`, Film Grain and FaceDetailer `image`, ColorMatch
 * `image_target`, ImageCompositeMasked `destination` — so the walker tries them
 * in that priority order. Knowing only `images` stopped it at the grain node;
 * knowing only `images`/`image` stopped it at ColorMatch, which sits between the
 * swap and the detailer and made the detailer look absent.
 */
function chainToSave(g: ComfyUIPrompt): string[] {
  const chain: string[] = []
  const next = (id: string) => {
    const i = g[id].inputs
    return (i.images ?? i.image ?? i.image_target ?? i.destination) as [string, number] | undefined
  }
  let ref = next(saveNode(g))
  for (let i = 0; ref && i < 40; i++) {
    const node = g[ref[0]]
    if (!node) break
    chain.push(node.class_type)
    ref = next(ref[0])
  }
  return chain
}

describe('face detailer runs with, and before, the face swap', () => {
  it('covers every family that can swap', () => {
    // Pony and Illustrious are absent on purpose: `faceSwap` is false in their
    // SDXL config, so the control never appears for them.
    expect(swapFamilies.map((w: WorkflowDefinition) => w.id).sort()).toEqual([
      'ernie-turbo', 'krea2-raw', 'krea2-turbo', 'qwen21', 'qwen21-edit', 'qwen21-turbo', 'sdxl', 'z-image-turbo',
    ])
  })

  for (const wf of swapFamilies) {
    it(`${wf.id}: keeps the detailer when a swap is active`, () => {
      // Removing it is what breaks every render after the first — 3/12 vs 12/12.
      const g = wf.buildPrompt(withSwap())
      expect(g['swap:mask'], 'the swap chain is present').toBeDefined()
      expect(g['det:face'], 'the detailer must NOT be skipped for a swap').toBeDefined()
    })

    it(`${wf.id}: the swap chain sits downstream of FaceDetailer`, () => {
      const chain = chainToSave(wf.buildPrompt(withSwap()))
      const detailer = chain.indexOf('FaceDetailer')
      // ImageRGBA2RGB is the swap chain's terminal node — the one the whole
      // swap/mask/color-match block hands back — so its position stands for the
      // swap's position in the pipeline.
      const swapOut = chain.indexOf('ImageRGBA2RGB')
      expect(detailer).toBeGreaterThanOrEqual(0)
      expect(swapOut).toBeGreaterThanOrEqual(0)
      // The chain is walked backwards from SaveImage, so the node that runs LAST
      // comes first. The swap must therefore appear before the detailer here.
      expect(swapOut).toBeLessThan(detailer)
    })

    it(`${wf.id}: forces the detailer on even when explicitly disabled, if swapping`, () => {
      // Honouring `detailer: false` here would hand the user the 3/12 config.
      // The toggle is a preference; this is a workaround for a live bug.
      const g = wf.buildPrompt(withSwap({ detailer: false }))
      expect(g['det:face'], 'detailer forced on for a swap').toBeDefined()
      expect(g['swap:mask']).toBeDefined()
    })

    it(`${wf.id}: still honours a disabled detailer with no swap`, () => {
      // The override must be scoped to the swap, not a silent removal of the
      // user's control over a feature they turned off.
      const g = wf.buildPrompt(base({ detailer: false }))
      expect(g['det:face']).toBeUndefined()
      expect(g['swap:mask']).toBeUndefined()
    })
  }
})
