import { describe, it, expect } from 'vitest'
import {
  appendVideoFaceSwap,
  buildDetectFacesPrompt,
  buildVideoFaceSwapPrompt,
  clipFromUrl,
  pendingPost,
  validateCharacters,
  DETECT_FACES_NODE,
  buildDetectPictureFacesPrompt,
  isNoFaceError,
  MAX_SWAP_CHARACTERS,
  OCCLUSION_OFF,
  VIDEO_SWAP_NODE,
  type SwapCharacter,
  type VideoSource,
} from './video-face-swap'
import { H3_RIFE_FPS } from './minimax-h3'
import type { ComfyUIPrompt } from '@/types/comfyui'

const CLIP: VideoSource = { file: 'MinimaxH3/2026-09-07/clip.mp4', location: 'output' }
const ALICE: SwapCharacter = { reference: 'ref_0.png', faceModel: 'alice.safetensors' }
const BOB: SwapCharacter = { reference: 'ref_1.png', sourceImage: 'bob.png' }

function swap(over: Partial<Parameters<typeof buildVideoFaceSwapPrompt>[0]> = {}) {
  return buildVideoFaceSwapPrompt({ clip: CLIP, characters: [ALICE], ...over })
}

describe('availability probe contract', () => {
  // Same doctrine as face-swap.test.ts: the UI probes these class names via
  // /object_info before offering the feature, so a builder that emitted a
  // different class would advertise a working feature and then fail at queue
  // time with a bare "Generation failed".
  it('emits the class the UI probes for the video swap', () => {
    expect(swap()['vfs:swap'].class_type).toBe(VIDEO_SWAP_NODE)
  })

  it('emits the class the UI probes for face detection', () => {
    const wf = buildDetectFacesPrompt({ clip: CLIP, position: 0.5, namePrefix: 'c1' })
    expect(wf['det:detect'].class_type).toBe(DETECT_FACES_NODE)
  })
})

describe('clip addressing', () => {
  it('annotates an app-rendered clip so LoadVideo reads from output/', () => {
    // The mechanism H3 continuation already relies on — without it core
    // LoadVideo looks in input/ and the job dies on a missing file.
    expect(swap()['vfs:load'].inputs.file).toBe('MinimaxH3/2026-09-07/clip.mp4 [output]')
  })

  it('leaves an uploaded clip unannotated', () => {
    const wf = swap({ clip: { file: 'imported.mp4', location: 'input' } })
    expect(wf['vfs:load'].inputs.file).toBe('imported.mp4')
  })
})

describe('clipFromUrl', () => {
  it('reads a fresh render off the ComfyUI view route', () => {
    const c = clipFromUrl('/api/comfyui/view?filename=clip.mp4&subfolder=MinimaxH3%2F2026-09-07&type=output')
    expect(c).toEqual({ file: 'MinimaxH3/2026-09-07/clip.mp4', location: 'output' })
  })

  it('treats the gallery route, which carries no type, as output', () => {
    // /api/gallery/video serves only what is in the output dir, and that is also
    // ComfyUI's own default — so a missing type is output, not "unknown".
    expect(clipFromUrl('/api/gallery/video?filename=a.mp4&subfolder=')).toEqual({
      file: 'a.mp4', location: 'output',
    })
  })

  it('normalises a Windows subfolder', () => {
    // The value goes into a ComfyUI node input, not onto a filesystem call.
    expect(clipFromUrl('/x?filename=a.mp4&subfolder=v%5C2026')?.file).toBe('v/2026/a.mp4')
  })

  it('keeps an uploaded clip pointed at the input dir', () => {
    expect(clipFromUrl('/x?filename=a.mp4&subfolder=&type=input')?.location).toBe('input')
  })

  it('returns null rather than a broken source when there is no filename', () => {
    expect(clipFromUrl('/api/comfyui/view')).toBeNull()
  })
})

