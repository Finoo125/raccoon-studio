/**
 * Which ComfyUI folder a model file belongs in, read out of the file itself.
 *
 * The importer used to derive this from the filename (`patreonSubfolder`),
 * which only worked because filenames were gated to a naming scheme we
 * controlled. A file a user downloaded from anywhere carries no such hint, so
 * this reads the tensor index instead — the same header-first doctrine as
 * `lora-arch.ts`, and for the same reason: the keys cannot lie about what the
 * weights are.
 */
import { readSafetensorsHeader } from './lora-arch'

export type ModelFolder = 'loras' | 'checkpoints' | 'diffusion_models' | 'vae' | 'text_encoders'

/**
 * Suffixes that only ever appear on an adapter's tensors.
 *
 * `.alpha` is deliberately NOT here, though sd-scripts LoRAs do carry it: it is
 * also the name of a **Snake activation parameter**, and real files are full of
 * them — `minimax_h3_audio_vae_fp32` has 163 and `ltx2310eros1.4` has 200, with
 * zero LoRA keys between them. Matching on it filed a VAE and a 29 GB checkpoint
 * as LoRAs. Every LoRA carries a down/up or A/B pair anyway, so nothing is lost.
 *
 * LoRA is not the only adapter `LoraLoader` takes: LyCORIS LoKr/LoHa/OFT files
 * carry none of the `lora_*` names and were falling through to
 * diffusion_models/, where no picker can reach them (found on famegrid_spicy,
 * an ai-toolkit LoKr for Krea2 — 768 tensors, every one `lokr_w1|lokr_w2|alpha`).
 * These stems are LyCORIS inventions, so they cannot collide with base weights;
 * the full list is ComfyUI's own `comfy/weight_adapter/`.
 */
const LORA_KEY = /(^|\.)(lora_(a|b|down|up)(\.|$)|lokr_[wt]\d|hada_[wt]\d|oft_blocks$)/

/**
 * Components that only appear bundled INSIDE a full checkpoint. `first_stage_model`
 * and `cond_stage_model` are the SD-era spelling; modern all-in-one checkpoints
 * name their parts plainly instead — `ltx2310eros1.4` carries `model`, `vocoder`,
 * `vae`, `audio_vae` and `text_embedding_projection` roots in one 8411-tensor file.
 * A standalone VAE never uses a `vae.` prefix; its encoder/decoder sit at the top
 * level, which is what separates the two.
 */
const FULL_CHECKPOINT_COMPONENTS = [
  'first_stage_model.', 'cond_stage_model.',
  'vae.', 'audio_vae.', 'vocoder.', 'text_embedding_projection.',
]

/** A standalone LLM text encoder — the embedding table is the giveaway.
 *  Verified: gemma-3-12b-it-…-fp8mixed, qwen3vl_32b_minimax_h3_nvfp4_awq. */
const TEXT_ENCODER_PREFIXES = ['model.embed_tokens.', 'text_model.embeddings.']

/** A standalone VAE is an encoder/decoder pair at the TOP level. Inside a full
 *  checkpoint the same tensors are nested under `first_stage_model.`, which the
 *  checkpoint rule above already claims, so these prefixes cannot collide.
 *  Verified: ae.safetensors, minimax_h3_audio_vae_fp32.safetensors. */
const VAE_PREFIXES = ['decoder.', 'encoder.', 'dec_in_proj', 'enc_in_proj']

/**
 * Classify from tensor names alone.
 *
 * Order matters: the LoRA test runs first because a LoRA that patches the text
 * encoder carries `cond_stage_model.*` keys too, and calling that a checkpoint
 * files a 200 MB adapter next to 6 GB base models where nothing can load it.
 */
export function detectFolderFromKeys(names: string[]): ModelFolder {
  const lower = names.map((n) => n.toLowerCase())

  if (lower.some((k) => k.startsWith('lora_') || LORA_KEY.test(k))) {
    return 'loras'
  }
  if (lower.some((k) => FULL_CHECKPOINT_COMPONENTS.some((p) => k.startsWith(p)))) {
    return 'checkpoints'
  }
  if (lower.some((k) => TEXT_ENCODER_PREFIXES.some((p) => k.startsWith(p)))) {
    return 'text_encoders'
  }
  if (lower.some((k) => VAE_PREFIXES.some((p) => k.startsWith(p)))) {
    return 'vae'
  }
  return 'diffusion_models'
}

/** Read a file and classify it. Null = not readable safetensors; the caller
 *  should fall back to asking the user rather than guessing. */
export function detectModelFolder(file: string): ModelFolder | null {
  const header = readSafetensorsHeader(file)
  if (!header) return null
  return detectFolderFromKeys(Object.keys(header).filter((k) => k !== '__metadata__'))
}
