import { describe, it, expect } from 'vitest'
import { appendFaceSwap } from './face-swap'
import type { ComfyUIPrompt } from '@/types/comfyui'

function baseGraph(): ComfyUIPrompt {
  return {
    save: { class_type: 'SaveImage', inputs: { images: ['decode', 0] } },
  } as unknown as ComfyUIPrompt
}

describe('appendFaceSwap', () => {
  it('wraps the SaveImage source with the swap → mask → color chain', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, { saveNodeId: 'save', faceFilename: 'face.png' })

    // Source face image
    expect(wf['swap:source'].class_type).toBe('LoadImage')
    expect(wf['swap:source'].inputs.image).toBe('face.png')

    // ReActor swap reads the captured pre-swap source
    expect(wf['swap:reactor'].class_type).toBe('ReActorFaceSwap')
    expect(wf['swap:reactor'].inputs.input_image).toEqual(['decode', 0])
    expect(wf['swap:reactor'].inputs.source_image).toEqual(['swap:source', 0])
    expect(wf['swap:reactor'].inputs.face_boost).toEqual(['swap:boost', 0])
    expect(wf['swap:boost'].class_type).toBe('ReActorFaceBoost')
    expect(wf['swap:reactor'].inputs.swap_model).toBe('inswapper_128.onnx')

    // Mask helper feathers swap onto the pre-swap source
    expect(wf['swap:mask'].class_type).toBe('ReActorMaskHelper')
    expect(wf['swap:mask'].inputs.image).toEqual(['decode', 0])
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:reactor', 0])
    expect(wf['swap:mask'].inputs.bbox_model_name).toBe('bbox/face_yolov8m.pt')
    expect(wf['swap:mask'].inputs.sam_model_name).toBe('sam_vit_b_01ec64.pth')

    // Color match nudges tone toward the pre-swap source
    expect(wf['swap:color'].class_type).toBe('ColorMatch')
    expect(wf['swap:color'].inputs.image_ref).toEqual(['decode', 0])
    expect(wf['swap:color'].inputs.image_target).toEqual(['swap:mask', 0])

    // Flatten to RGB before handing back: ReActorMaskHelper emits a 4-channel
    // RGBA image when it detects no face, and ColorMatch passes those channels
    // through — a downstream Film Grain blend then dies with "images do not
    // match". The strip keeps the chain's output a plain 3-channel image.
    expect(wf['swap:rgb'].class_type).toBe('ImageRGBA2RGB')
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])

    // SaveImage now reads the flattened composite
    expect(wf['save'].inputs.images).toEqual(['swap:rgb', 0])
  })

  it('honors an explicit hyperswap model and drops the boost stage', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, { saveNodeId: 'save', faceFilename: 'f.png', swapModel: 'hyperswap_1a_256.onnx' })
    expect(wf['swap:reactor'].inputs.swap_model).toBe('hyperswap_1a_256.onnx')
    // ReActor only boosts inswapper/reswapper, so hyperswap skips the booster
    // node entirely and leaves face_boost unset.
    expect(wf['swap:boost']).toBeUndefined()
    expect(wf['swap:reactor'].inputs.face_boost).toBeUndefined()
    // The swap → mask → color chain is otherwise identical.
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:reactor', 0])
    expect(wf['swap:color'].inputs.image_target).toEqual(['swap:mask', 0])
    expect(wf['swap:rgb'].inputs.image).toEqual(['swap:color', 0])
    expect(wf['save'].inputs.images).toEqual(['swap:rgb', 0])
  })

  it('builds the pixel-boost chain when pixelBoost is set', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, {
      saveNodeId: 'save', faceFilename: 'f.png',
      swapModel: 'hyperswap_1c_256.onnx', pixelBoost: true,
    })
    // ReActor swap + boost are absent; the Raccoon node takes their place.
    expect(wf['swap:reactor']).toBeUndefined()
    expect(wf['swap:boost']).toBeUndefined()
    expect(wf['swap:swap'].class_type).toBe('RaccoonPixelBoostSwap')
    expect(wf['swap:swap'].inputs.swap_model).toBe('hyperswap_1c_256.onnx')
    expect(wf['swap:swap'].inputs.pixel_boost).toBe('512x512')
    expect(wf['swap:swap'].inputs.source_image).toEqual(['swap:source', 0])
    // Light restore replaces the heavy in-swap restore.
    expect(wf['swap:restore'].class_type).toBe('ReActorRestoreFace')
    expect(wf['swap:restore'].inputs.model).toBe('GPEN-BFR-1024.onnx')
    expect(wf['swap:restore'].inputs.visibility).toBe(0.25)
    expect(wf['swap:restore'].inputs.image).toEqual(['swap:swap', 0])
    // Downstream chain unchanged, fed by the restore.
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:restore', 0])
    expect(wf['save'].inputs.images).toEqual(['swap:rgb', 0])
  })

  it('honors an explicit pixel-boost size', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, {
      saveNodeId: 'save', faceFilename: 'f.png',
      swapModel: 'hyperswap_1c_256.onnx', pixelBoost: true, pixelBoostSize: '768x768',
    })
    expect(wf['swap:swap'].inputs.pixel_boost).toBe('768x768')
  })

  it('wires a saved face model into the pixel-boost node', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, {
      saveNodeId: 'save', faceModelName: 'alice.safetensors', pixelBoost: true,
    })
    expect(wf['swap:source'].class_type).toBe('ReActorLoadFaceModel')
    expect(wf['swap:swap'].inputs.face_model).toEqual(['swap:source', 0])
    expect(wf['swap:swap'].inputs.source_image).toBeUndefined()
  })

  it('treats the 1b/1c hyperswap variants as boostless too', () => {
    for (const swapModel of ['hyperswap_1b_256.onnx', 'hyperswap_1c_256.onnx'] as const) {
      const wf = baseGraph()
      appendFaceSwap(wf, { saveNodeId: 'save', faceFilename: 'f.png', swapModel })
      expect(wf['swap:reactor'].inputs.swap_model).toBe(swapModel)
      expect(wf['swap:boost']).toBeUndefined()
      expect(wf['swap:reactor'].inputs.face_boost).toBeUndefined()
    }
  })

  it('swaps from a saved face model via ReActorLoadFaceModel', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, { saveNodeId: 'save', faceModelName: 'alice.safetensors' })

    // The source identity is loaded from the saved model, not a LoadImage.
    expect(wf['swap:source'].class_type).toBe('ReActorLoadFaceModel')
    expect(wf['swap:source'].inputs.face_model).toBe('alice.safetensors')

    // ReActor reads the model via face_model and leaves source_image unwired.
    expect(wf['swap:reactor'].inputs.face_model).toEqual(['swap:source', 0])
    expect(wf['swap:reactor'].inputs.source_image).toBeUndefined()

    // The rest of the chain is unchanged.
    expect(wf['swap:mask'].inputs.swapped_image).toEqual(['swap:reactor', 0])
    expect(wf['save'].inputs.images).toEqual(['swap:rgb', 0])
  })

  it('restores the swapped face enough to keep it sharp (not blurry)', () => {
    const wf = baseGraph()
    appendFaceSwap(wf, { saveNodeId: 'save', faceFilename: 'f.png' })
    expect(wf['swap:reactor'].inputs.face_restore_model).toBe('GPEN-BFR-1024.onnx')
    // inswapper outputs a soft 128px face; the GPEN restore is what sharpens it.
    // Too low a visibility (we shipped 0.2) leaves the eyes visibly blurry, so
    // nudge it up just enough to resolve detail while the mask blend + film grain
    // still soften any plastic sheen.
    expect(wf['swap:reactor'].inputs.face_restore_visibility).toBe(0.4)
    expect(wf['swap:boost'].inputs.boost_model).toBe('GPEN-BFR-1024.onnx')
    expect(wf['swap:boost'].inputs.restore_with_main_after).toBe(false)
  })
})
