import type { ComfyUIPrompt } from '@/types/comfyui'

export interface FaceDetailerRefs {
  saveNodeId: string
  model: [string, number]
  clip: [string, number]
  vae: [string, number]
  positive: [string, number]
  negative: [string, number]
  sampler: {
    steps: number
    cfg: number
    sampler_name: string
    scheduler: string
    denoise: number
  }
}

/**
 * Inserts FaceDetailer + its two detector nodes into wf, wrapping whatever
 * currently feeds SaveImage so the detailer always runs last on the
 * final-resolution image.
 *
 * Node IDs use a `det:` prefix to avoid collisions with any numeric node IDs.
 */
export function appendFaceDetailer(wf: ComfyUIPrompt, refs: FaceDetailerRefs): void {
  const { saveNodeId, model, clip, vae, positive, negative, sampler } = refs

  // Capture the current SaveImage image source — the detailer wraps it.
  const imageInput = wf[saveNodeId].inputs.images as [string, number]

  wf['det:provider'] = {
    class_type: 'UltralyticsDetectorProvider',
    inputs: {
      model_name: 'bbox/face_yolov8m.pt',
    },
  }

  wf['det:sam'] = {
    class_type: 'SAMLoader',
    inputs: {
      model_name: 'sam_vit_b_01ec64.pth',
      device_mode: 'AUTO',
    },
  }

  wf['det:face'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: imageInput,
      model,
      clip,
      vae,
      positive,
      negative,
      bbox_detector: ['det:provider', 0],
      sam_model_opt: ['det:sam', 0],
      // Redraw the cropped face at a slightly higher working resolution so the
      // pasted-back face carries a touch more detail (reads as sharper) — this
      // is face-only, unlike a whole-image sharpen filter.
      guide_size: 640,
      guide_size_for: true,
      max_size: 1024,
      feather: 14,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 2.0,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      // [CONCAT] appends these tokens to the existing positive conditioning
      // (Impact Pack core.py) rather than replacing the scene prompt, so the
      // face redraw keeps context while pulling back natural skin texture that
      // the ReActor/GPEN restore pass tends to smooth into a plastic look.
      wildcard: '[CONCAT]detailed skin texture, visible skin pores, natural skin tone, subsurface scattering, no makeup',
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
      scheduler: sampler.scheduler,
      denoise: sampler.denoise,
      steps: sampler.steps,
      cfg: sampler.cfg,
      sampler_name: sampler.sampler_name,
      seed: Math.floor(Math.random() * 9999999999999),
    },
  }

  wf[saveNodeId].inputs.images = ['det:face', 0]
}
