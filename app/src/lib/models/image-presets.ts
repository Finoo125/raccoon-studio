/** The image presets' downloadable files — one list for the Models page and the first-start setup. Moved out of models/page.tsx, which a Next page file cannot export from. */

import { KREA2_REFUSAL_LORA, KREA2_PROJECTOR_LORA } from '@/lib/workflows/krea2'
import { QWEN21_BASE_UNET, QWEN21_TURBO_UNET, QWEN21_EXPERIMENTAL } from '@/lib/workflows/qwen21'

export interface ModelFile {
  name: string
  path: string
  url: string
  sizeMb: number
  /** Not needed to render — an extra the preset uses when present (patched in only once ComfyUI reports it). */
  optional?: boolean
}

export interface PresetDefinition {
  id: string
  name: string
  description: string
  files: ModelFile[]
}

// The SDXL fp16-fix VAE is a required part of working with the SDXL-family
// checkpoints (SDXL/Pony/Illustrious all decode through it to avoid washed-out
// colors), so it ships inside each of those presets. One shared file object —
// the download de-dupes on disk, so grabbing any one model fetches it once.
// Name/path must match SDXL_FIX_VAE in lib/workflows/sdxl.ts.
const SDXL_VAE_FILE: ModelFile = {
  name: 'sdxl_vae.safetensors',
  path: 'vae',
  url: 'https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl.vae.safetensors',
  sizeMb: 335,
}

// Both Anima checkpoints run on the same Qwen text encoder + VAE, so those two
// files appear in both presets — the download de-dupes on disk, so whichever
// preset is grabbed second only fetches its checkpoint.
const ANIMA_SHARED_FILES: ModelFile[] = [
  {
    name: 'qwen_3_06b_base.safetensors',
    path: 'text_encoders',
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors',
    sizeMb: 1200,
  },
  {
    name: 'qwen_image_vae.safetensors',
    path: 'vae',
    url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors',
    sizeMb: 160,
  },
]

// Krea2 Turbo and RAW run on the same Qwen3-VL text encoder, VAE and pair of
// built-in LoRAs, so those four files appear in both presets — the download
// de-dupes on disk, so whichever preset is grabbed second only fetches its
// 13 GB checkpoint. The VAE de-dupes with Anima's copy of the same file too.
// Both LoRA filenames come from lib/workflows/krea2.ts: the builder asks ComfyUI
// for exactly these names, so renaming one here is a silent generation failure.
const KREA2_SHARED_FILES: ModelFile[] = [
  {
    name: 'qwen3vl_4b_fp8_scaled.safetensors',
    path: 'text_encoders',
    url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
    sizeMb: 5000,
  },
  {
    name: 'qwen_image_vae.safetensors',
    path: 'vae',
    url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors',
    sizeMb: 242,
  },
  {
    // TextFusion refusal-reduction patch, applied at strength 1. Hosted on a
    // third-party mirror because the canonical Civitai listing (model 2775340)
    // requires an API token; verified public and unauthenticated 2026-07-27.
    name: KREA2_REFUSAL_LORA,
    optional: true,
    path: 'loras',
    url: 'https://huggingface.co/Kutches/Kr3a/resolve/main/Krea2_TextFusion_Refusal_Reduction.safetensors',
    sizeMb: 27,
  },
  {
    // Projector-scale patch (the "NSFW filter" slider in Generate). Upstream
    // ships it under the generic name `pytorch_lora_weights.safetensors`, which
    // is meaningless in a shared loras/ folder, so it is renamed on the way in.
    // All of 268 bytes — two rank-1 tensors on the text-fusion projector.
    name: KREA2_PROJECTOR_LORA,
    optional: true,
    path: 'loras',
    url: 'https://huggingface.co/Beinsezii/Krea-2-Turbo-Projector-Scale-LoRA-Diffusers/resolve/main/pytorch_lora_weights.safetensors',
    sizeMb: 1,
  },
  {
    // Danrisi's Lenovo UltraReal for Krea 2 (Civitai model 1662740, version 3075606): a candid real-camera look and
    // real light, the owner's pick against plastic Krea2 skin (2026-10-14, at 0.6 — 0.6 and 0.9 looked alike, 1.2
    // was more than needed). Offered with the preset so it is there to pick in the LoRA slots; nothing applies it by
    // itself. The Civitai download link answers without a token (verified 2026-10-14) — move it to a mirror the day
    // it does not, as the refusal LoRA above had to. Renamed from `lenovo_krea2.safetensors` on the way in.
    name: 'krea2_lenovo_ultrareal_v1.safetensors',
    optional: true,
    path: 'loras',
    url: 'https://civitai.com/api/download/models/3075606',
    sizeMb: 109,
  },
]

// Both Qwen-Image 2.1 presets run on the same Qwen3-VL-8B text encoder and VAE,
// so those two files appear in both — the download de-dupes on disk. The model
// filenames come from lib/workflows/qwen21.ts: the builder loads exactly these.
const QWEN21_HF = 'https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main'
const QWEN21_SHARED_FILES: ModelFile[] = [
  {
    name: 'qwen3vl_8b_int8_convrot.safetensors',
    path: 'text_encoders',
    url: `${QWEN21_HF}/text_encoders/qwen3vl_8b_int8_convrot.safetensors`,
    sizeMb: 8918,
  },
  {
    name: 'qwen_image_2.1_vae_bf16.safetensors',
    path: 'vae',
    url: `${QWEN21_HF}/vae/qwen_image_2.1_vae_bf16.safetensors`,
    sizeMb: 644,
  },
  {
    // Danrisi's Lenovo UltraReal for Qwen-Image 2.1 (trigger l3n0v0, 0.7 on its card): candid phone-photo light,
    // the realism half of the 2026-10-14 Qwen recipe. Public, ungated Hugging Face repo; renamed on the way in so
    // it sits beside its Krea2 twin. Offered for the LoRA slots; nothing applies it by itself.
    name: 'qwen21_lenovo_ultrareal_v1.safetensors',
    optional: true,
    path: 'loras',
    url: 'https://huggingface.co/Danrisi/lenovo_qwen2.1/resolve/main/lenovo_qwen21.safetensors',
    sizeMb: 76,
  },
]