describe('graph shape', () => {
  it('keeps the clip audio and frame rate on the rendered path', () => {
    // Both come off GetVideoComponents rather than being re-derived. H3
    // generates its audio jointly with the picture, so a wrong fps here plays
    // the clip at the wrong speed AND drifts it out of sync with its own sound.
    const wf = swap()
    expect(wf['vfs:video'].inputs.audio).toEqual(['vfs:parts', 1])
    expect(wf['vfs:video'].inputs.fps).toEqual(['vfs:parts', 2])
    expect(wf['vfs:video'].inputs.images).toEqual(['vfs:swap', 0])
    expect(wf['vfs:save'].inputs.video).toEqual(['vfs:video', 0])
  })

  it('needs no node pack beyond ours and ReActor', () => {
    // The graph is deliberately core-only otherwise: no VHS, no new pin. A
    // custom class creeping in here is a new install-time dependency.
    const allowed = new Set([VIDEO_SWAP_NODE, 'ReActorLoadFaceModel'])
    const core = ['LoadVideo', 'GetVideoComponents', 'LoadImage', 'CreateVideo', 'SaveVideo']
    for (const node of Object.values(swap({ characters: [ALICE, BOB] }))) {
      expect(allowed.has(node.class_type) || core.includes(node.class_type)).toBe(true)
    }
  })

  it('passes the scrubber position straight to the detector', () => {
    // A fraction, not a frame index: the app cannot see the clip's frame rate
    // (H3 pins 24, RIFE makes it 36, LTX varies), and an mp4 does not carry the
    // graph that made it. The node resolves it against the real batch length.
    const wf = buildDetectFacesPrompt({ clip: CLIP, position: 0.42, namePrefix: 'clip-1' })
    expect(wf['det:detect'].inputs.position).toBe(0.42)
    expect(wf['det:detect'].inputs.image).toEqual(['det:parts', 0])
    expect(wf['det:detect'].inputs.name_prefix).toBe('clip-1')
  })

  it('clamps a position the player can actually produce', () => {
    // currentTime/duration is NaN before metadata loads and can tip past 1 at
    // the very end; neither may reach the node as a raw float.
    const nan = buildDetectFacesPrompt({ clip: CLIP, position: NaN, namePrefix: 'c' })
    expect(nan['det:detect'].inputs.position).toBe(0.5)
    expect(buildDetectFacesPrompt({ clip: CLIP, position: 1.4, namePrefix: 'c' })['det:detect'].inputs.position).toBe(1)
    expect(buildDetectFacesPrompt({ clip: CLIP, position: -2, namePrefix: 'c' })['det:detect'].inputs.position).toBe(0)
  })
})

describe('character slots', () => {
  it('wires a face model through ReActorLoadFaceModel and a photo through LoadImage', () => {
    const wf = swap({ characters: [ALICE, BOB] })
    expect(wf['vfs:model1'].class_type).toBe('ReActorLoadFaceModel')
    expect(wf['vfs:model1'].inputs.face_model).toBe('alice.safetensors')
    expect(wf['vfs:swap'].inputs.face_model_1).toEqual(['vfs:model1', 0])

    expect(wf['vfs:photo2'].class_type).toBe('LoadImage')
    expect(wf['vfs:photo2'].inputs.image).toBe('bob.png')
    expect(wf['vfs:swap'].inputs.source_image_2).toEqual(['vfs:photo2', 0])
  })

  it('wires exactly one replacement per slot', () => {
    // The node prefers a face model when both are set; wiring both anyway would
    // make the graph claim a photo is in use when it is being ignored.
    const wf = swap({ characters: [{ ...ALICE, sourceImage: 'ignored.png' }] })
    expect(wf['vfs:swap'].inputs.source_image_1).toBeUndefined()
    expect(wf['vfs:photo1']).toBeUndefined()
  })

  it('gives every slot its reference crop', () => {
    const wf = swap({ characters: [ALICE, BOB] })
    expect(wf['vfs:ref1'].inputs.image).toBe('ref_0.png')
    expect(wf['vfs:ref2'].inputs.image).toBe('ref_1.png')
    expect(wf['vfs:swap'].inputs.reference_1).toEqual(['vfs:ref1', 0])
    expect(wf['vfs:swap'].inputs.reference_2).toEqual(['vfs:ref2', 0])
  })

  it('leaves unused slots off the node entirely', () => {
    const inputs = swap()['vfs:swap'].inputs
    expect(inputs.reference_2).toBeUndefined()
    expect(inputs.face_model_2).toBeUndefined()
  })
})

