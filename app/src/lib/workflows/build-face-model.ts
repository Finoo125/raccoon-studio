import type { ComfyUIPrompt } from '@/types/comfyui'

export interface BuildFaceModelRefs {
  /** Uploaded reference-face filenames on the ComfyUI server (≥ 1). When more
   *  than one is given they are blended into a single averaged identity. */
  faceFilenames: string[]
  /** Destination model name (no extension); saved to `models/reactor/faces/<name>.safetensors`. */
  modelName: string
  /** How multiple faces are combined into one model. ReActor default: Mean. */
  computeMethod?: 'Mean' | 'Median' | 'Mode'
}

/**
 * Builds a ComfyUI graph that creates and saves a ReActor face model from one or
 * more reference photos.
 *
 * Each photo is a `LoadImage`; multiple photos are folded into a single IMAGE
 * batch by chaining `ImageBatch` (core ComfyUI, combines two images at a time)
 * so `ReActorBuildFaceModel` receives them as one batch and averages them into a
 * single identity. `ReActorBuildFaceModel` is an OUTPUT_NODE, so with
 * `save_mode` enabled it writes `<modelName>.safetensors` into ComfyUI's
 * `models/reactor/faces/` dir and the graph needs no other terminal node.
 *
 * Node IDs use a `bfm:` prefix to avoid collisions with numeric node IDs.
 */
export function buildFaceModelPrompt(refs: BuildFaceModelRefs): ComfyUIPrompt {
  const { faceFilenames, modelName, computeMethod } = refs
  if (faceFilenames.length === 0) {
    throw new Error('buildFaceModelPrompt needs at least one face image')
  }

  const wf: ComfyUIPrompt = {}

  // One LoadImage per reference photo.
  faceFilenames.forEach((name, i) => {
    wf[`bfm:img${i}`] = {
      class_type: 'LoadImage',
      inputs: { image: name },
    }
  })

  // Fold the loaded images into a single batch. ImageBatch combines two at a
  // time, so chain them: batch0 = img0+img1, batch1 = batch0+img2, …
  let imagesRef: [string, number] = ['bfm:img0', 0]
  for (let i = 1; i < faceFilenames.length; i++) {
    const id = `bfm:batch${i - 1}`
    wf[id] = {
      class_type: 'ImageBatch',
      inputs: { image1: imagesRef, image2: [`bfm:img${i}`, 0] as [string, number] },
    }
    imagesRef = [id, 0]
  }

  wf['bfm:build'] = {
    class_type: 'ReActorBuildFaceModel',
    inputs: {
      save_mode: true,
      send_only: false,
      face_model_name: modelName,
      compute_method: computeMethod ?? 'Mean',
      images: imagesRef,
    },
  }

  return wf
}