const QWEN21_BASE_FILE: ModelFile = {
  name: QWEN21_BASE_UNET,
  path: 'diffusion_models',
  url: `${QWEN21_HF}/diffusion_models/${QWEN21_BASE_UNET}`,
  sizeMb: 6921,
}

export const IMAGE_PRESETS: PresetDefinition[] = [
  {
    id: 'anima',
    name: 'Anima',
    description: 'Anime-style text-to-image',
    files: [
      {
        name: 'anima-aesthetic-v1.1.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors',
        sizeMb: 4000,
      },
      ...ANIMA_SHARED_FILES,
    ],
  },
  {
    id: 'anima-turbo',
    name: 'Anima Turbo',
    description: 'Distilled Anima — same look, ~3× fewer steps',
    files: [
      {
        name: 'anima-turbo-v1.0.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-turbo-v1.0.safetensors',
        sizeMb: 4000,
      },
      ...ANIMA_SHARED_FILES,
    ],
  },
  {
    id: 'ernie-turbo',
    name: 'Ernie Image Turbo',
    description: 'Fast photorealistic generation',
    files: [
      {
        name: 'ernie-image-turbo.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/diffusion_models/ernie-image-turbo.safetensors',
        sizeMb: 13000,
      },
      {
        name: 'ministral-3-3b.safetensors',
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ministral-3-3b.safetensors',
        sizeMb: 6000,
      },
      {
        name: 'ernie-image-prompt-enhancer.safetensors',
        optional: true,
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/text_encoders/ernie-image-prompt-enhancer.safetensors',
        sizeMb: 1500,
      },
      {
        name: 'flux2-vae.safetensors',
        path: 'vae',
        url: 'https://huggingface.co/Comfy-Org/ERNIE-Image/resolve/main/vae/flux2-vae.safetensors',
        sizeMb: 335,
      },
    ],
  },
  {
    id: 'krea2-turbo',
    name: 'Krea2 Turbo',
    description: 'Fast 8-step Krea2 — the everyday model',
    files: [
      {
        name: 'krea2_turbo_fp8_scaled.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors',
        sizeMb: 12533,
      },
      ...KREA2_SHARED_FILES,
    ],
  },
  {
    id: 'krea2-raw',
    name: 'Krea2 RAW',
    description: 'Full 52-step Krea2 base — slower, highest fidelity',
    files: [
      {
        name: 'krea2_raw_fp8_scaled.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_raw_fp8_scaled.safetensors',
        sizeMb: 12533,
      },
      ...KREA2_SHARED_FILES,
    ],
  },
  {
    id: 'qwen21-turbo',
    name: 'Qwen-Image 2.1 Turbo',
    description: `Fast few-step Qwen-Image 2.1 — the everyday model, and what the Edit preset runs. ${QWEN21_EXPERIMENTAL} Qwen Research License — research or evaluation use only.`,
    files: [
      {
        name: QWEN21_TURBO_UNET,
        path: 'diffusion_models',
        url: `https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/main/${QWEN21_TURBO_UNET}`,
        sizeMb: 6921,
      },
      ...QWEN21_SHARED_FILES,
    ],
  },
  {
    id: 'qwen21',
    name: 'Qwen-Image 2.1',
    description: `Full 40-step Qwen-Image 2.1 — slower, highest fidelity. ${QWEN21_EXPERIMENTAL} Qwen Research License — research or evaluation use only.`,
    files: [QWEN21_BASE_FILE, ...QWEN21_SHARED_FILES],
  },
  {
    id: 'z-image-turbo',
    name: 'Z Image Turbo',
    description: 'Fast turbo with optional 1.5× upscale',
    files: [
      {
        name: 'z_image_turbo_bf16.safetensors',
        path: 'diffusion_models',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors',
        sizeMb: 12000,
      },
      {
        name: 'qwen_3_4b.safetensors',
        path: 'text_encoders',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors',
        sizeMb: 8070,
      },
      {
        name: 'ae.safetensors',
        path: 'vae',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
        sizeMb: 335,
      },
    ],
  },
  {
    id: 'sdxl',
    name: 'SDXL',
    description: 'Stable Diffusion XL base 1.0',
    files: [
      {
        name: 'sd_xl_base_1.0.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
  {
    id: 'pony',
    name: 'Pony',
    description: 'Pony Diffusion V6 XL (score_* tags)',
    files: [
      {
        name: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/LyliaEngine/Pony_Diffusion_V6_XL/resolve/main/ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
  {
    id: 'illustrious',
    name: 'Illustrious',
    description: 'Illustrious XL v0.1 (Danbooru anime base)',
    files: [
      {
        name: 'Illustrious-XL-v0.1.safetensors',
        path: 'checkpoints',
        url: 'https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0/resolve/main/Illustrious-XL-v0.1.safetensors',
        sizeMb: 6940,
      },
      SDXL_VAE_FILE,
    ],
  },
]
