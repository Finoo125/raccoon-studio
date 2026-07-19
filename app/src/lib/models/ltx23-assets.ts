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
export interface Ltx23Asset {
  /** Exact filename ComfyUI's loader node expects. */
  name: string
  /** Target subfolder under models/. */
  folder:
    | 'checkpoints'
    | 'loras'
    | 'vae'
    | 'text_encoders'
    | 'latent_upscale_models'
  /** Approximate download size, MB (for display only). */
  sizeMb: number
  /** Verified public download URL (HF resolve). Omitted = import manually. */
  url?: string
  /** Where it comes from — a repo id, or a hint for manual acquisition. */
  source: string
}

export const LTX23_ASSETS: Ltx23Asset[] = [
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
    name: '[LTX 2.3] Mystic XXX_v1.0.safetensors',
    folder: 'loras',
    sizeMb: 400,
    source: 'Optional style LoRA (Civitai) — import manually',
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
 * True when ComfyUI lists `name` among the available model files. ComfyUI may
 * report a file under a subfolder (e.g. `sub/foo.safetensors`), so a trailing
 * basename match counts too.
 */
export function ltxAssetInstalled(name: string, available: Set<string>): boolean {
  if (available.has(name)) return true
  for (const a of available) {
    if (a.endsWith('/' + name)) return true
  }
  return false
}
