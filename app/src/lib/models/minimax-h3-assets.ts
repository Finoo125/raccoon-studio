import type { ModelAsset } from './ltx23-assets'

/**
 * Model files the bundled MiniMax H3 workflow (`app/workflows/MinimaxH3.json`)
 * references. Same shape and same Models-page treatment as `LTX23_ASSETS`.
 *
 * Every filename, folder and URL here was read off ComfyUI's own shipped
 * templates (`comfyui_workflow_templates_json/templates/video_minimax_h3_*.json`,
 * node `properties.models`) rather than transcribed from the docs, so the loader
 * nodes and the downloads cannot disagree.
 *
 * Total: ~42.5 GB, which is the same figure the Comfy blog quotes for the
 * smallest full H3 set (down from 123.6 GB at full precision) — or ~63.5 GB
 * with the optional reference-to-video checkpoint.
 */
export const MINIMAX_H3_ASSETS: ModelAsset[] = [
  {
    /**
     * The pruned int8 DiT — ComfyUI's own default in every official H3 template.
     *
     * Deliberately NOT `minimax_h3_fl2va_pruned_fp8_scaled.safetensors`, which
     * is the same model at 20.96 GB (ten megabytes apart in the file listing):
     * fp8_scaled is the format that renders saturated tiled garbage when
     * DynamicVRAM streams it, and DynamicVRAM is on by default here. int8
     * convrot is a different quantisation path and is what H3 shipped tuned for.
     *
     * Also not the *non-pruned* 34 GB build: that one is only needed by the
     * third-party Turbo LoRA, which does not fit a 32 GB card anyway.
     */
    name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    folder: 'diffusion_models',
    sizeMb: 20970,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    source: 'Comfy-Org/MiniMax-H3 (text- and image-to-video)',
  },
  {
    /**
     * Qwen3-VL-32B, nvfp4. **Not Blackwell-only**, despite the format's name —
     * here nvfp4 is a storage format, never a compute one, so a 3090 and a 5090
     * take byte-identical paths:
     *
     * - Text encoders never consult `supports_nvfp4_compute`. `sd1_clip.py:114`
     *   builds their ops with `full_precision_mm=True` unconditionally, which
     *   forces every quantized layer to dequantize to bf16 and run a normal
     *   matmul (`ops.py:1359-1364`). The nvfp4 tensor-core matmul is not on the
     *   table for *any* card in this role.
     * - The dequantize itself is pure torch — uint8 nibble unpack + an E2M1
     *   lookup table (`comfy_kitchen/backends/eager/quantization.py:174`), no
     *   SM-gated kernel. Measured on this stack: 33 GB/s, i.e. **~0.5 s to
     *   unpack the whole 15.7 GB encoder**, once per render rather than once
     *   per sampling step. Reconstruction error 0.09 relative, normal for 4-bit.
     *
     * So this file is picked purely on size, and the 24 GB cards are the reason
     * it stays: the int8 build is 27.1 GB, larger than a 3090/4090's entire
     * VRAM, and bf16 is 51.5 GB. Switching non-Blackwell users to int8 would
     * hurt exactly the users it was meant to help.
     */
    name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    folder: 'text_encoders',
    sizeMb: 15690,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    source: 'Comfy-Org/MiniMax-H3 (Qwen3-VL-32B, nvfp4)',
  },
  {
    name: 'minimax_h3_video_vae_fp16.safetensors',
    folder: 'vae',
    sizeMb: 5210,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors',
    source: 'Comfy-Org/MiniMax-H3',
  },
  {
    /**
     * 4-step Turbo LoRA — optional, and the only entry here a render can do
     * without: Turbo mode confirms it is installed before offering itself.
     *
     * **drbaph's conversion, not larryvrh's original**, though larryvrh trained
     * it. The original needs the `ComfyUI-MiniMax-H3-Turbo` node pack to load on
     * a pruned checkpoint; this build folds that compatibility into the weights
     * so core `LoraLoaderModelOnly` accepts them, which is what keeps the H3
     * graph free of custom packs.
     *
     * `ckpt500` non-EMA is the author's own starting recommendation. Both
     * authors flag this as a preview: sharp, but with plastic-looking skin and
     * over-sharp grain, and training is paused. Strength is the dial —
     * 1.05–1.2 against blur, 0.8–0.95 against grain.
     */
    name: 'minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors',
    folder: 'loras',
    sizeMb: 620,
    url: 'https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors',
    source: 'drbaph (conversion of larryvrh/MiniMax-H3-Turbo-Lora) — optional, enables Turbo mode',
  },
  {
    // H3 generates video and stereo audio jointly; without this the graph has
    // no audio branch to decode and the clip comes out silent.
    name: 'minimax_h3_audio_vae_fp32.safetensors',
    folder: 'vae',
    sizeMb: 610,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors',
    source: 'Comfy-Org/MiniMax-H3 (required for the synced audio track)',
  },
  {
    /**
     * ref2va — reference-to-video. **Separate weights, not a flag**: the fl2va
     * checkpoint above cannot take reference conditioning at all.
     *
     * Optional, and the second entry here a render can do without: the mode is
     * hidden behind an install check the way Turbo is. Same quantisation
     * reasoning as fl2va — pruned int8 convrot, never `pruned_fp8_scaled`.
     */
    name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    folder: 'diffusion_models',
    sizeMb: 20970,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    source: 'Comfy-Org/MiniMax-H3 — optional, enables reference-to-video',
  },
]
