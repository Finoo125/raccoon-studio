import type { ComfyUIPrompt } from '@/types/comfyui'

export interface FaceSwapRefs {
  /** Node whose `inputs.images` is wrapped; the swapped result is rewired back into it. */
  saveNodeId: string
  /** Uploaded source-face filename on the ComfyUI server. Mutually exclusive with
   *  `faceModelName` — provide exactly one. */
  faceFilename?: string
  /** Saved ReActor face-model filename (in `models/reactor/faces/`) to swap from,
   *  loaded via `ReActorLoadFaceModel`. Mutually exclusive with `faceFilename`. */
  faceModelName?: string
  /** ReActor swap model; defaults to inswapper. */
  swapModel?: 'inswapper_128.onnx' | 'hyperswap_1a_256.onnx' | 'hyperswap_1b_256.onnx' | 'hyperswap_1c_256.onnx'
  /** Swap via the vendored RaccoonPixelBoostSwap node (FaceFusion pixel-boost:
   *  512-1024px effective swap resolution) instead of ReActorFaceSwap, followed
   *  by a light GPEN restore. Off by default. */
  pixelBoost?: boolean
  /** Effective swap resolution for the pixel-boost node; defaults to 512x512. */
  pixelBoostSize?: '512x512' | '768x768' | '1024x1024'
}

/**
 * Inserts a FaceFusion-grade ReActor face-swap chain into wf, wrapping whatever
 * currently feeds SaveImage so the swap runs LAST (latent resamples upstream
 * would otherwise erode the swapped identity).
 *
 * The chain is: ReActorFaceSwap → ReActorMaskHelper (YOLO-face + SAM feathered
 * composite onto the pre-swap image, so hair/glasses/hands stay in front and
 * edges blend — FaceFusion's region mask) → ColorMatch (re-seats face tone into
 * the scene lighting — FaceFusion's color matching). The enhancer is tuned down
 * (low restore visibility) so the mask blend and downstream film grain carry
 * skin texture rather than an over-restored, plastic face.
 *
 * The swap model picks the recommended ReActor flow: the 128px `inswapper` gets
 * a `ReActorFaceBoost` (GPEN @1024) to recover detail the low-res swap loses,
 * while `hyperswap_1a_256` swaps natively at 256px and skips the booster — which
 * ReActor only applies to inswapper/reswapper anyway.
 *
 * Node IDs use a `swap:` prefix to avoid collisions with numeric node IDs.
 */
