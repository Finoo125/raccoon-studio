/**
 * Source-of-truth catalog of the model files the bundled LTX 2.3 video workflow
 * (`app/workflows/LTX23.json`) references. The Models page surfaces these with
 * installed/missing status, downloading the ones with a verified public `url`
 * and pointing the rest at a manual import.
 *
 * Filenames are exactly what the workflow's loader nodes expect; the download
 * route saves under that name regardless of the source URL's own filename.
 *
 * Not listed: the RIFE weights (`flownet.pkl`) — the interpolation node pack
 * fetches them automatically on first use.
 */
/**
 * One model file a bundled workflow references. Shared with the other video
 * catalogs (see `minimax-h3-assets.ts`) — the Models page renders any list of
 * these with the same row component.
 */
export interface ModelAsset {
  /** Exact filename ComfyUI's loader node expects. */
  name: string
  /** Target subfolder under models/. */
  folder:
    | 'checkpoints'
    | 'loras'
    | 'vae'
    | 'text_encoders'
    | 'diffusion_models'
    | 'latent_upscale_models'
  /** Approximate download size, MB (for display only). */
  sizeMb: number
  /** Verified public download URL (HF resolve). Omitted = import manually. */
  url?: string
  /** Where it comes from — a repo id, or a hint for manual acquisition. */
  source: string
}

export const LTX23_ASSETS: ModelAsset[] = [
  {
    // The workflow expects this exact filename; the public source file is
    // 10Eros_v1.4_fp8mixed_learned.safetensors — the download route saves
    // under `name`, so the rename happens automatically. This checkpoint also
    // provides the audio VAE and the text projection (three old files in one).
    name: 'ltx2310eros1.4.safetensors',
    folder: 'checkpoints',
    sizeMb: 29200,
    url: 'https://huggingface.co/TenStrip/LTX2.3-10Eros/resolve/main/10Eros_v1.4_fp8mixed_learned.safetensors',
    source: 'TenStrip/LTX2.3-10Eros (v1.4 fp8mixed)',
  },
  {
    name: 'gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors',
    folder: 'text_encoders',
    sizeMb: 12780,
    url: 'https://huggingface.co/TenStrip/LTX2.3-10Eros/resolve/main/text_encoders/gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors',
    source: 'TenStrip/LTX2.3-10Eros (projection baked in)',
  },
  {
    // Hard-wired as row 0 of the LoRA stack by the workflow builder — the
    // few-step sampling schedule requires it.
    name: 'LTX2.3_DMD_reshaped_r256.safetensors',
    folder: 'loras',
    sizeMb: 5100,
    url: 'https://huggingface.co/TenStrip/LTX2.3_DMD_Lora/resolve/main/LTX2.3_DMD_reshaped_r256.safetensors',
    source: 'TenStrip/LTX2.3_DMD_Lora (required distillation LoRA)',
  },
  {
    // Motion/camera reinforcement, on by default in the video form when present.
    // Optional: without it the form turns the toggle off rather than injecting a
    // LoRA that is not there. Source file is
    // Ltx2.3-Licon-VBVR-I2V-390K-R32.safetensors — the download route saves under
    // `name`, so the rename happens automatically.
    name: 'VBVR-I2V-390K-R32.safetensors',
    folder: 'loras',
    sizeMb: 554,
    url: 'https://huggingface.co/LiconStudio/Ltx2.3-VBVR-lora-I2V/resolve/main/Ltx2.3-Licon-VBVR-I2V-390K-R32.safetensors',
    source: 'LiconStudio/Ltx2.3-VBVR-lora-I2V (stage 3 — camera + motion stability)',
  },
  {
    // Optional — only pulled in when the Face identity toggle is on, and the
    // workflow builder omits the whole FaceID path when it is missing, so a
    // 2.4 GB download is never forced on someone who does not want it.
    name: 'Best_FaceID_v1.0_LoRA.safetensors',
    folder: 'loras',
    sizeMb: 2470,
    url: 'https://huggingface.co/Alissonerdx/LTX-Best-Face-ID/resolve/main/Best_FaceID_v1.0_LoRA.safetensors',
    source: 'Alissonerdx/LTX-Best-Face-ID (optional — identity lock for i2v)',
  },
  {
    name: '[LTX 2.3] Mystic XXX_v1.0.safetensors',
    folder: 'loras',
    sizeMb: 400,
    source: 'Optional style LoRA (Civitai) — import manually',
  },
  // ── IC-LoRAs: the video Director mode's motion lane ────────────────────────
  // These are what make a reference video on the motion lane mean anything —
  // `LTXDirectorGuide.ic_lora_name` selects one, and without it motion segments
  // are inert. All optional; the lane stays disabled until at least one is
  // installed. Lightricks publishes 18 of these; these three are the ones that
  // take a *reference clip*, which is what the lane feeds them.
  {
    name: 'ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors',
    folder: 'loras',
    sizeMb: 327,
    url: 'https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Motion-Track-Control/resolve/main/ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors',
    source: 'Lightricks (optional — transfers motion from a reference clip)',
  },
  {
    name: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
    folder: 'loras',
    sizeMb: 654,
    url: 'https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control/resolve/main/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors',
    source: 'Lightricks (optional — general-purpose reference-clip control)',
  },
  {
    // No `url` deliberately: this repo is gated on Hugging Face (a plain
    // resolve/ request 401s), so an automated download would fail with a
    // confusing error. Verified 2026-08-02; the other two IC-LoRAs are public.
    name: 'ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors',
    folder: 'loras',
    sizeMb: 1309,
    source:
      'Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients — gated on HF, accept the licence there and import manually',
  },
  {
    name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    folder: 'latent_upscale_models',
    sizeMb: 1000,
    url: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors',
    source: 'Lightricks/LTX-2.3',
  },
  {
    name: 'taeltx2_3.safetensors',
    folder: 'vae',
    sizeMb: 23,
    url: 'https://huggingface.co/DouraVITA/ltx-ugc-bundle/resolve/main/vae/taeltx2_3.safetensors',
    source: 'DouraVITA/ltx-ugc-bundle (LTX 2.3 TAE preview VAE)',
  },
]

/**
 * The IC-LoRAs the Director mode's motion lane can drive, shortest-label first.
 * Derived from the catalog so a filename can only be wrong in one place.
 */
export const IC_LORAS: { name: string; label: string }[] = [
  {
    name: 'ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors',
    label: 'Motion track',
  },
  { name: 'ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors', label: 'Union control' },
  { name: 'ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors', label: 'Ingredients' },
]

/**
 * True when ComfyUI lists `name` among the available model files. ComfyUI may
 * report a file under a subfolder (e.g. `sub/foo.safetensors`), so a trailing
 * basename match counts too.
 */
export function assetInstalled(name: string, available: Set<string>): boolean {
  if (available.has(name)) return true
  for (const a of available) {
    if (a.endsWith('/' + name)) return true
  }
  return false
}
