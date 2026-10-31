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
     * is documented as usable at 8 *or* 4. That also used to rest on 768p being
     * above every tier's pixel budget, which stopped being true when `high` rose
     * to the model's 1.03 MP canvas — a 1.75 aspect now renders exactly 1344x768.
     * Re-measure the pair before assuming the 8-step still wins.
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
     * Plaguekind's V11 recipe as a third checkpoint (`H3_HYBRID`): smhfacct's
     * fl2va+ref2va merge, b25-49 (the card's "balanced default"). int8
     * convrot, 932 tensors — read off the header 2026-10-02. Inherits the
     * MiniMax H3 community licence of the two checkpoints it merges.
     */
    name: 'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors',
    folder: 'diffusion_models',
    sizeMb: 20970,
    url: 'https://huggingface.co/smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models/resolve/main/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors',
    source: 'smhfacct (Plaguekind V11 recipe) — optional, enables the Hybrid checkpoint',
    optional: true,
  },
  {
    /**
     * Aki7777777's SparseRef15 Hybrid (`H3_SPARSEREF`). No `url`: Civitai
     * answers 401 without a login (2026-10-16), and the download route sends no token.
     */
    name: 'minimaxH3Sparseref15_prunedPartialINT8V10.safetensors',
    folder: 'diffusion_models',
    sizeMb: 20968,
    source: 'Aki7777777 on Civitai (H3_SparseRef15_Hybrid, Pruned Partial-INT8 v1.0, version 3301688) — optional, enables the SparseRef15 checkpoint; download it there (Civitai login) into models/diffusion_models',
    optional: true,
  },
  {
    name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    folder: 'loras',
    sizeMb: 1956,
    url: 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    source: 'lightx2v/Minimax-h3-Turbo — the full fl2v 8-step LoRA SparseRef15 runs with (optional)',
    optional: true,
  },
  {
    /**
     * Edit mode, "Change something": Alissonerdx's VFX edit LoRA (Apache-2.0).
     * Measured 2026-10-02 on Eros — blazer to red leather, fire on fists, pool
     * to night — each with face, pose and background kept. The FFP sibling is
     * offered separately for edited first frames.
     */
    name: 'minimax_h3_vfx_edit_v1.0_r128.safetensors',
    folder: 'loras',
    sizeMb: 1240,
    url: 'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/loras/minimax_h3_vfx_edit_v1.0_r128.safetensors',
    source: 'Alissonerdx (Apache-2.0) — optional, enables Edit video: Change something',
    optional: true,
  },
  {
    /** Edit mode, "Restyle": Alissonerdx's style-transfer LoRA (Apache-2.0). */
    name: 'minimax_h3_style_transfer_v1.0_r64.safetensors',
    folder: 'loras',
    sizeMb: 620,
    url: 'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/loras/minimax_h3_style_transfer_v1.0_r64.safetensors',
    source: 'Alissonerdx (Apache-2.0) — optional, enables Edit video: Restyle',
    optional: true,
  },
  {
    /**
     * Edit mode, "Swap head": Alissonerdx's head swap LoRA (Apache-2.0). Replaces
     * the whole head — face and hair — from one picture and keeps body, outfit
     * and motion (measured 2026-10-03: ArcFace 0.69 / 0.47 on two clips).
     */
    name: 'minimax_h3_head_swap_v1.0_r32.safetensors',
    folder: 'loras',
    sizeMb: 310,
    url: 'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/loras/minimax_h3_head_swap_v1.0_r32.safetensors',
    source: 'Alissonerdx (Apache-2.0) — optional, enables Edit video: Swap head. Only swap people who agreed to it.',
    optional: true,
  },
  {
    /**
     * Edit mode, "Start from an edited first frame": the FFP version of the vfx
     * edit LoRA (Alissonerdx, Apache-2.0) — carries a first frame the user edited
     * elsewhere through the whole clip.
     */
    name: 'minimax_h3_vfx_edit_v1.0_r128_ffp.safetensors',
    folder: 'loras',
    sizeMb: 1240,
    url: 'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/loras/minimax_h3_vfx_edit_v1.0_r128_ffp.safetensors',
    source: 'Alissonerdx (Apache-2.0) — optional, enables Edit video: start from an edited first frame',
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
  {
    /**
     * TenStrip's **10Eros Max**, beta6 — an uncensored H3 finetune that keeps
     * base-model behaviour, built by grafting character data out of Wan 2.2,
     * Krea 2 and LTX 2.3 onto H3's attention layers at a level the author says
     * leaves its visual and audio quality alone (his `h3_graft_methodology.md`
     * on the repo is the write-up).
     *
     * Two things make this a checkpoint *pick* rather than one more LoRA:
     *
     * - It is a **TURBO-hybrid** — the author's own sum-ranked turbo merge is
     *   already in the weights, so the Draft/Fast LoRAs must NOT be stacked on
     *   top. `H3_EROS` is the profile that replaces them, and the video form's
     *   Speed row retires while this is selected.
     * - **beta6 replaced beta5 on 2026-10-14** (owner's pick from a 3-way
     *   test against beta5 and the Hybrid: brighter, sharper, same speed —
     *   see `H3_EROS`). Its card samples at shift 10/3, which `H3_EROS.shift`
     *   carries. The header has no file-level `_quantization_metadata` any
     *   more: 195 int8 layers carry per-layer `comfy_quant` blobs (metadata
     *   `modelutils_adaln_fold`), and the two `adaln_basis`/`adaln_mean`
     *   tensors ComfyUI used to drop as unexpected are gone. Loads as is.
     * - **beta5 replaced beta4 on 2026-09-13.** The card now calls beta3 AND
     *   beta4 "corrupted test versions" and beta5 "the only true functional one
     *   so far" — a different normalisation, seven concept-grouped grafts and
     *   consensus merges of 20+ LoRAs instead of direct LoRA merges. Measured
     *   against beta4 over five of the user's own clips at identical seeds
     *   (t2v / i2v / character LoRA / ref2v): detail up on 4 of 5, identity vs
     *   the source photo up ~0.04 in i2v and flat in ref2v, face consistency
     *   across the clip up on all 5, audio a wash, wall time identical, and the
     *   two ref2v picks followed their scripted action beats more literally.
     *   Renders brighter and punchier across the board (mean luma +6–9).
     *
     * Same quantisation reasoning as every other H3 checkpoint in this list:
     * int8 convrot, never an fp8_scaled sibling. **The filename only says
     * `_int8`** — the header (`__metadata__._quantization_metadata`, read
     * 2026-09-13) declares `int8_tensorwise` + `convrot: true`, groupsize 256,
     * the same 200 layers beta4 quantised; ComfyUI converts that file-level
     * form into the per-layer blobs beta4 carried, so it is a drop-in load.
     * Three siblings deliberately not offered: the 40 GB bf16 build (nothing
     * for 2x the download); the 14 GB `w4a8_14gb_optimized` build (a custom
     * converter's `asym_w4a8_int8` experiment — the format is in v0.34.2's
     * table, but its edge layers carry a `per_row` key nothing in ComfyUI
     * reads, and the author's own notes say "w4a8 causes GPU compatibility
     * issues"; a 16 GB lever to measure on real 16 GB hardware, not here); and
     * the non-turbo `hybrid_beta5` line, which the author says has better
     * audio at full steps but would need the Draft/Fast LoRAs and the Speed
     * row back. Reference mode: 211 of beta4's 220 unquantized tensors were
     * bit-identical to the stock ref2va build, and beta5 keeps beta4's exact
     * key set and shapes, so this one file serves reference mode as well (see
     * `H3_EROS`).
     *
     * Licence is MiniMax's H3 community agreement plus — the author is explicit
     * — the Wan 2.2, Krea 2 and LTX 2.3 community licences covering the
     * character each contributed. Linked, never mirrored, like everything here.
     */
    name: '10Eros_Max_h3_8stepTURBO_beta6_int8.safetensors',
    folder: 'diffusion_models',
    sizeMb: 21710,
    url: 'https://huggingface.co/TenStrip/10Eros-Max/resolve/main/10Eros_Max_h3_8stepTURBO_beta6_int8.safetensors',
    source: 'TenStrip/10Eros-Max — optional, uncensored finetune with Turbo built in',
    optional: true,
  },
  {
    /**
     * Tiny approximate decoder for H3's latent, so a render shows a live picture
     * while it samples instead of a bare progress bar.
     *
     * **Nothing in the graph references this file.** ComfyUI matches it by name
     * out of `models/vae_approx/` on its own — `latent_formats.py:627` declares
     * H3's `taesd_decoder_name = "taeh3"`, `latent_preview.py:14` lists it among
     * the video TAEs, and the launcher already passes `--preview-method auto`.
     * So this entry is the entire feature: no node, no custom pack, no builder
     * change. That is also why it cannot be gated behind an install check the
     * way the Turbo LoRAs are — there is no input to gate.
     *
     * Worth more here than on the image families: an H3 clip is minutes of
     * sampling, and without a previewer a slow render is indistinguishable from
     * a hung one — which is exactly how the `resolveOutputMedia` bug read before
     * it was found.
     *
     * 9.8 MB and Apache-2.0, the only permissively-licensed file in this list.
     */
    name: 'taeh3.safetensors',
    folder: 'vae_approx',
    sizeMb: 10,
    url: 'https://huggingface.co/Kijai/MiniMax-H3-TAE/resolve/main/vae_approx/taeh3.safetensors',
    source: 'Kijai/MiniMax-H3-TAE — optional, live preview while a clip renders',
    optional: true,
  },
  // ── Style LoRAs ───────────────────────────────────────────────────────────
  // Unlike everything above, these unlock no mode and the builder never names
  // them: they are picked by hand in the video form's four LoRA slots, which
  // enumerate whatever ComfyUI reports. So the only thing needed to "integrate"
  // one is a download entry — plus its key signature in `lora-arch.ts`, without
  // which the sd-scripts build below is filed as Anima and offered on Anima
  // image renders, where it can only fail validation.
  //
  // Sourced from HuggingFace rather than Civitai because every other URL in this
  // catalog is an HF resolve URL and the download route wants a plain public GET.
  // Both files were checked byte-for-byte against Civitai's own SHA256:
  //   V4  fc3e856d…afba   155,095,800 B
  //   V2  2fc32615…e8de   172,057,936 B
  // The uploader permits derivatives, relicensing and commercial use with no
  // credit, so mirroring is allowed here (unlike the Anima character sheet,
  // which is manual-import for exactly the opposite licence flags).
  // ⚠️ These are third-party re-uploads — the author keeps no HF repo — so the
  // URLs can disappear where a first-party one would not. Known duplicates of
  // the same bytes: B4100/mystic-h3 (V4), kirk86413/mysticv2-h3 (V2).
  {
    /**
     * Mystic XXX v4 — the author's own pick ("best overall balance of motion
     * quality, temporal stability, and fine detail"), and the newest release.
     *
     * Rank 16, fp32, sd-scripts keys (`lora_unet_blocks_<n>_*`), and it patches
     * only blocks 24–49 — the back half of the DiT — which is why 104 modules
     * fit in 148 MB. Loads on core `LoraLoaderModelOnly`: ComfyUI maps that
     * spelling onto `diffusion_model.*` itself (`comfy/lora.py:195`), so the H3
     * graph keeps its no-custom-packs property.
     *
     * No trigger word. Author's starting point is strength 1.0, with 0.2–1.0
     * usable; expect to drop it when stacked on a Turbo LoRA, which was
     * distilled on a schedule this was not tuned against.
     */
    name: 'MysticXXX_MMH3-V4.safetensors',
    folder: 'loras',
    sizeMb: 148,
    url: 'https://huggingface.co/lynaNSFW/mysticxxx_MM_H3/resolve/main/MysticXXX_MMH3-V4.safetensors',
    source: 'alcaitiff (Civitai) — optional style LoRA, anatomy realism',
    optional: true,
  },
  {
    /**
     * Mystic XXX v2 — kept alongside v4 rather than superseded by it, because
     * the two are structurally different adapters, not two builds of one thing:
     * v2 carries ComfyUI keys (`diffusion_model.blocks.*`), touches all 50
     * blocks, and patches **only the MLPs** — no attention at all. That is a
     * much lighter-handed edit than v4's attention-inclusive back-half patch,
     * so it composes differently with Turbo and with the realism adapter.
     *
     * Its `__metadata__` is a joke blob (`ss_base_model_version` reads
     * "Schwifty-9K-Morty-Proof (Chuck Norris Edition)"), which is a live example
     * of why `lora-arch.ts` reads tensor keys first and metadata second.
     */
    name: 'MysticXXX_MMH3-V2.safetensors',
    folder: 'loras',
    sizeMb: 164,
    url: 'https://huggingface.co/lynaNSFW/mysticxxx_MM_H3/resolve/main/MysticXXX_MMH3-V2.safetensors',
    source: 'alcaitiff (Civitai) — optional style LoRA, MLP-only variant',
    optional: true,
  },
]