export function appendFaceSwap(wf: ComfyUIPrompt, refs: FaceSwapRefs): void {
  const { saveNodeId, faceFilename, faceModelName, swapModel } = refs
  const model = swapModel ?? 'inswapper_128.onnx'
  // ReActor only boosts inswapper/reswapper; hyperswap ignores the booster, so
  // skip the node and leave face_boost unset for it.
  const usesBoost = !model.includes('hyperswap')

  // Capture the current SaveImage source — the pre-swap image. ReActor swaps
  // onto it and the mask helper composites against it.
  const preSwap = wf[saveNodeId].inputs.images as [string, number]

  // The source identity comes from either an uploaded photo (LoadImage →
  // source_image) or a saved face model (ReActorLoadFaceModel → face_model).
  // ReActor's source_image input is optional, so the model path wires face_model
  // and omits source_image entirely.
  const useModel = !!faceModelName
  if (useModel) {
    wf['swap:source'] = {
      class_type: 'ReActorLoadFaceModel',
      inputs: { face_model: faceModelName },
    }
  } else {
    wf['swap:source'] = {
      class_type: 'LoadImage',
      inputs: { image: faceFilename },
    }
  }

  const swapOut: [string, number] = refs.pixelBoost ? ['swap:restore', 0] : ['swap:reactor', 0]

  if (refs.pixelBoost) {
    // Pixel-boost path: swap at 512px effective resolution via the vendored
    // RaccoonPixelBoostSwap node, then a light GPEN pass instead of the heavy
    // in-swap restore — the swap itself now carries the detail.
    wf['swap:swap'] = {
      class_type: 'RaccoonPixelBoostSwap',
      inputs: {
        image: preSwap,
        swap_model: model,
        pixel_boost: refs.pixelBoostSize ?? '512x512',
        face_index: 0,
        ...(useModel
          ? { face_model: ['swap:source', 0] as [string, number] }
          : { source_image: ['swap:source', 0] as [string, number] }),
      },
    }
    wf['swap:restore'] = {
      class_type: 'ReActorRestoreFace',
      inputs: {
        image: ['swap:swap', 0],
        facedetection: 'retinaface_resnet50',
        model: 'GPEN-BFR-1024.onnx',
        visibility: 0.25,
        codeformer_weight: 0.5,
      },
    }
  } else {
  if (usesBoost) {
    // Pixel-boost: restore the swapped face crop at higher res before paste-back.
    wf['swap:boost'] = {
      class_type: 'ReActorFaceBoost',
      inputs: {
        enabled: true,
        // 1024 over 512: at typical face sizes the 512 restore is a downscale;
        // the A/B renders (2026-07-17) show visibly crisper eyes/brows with no
        // extra plastic look. The Models page + installers provision the file.
        boost_model: 'GPEN-BFR-1024.onnx',
        interpolation: 'Lanczos',
        visibility: 0.5,
        codeformer_weight: 0.5,
        restore_with_main_after: false,
      },
    }
  }

  wf['swap:reactor'] = {
    class_type: 'ReActorFaceSwap',
    inputs: {
      enabled: true,
      swap_model: model,
      facedetection: 'retinaface_resnet50',
      face_restore_model: 'GPEN-BFR-1024.onnx',
      // inswapper produces a soft 128px face; this GPEN restore is what brings it
      // back toward sharp. We originally ran it at 0.2 to avoid a plastic look,
      // but that left the swapped face — the eyes especially — visibly blurry.
      // 0.4 nudges it just sharp enough to resolve detail while the mask blend +
      // film grain downstream keep it from reading as over-restored / plastic.
      face_restore_visibility: 0.4,
      codeformer_weight: 1,
      detect_gender_input: 'no',
      detect_gender_source: 'no',
      input_faces_index: '0',
      source_faces_index: '0',
      console_log_level: 1,
      input_image: preSwap,
      // A saved face model feeds `face_model`; an uploaded photo feeds
      // `source_image`. ReActor uses the model over the image when both exist,
      // but we only ever wire one.
      ...(useModel
        ? { face_model: ['swap:source', 0] as [string, number] }
        : { source_image: ['swap:source', 0] as [string, number] }),
      ...(usesBoost ? { face_boost: ['swap:boost', 0] as [string, number] } : {}),
    },
  }
  }

  // Occlusion-aware mask + feathered composite (FaceFusion region mask). Loads
  // its own YOLO-face + SAM models from widget strings (no loader nodes).
  wf['swap:mask'] = {
    class_type: 'ReActorMaskHelper',
    inputs: {
      image: preSwap,
      swapped_image: swapOut,
      bbox_model_name: 'bbox/face_yolov8m.pt',
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3.0,
      bbox_drop_size: 10,
      sam_model_name: 'sam_vit_b_01ec64.pth',
      sam_dilation: 0,
      sam_threshold: 0.93,
      bbox_expansion: 0,
      mask_hint_threshold: 0.7,
      mask_hint_use_negative: 'False',
      morphology_operation: 'dilate',
      morphology_distance: 0,
      blur_radius: 9,
      sigma_factor: 1.0,
    },
  }

  // Color match (FaceFusion color matching): pull the composite's tone toward
  // the pre-swap image at low strength so the face re-seats into the scene
  // lighting without tinting the whole frame.
  wf['swap:color'] = {
    class_type: 'ColorMatch',
    inputs: {
      image_ref: preSwap,
      image_target: ['swap:mask', 0],
      method: 'mkl',
      strength: 0.5,
    },
  }

  // Flatten to RGB. ReActorMaskHelper returns a 4-channel RGBA image whenever it
  // detects no face (it only converts back to RGB inside its per-face loop), and
  // ColorMatch forwards those channels untouched. A downstream consumer that
  // blends against an RGB image — notably the Film Grain pass appended after the
  // swap — then dies with PIL's "images do not match". Stripping alpha here keeps
  // the chain's contract that it hands back a plain 3-channel image. The node is
  // a no-op on input that is already RGB.
  wf['swap:rgb'] = {
    class_type: 'ImageRGBA2RGB',
    inputs: { image: ['swap:color', 0] },
  }

  wf[saveNodeId].inputs.images = ['swap:rgb', 0]
}