describe('validateCharacters', () => {
  it('rejects an empty list', () => {
    expect(() => validateCharacters([])).toThrow(/at least one/i)
  })

  it('rejects more characters than there are slots', () => {
    const many = Array.from({ length: MAX_SWAP_CHARACTERS + 1 }, () => ALICE)
    expect(() => validateCharacters(many)).toThrow(/At most 4/)
  })

  it('rejects a character with no replacement face', () => {
    // The dangerous half-pairing. Skipping it silently would render a clip that
    // looks finished and still has the wrong face in it — and the only way to
    // notice is to watch the whole thing.
    expect(() => validateCharacters([{ reference: 'ref_0.png' }])).toThrow(/no replacement/)
  })

  it('rejects a replacement with no reference', () => {
    expect(() => validateCharacters([{ reference: '', faceModel: 'alice.safetensors' }]))
      .toThrow(/no reference/)
  })

  it('runs before the graph is built', () => {
    expect(() => buildVideoFaceSwapPrompt({ clip: CLIP, characters: [] })).toThrow()
  })
})

describe('options', () => {
  it('writes every knob explicitly', () => {
    // A prompt posted through the API carries no widget values, so an omitted
    // input is a missing argument rather than a default.
    const inputs = swap()['vfs:swap'].inputs
    for (const key of ['pixel_boost', 'identity', 'match_threshold', 'min_score', 'smooth', 'occlusion']) {
      expect(inputs[key]).toBeDefined()
    }
  })

  it('leaves occlusion off unless a model is named', () => {
    // It needs an optional 70 MB download and the node raises without it, so the
    // caller has to have read the installed list off /object_info first.
    expect(swap()['vfs:swap'].inputs.occlusion).toBe(OCCLUSION_OFF)
    expect(swap({ occluder: 'xseg_1.onnx' })['vfs:swap'].inputs.occlusion).toBe('xseg_1.onnx')
    // An empty string is "nothing selected", not a filename to hand the node.
    expect(swap({ occluder: '' })['vfs:swap'].inputs.occlusion).toBe(OCCLUSION_OFF)
  })

  it('omits swap_model rather than guessing one', () => {
    // The node picks a 256px swapper from what is actually installed; naming a
    // model the box does not have would fail validation for the whole prompt.
    //
    // This only works because the node declares `swap_model` OPTIONAL. It was
    // required at first, and ComfyUI rejected every swap with
    // `required_input_missing` — a posted graph carries no widget values, so a
    // required input the caller omits is simply absent. Caught by the live
    // schema check, 2026-09-07; if it ever goes back to required, this test
    // still passes and every real swap breaks.
    expect(swap()['vfs:swap'].inputs.swap_model).toBeUndefined()
    expect(swap({ swapModel: 'hyperswap_1c_256.onnx' })['vfs:swap'].inputs.swap_model)
      .toBe('hyperswap_1c_256.onnx')
  })
})

describe('appendVideoFaceSwap (in-render splice)', () => {
  it('wraps a frame source and hands back its node id', () => {
    const wf = {} as ComfyUIPrompt
    const id = appendVideoFaceSwap(wf, ['decode', 0], { characters: [ALICE] })
    expect(id).toBe('vfs:swap')
    expect(wf[id].inputs.image).toEqual(['decode', 0])
  })

  it('sends `strict` only when asked, so existing swap graphs are unchanged', () => {
    const plain = {} as ComfyUIPrompt
    appendVideoFaceSwap(plain, ['decode', 0], { characters: [ALICE] })
    expect('strict' in plain['vfs:swap'].inputs).toBe(false)
    const lenient = {} as ComfyUIPrompt
    appendVideoFaceSwap(lenient, ['decode', 0], { characters: [ALICE], strict: false })
    expect(lenient['vfs:swap'].inputs.strict).toBe(false)
  })

  it('takes a prefix so it can coexist with the post-process graph ids', () => {
    const wf = {} as ComfyUIPrompt
    const id = appendVideoFaceSwap(wf, ['decode', 0], { characters: [ALICE] }, 'h3swap')
    expect(id).toBe('h3swap:swap')
    expect(wf['h3swap:ref1']).toBeDefined()
  })
})

