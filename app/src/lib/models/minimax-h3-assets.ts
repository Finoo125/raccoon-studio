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
 * Total: ~42.5 GB of required weights, which is the same figure the Comfy blog
 * quotes for the smallest full H3 set (down from 123.6 GB at full precision) —
 * or ~63.5 GB with the optional reference-to-video checkpoint, plus ~4.5 GB
 * more if all three optional Turbo LoRAs are taken.
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
    // H3 generates video and stereo audio jointly; without this the graph has
    // no audio branch to decode and the clip comes out silent.
    name: 'minimax_h3_audio_vae_fp32.safetensors',
    folder: 'vae',
    sizeMb: 610,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors',
    source: 'Comfy-Org/MiniMax-H3 (required for the synced audio track)',
  },
  // ── Everything below is `optional: true` — one extra mode each, never a
  //    prerequisite for rendering. Kept last so the Models page reads
  //    required-then-optional top to bottom.
  {
    /**
     * 4-step Turbo LoRA, the Draft tier: Draft mode confirms it is installed
     * before offering itself.
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
    source: 'drbaph (conversion of larryvrh/MiniMax-H3-Turbo-Lora) — optional, enables Draft mode',
    optional: true,
  },
  {
    /**
     * lightx2v/ModelTC's 8-step v1.0 distillation — the *Fast* tier, a real
     * alternative to a 20-step render rather than the throwaway Draft above.
     *
     * Three reasons it can be loaded plainly where larryvrh's could not:
     * lightx2v's are dynamic-rank LoRAs that never went through the pruning
     * dance, so they load on the **pruned int8 checkpoint we already ship**;
     * the `_comfyui_` build is the upstream author's own conversion, not a
     * third party's; and ModelTC's own ComfyUI guide is explicit that no custom
     * node is involved. So the no-custom-packs property of this graph holds.
     *
     * Deliberately the 8-step and not the sibling `4step_v1.0_768p`: the 8-step
     * is documented as usable at 8 *or* 4, and 768p is above the pixel budget
     * every VRAM tier here actually renders at (`BUDGET_MP` tops out at 0.8 MP),
     * so the 768p build's one advantage would never be exercised.
     *
     * **drbaph's rank-21 resize, not lightx2v's original — 327 MB instead of
     * 1.96 GB for the same weights** (2026-08-16). Same author lineage; the
     * resize averages the original's rank 128/384 down per-layer.
     *
     * Measured before switching, since this is what every Fast-tier user
     * downloads: 3 seeds, same prompt/steps/strength, Laplacian sharpness
     * 8.41/p99 82.0 (original) vs 8.67/p99 82.7 (resize) — inside run-to-run
     * variance — identical wall time, and the frames hold fine detail (legible
     * watch numerals, individual chain links) on visual inspection.
     *
     * One caveat if this is ever re-tuned: the original carries explicit
     * `.alpha` keys and the resize does not, so its scaling is baked into the
     * weights. `strength 0.75` happened to transfer cleanly, but do not assume
     * a *different* strength maps the same way across the two files. Revert to
     * the 1.96 GB URL in the git history if the resize ever disappoints.
     */
    name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_resized_avg_rank_21_bf16.safetensors',
    folder: 'loras',
    sizeMb: 327,
    url: 'https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_resized_avg_rank_21_bf16.safetensors',
    source: 'drbaph (resize of lightx2v/ModelTC) — optional, enables Fast mode (8 steps)',
    optional: true,
  },
  {
    /**
     * The same distillation trained for **ref2va**, which is a different
     * checkpoint and therefore a different LoRA — the fl2v weights above are
     * simply the wrong shape for the reference model's conditioning.
     *
     * Optional on top of optional: it only does anything when both reference
     * mode and a Turbo tier are in play, and the builder falls back to the fl2v
     * LoRA when it is absent, so nothing breaks by skipping it.
     *
     * Still v0.1 and 4-step where fl2v has moved to v1.0/8-step; there is no
     * 8-step ref2v build to pair with Fast mode.
     */
    name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
    folder: 'loras',
    sizeMb: 1956,
    url: 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
    source: 'lightx2v/ModelTC — optional, Draft/Fast mode for reference-to-video',
    optional: true,
  },
  {
    /**
     * fal's realism-people adapter — the "Realistic skin" toggle in the video
     * form. The cheapest real fix for H3's waxy, airbrushed faces, which until
     * now film grain only masked rather than repaired.
     *
     * Measured 2026-08-16 at 20 steps over two seeds: pores, broken capillaries,
     * moles and individually rendered stubble against a visibly smooth baseline.
     * Shipped at strength 0.7 rather than the author's headline 1.0, because at
     * 1.0 it drags the framing to an extreme close-up — see `H3_REALISM_STRENGTH`.
     *
     * Standard H3 key layout (rank 32), so core `LoraLoaderModelOnly` takes it
     * and the graph keeps its no-custom-packs property. Licensed under the
     * MiniMax H3 community licence, like the base weights; we link the download
     * rather than redistribute it, same as every other entry here.
     */
    name: 'h3-realism-people-t2v-i2v-r2v.safetensors',
    folder: 'loras',
    sizeMb: 125,
    url: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA/resolve/main/h3-realism-people-t2v-i2v-r2v.safetensors',
    source: 'fal — optional, enables the Realistic skin toggle',
    optional: true,
  },
  {
    /**
     * ref2va — reference-to-video. **Separate weights, not a flag**: the fl2va
     * checkpoint above cannot take reference conditioning at all. The mode is
     * hidden behind an install check the way the Turbo tiers are. Same
     * quantisation reasoning as fl2va — pruned int8 convrot, never
     * `pruned_fp8_scaled`.
     */
    name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    folder: 'diffusion_models',
    sizeMb: 20970,
    url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    source: 'Comfy-Org/MiniMax-H3 — optional, enables reference-to-video',
    optional: true,
  },
]