describe('the finishing chain a render held back', () => {
  const classes = (wf: ComfyUIPrompt) => Object.values(wf).map((n) => n.class_type)

  it('runs nothing extra on a clip that is already finished', () => {
    // The gallery and imported-video case. Grain here would grain a grained
    // clip twice and the upscale would take a delivered one to 2.25x.
    expect(classes(swap())).not.toContain('Film Grain')
    expect(classes(swap())).not.toContain('RIFEInterpolation')
  })

  it('grains only when the render asked for it, the same opt-in rule as the render', () => {
    // `filmGrain` is opt-IN in the render (2026-10-14), so an unticked box has to
    // mean the same thing here, and a ticked one must survive the deferral.
    expect(classes(swap({ post: {} }))).not.toContain('Film Grain')
    expect(classes(swap({ post: { filmGrain: true } }))).toContain('Film Grain')
  })

  it('puts the chain between the swap and the container', () => {
    const wf = swap({ post: { rife: true, upscale: true, sharpen: true, filmGrain: true } })
    // Walk back from the container: every pass must sit downstream of the swap,
    // which is the whole point — passes ahead of it would be swapped over.
    const seen: string[] = []
    let ref = wf['vfs:video'].inputs.images as [string, number]
    while (ref[0] !== 'vfs:swap') {
      const n = wf[ref[0]]
      seen.push(n.class_type)
      // `images` on most, `image` on the sharpener and the grain node.
      ref = (n.inputs.images ?? n.inputs.image) as [string, number]
    }
    expect(seen).toEqual(['Film Grain', 'ImageSharpenKJ', 'RTXVideoSuperResolution', 'RIFEInterpolation'])
    expect(wf['vfs:save'].inputs.video).toEqual(['vfs:video', 0])
  })

  it('moves the container fps when it interpolates', () => {
    // Off, the clip's own fps rides through GetVideoComponents; on, it has to
    // become the interpolated rate or the clip plays slow against its own audio.
    expect(swap({ post: {} })['vfs:video'].inputs.fps).toEqual(['vfs:parts', 2])
    expect(swap({ post: { rife: true } })['vfs:video'].inputs.fps).toBe(H3_RIFE_FPS)
  })

  it('keeps the original face on turned or covered frames only for a "Swap faces first" clip', () => {
    // Absent elsewhere (the node's input is optional and defaults off): on the gallery
    // and Movie Maker paths, and in Edit's in-render splice, where the original face
    // is a different person and bringing it back would flicker between two.
    expect(swap({ post: {} })['vfs:swap'].inputs.gate).toBe(true)
    expect(swap()['vfs:swap'].inputs).not.toHaveProperty('gate')
  })
})

describe('pendingPost', () => {
  it('is null unless the render actually deferred', () => {
    expect(pendingPost({ filmGrain: true, upscale: true })).toBeNull()
    expect(pendingPost(undefined)).toBeNull()
  })

  it('carries the four passes across', () => {
    expect(pendingPost({ swapFaces: true, rife: true, filmGrain: false })).toEqual({
      rife: true,
      upscale: undefined,
      sharpen: undefined,
      filmGrain: false,
    })
  })
})

describe('buildDetectPictureFacesPrompt', () => {
  it('runs the detector on one still picture', () => {
    const wf = buildDetectPictureFacesPrompt('me.png', 'edit_face')
    expect(wf['det:load']).toEqual({ class_type: 'LoadImage', inputs: { image: 'me.png' } })
    expect(wf['det:detect'].class_type).toBe(DETECT_FACES_NODE)
    expect(wf['det:detect'].inputs).toMatchObject({ image: ['det:load', 0], position: 0, name_prefix: 'edit_face', max_faces: 1 })
    // The swap finds its reference and source faces at the analyzer's 0.5; a check
    // at a lower floor would pass a picture the render then fails on.
    expect(wf['det:detect'].inputs.min_score).toBe(0.5)
  })
})

describe('isNoFaceError', () => {
  it("reads the detector's no-face refusal as an answer, not a failure", () => {
    expect(isNoFaceError(new Error('ComfyUI: RaccoonDetectFaces: no face found in this frame — scrub to one'))).toBe(true)
    expect(isNoFaceError(new Error('Timed out waiting for ComfyUI'))).toBe(false)
    expect(isNoFaceError('no face found')).toBe(false)
  })
})
