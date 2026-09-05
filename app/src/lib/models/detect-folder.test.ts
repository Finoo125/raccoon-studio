import { describe, it, expect } from 'vitest'
import { detectFolderFromKeys } from './detect-folder'

describe('detectFolderFromKeys', () => {
  it('calls ComfyUI-format LoRA keys a LoRA', () => {
    expect(detectFolderFromKeys([
      'diffusion_model.blocks.0.mlp.fc1.lora_A.weight',
      'diffusion_model.blocks.0.mlp.fc1.lora_B.weight',
    ])).toBe('loras')
  })

  it('calls sd-scripts LoRA keys a LoRA', () => {
    expect(detectFolderFromKeys([
      'lora_unet_blocks_24_attn_qkv_proj.alpha',
      'lora_unet_blocks_24_attn_qkv_proj.lora_down.weight',
    ])).toBe('loras')
  })

  it('calls an SD-style full checkpoint a checkpoint', () => {
    // The VAE and text encoder living in the same file is what makes it "full".
    expect(detectFolderFromKeys([
      'model.diffusion_model.input_blocks.0.0.weight',
      'first_stage_model.encoder.conv_in.weight',
      'cond_stage_model.transformer.text_model.embeddings.position_ids',
    ])).toBe('checkpoints')
  })

  it('calls a bare DiT a diffusion model', () => {
    expect(detectFolderFromKeys([
      'blocks.0.attn.qkv_proj.weight',
      'blocks.0.mlp.fc1.weight',
    ])).toBe('diffusion_models')
  })

  it('does not treat a Snake activation alpha as a LoRA', () => {
    // Found by end-to-end sweep 2026-08-27. `.alpha` names a Snake activation
    // parameter as well as an sd-scripts LoRA scale; real vocoders carry
    // hundreds. Matching on it filed a VAE and a 29 GB checkpoint under loras/.
    expect(detectFolderFromKeys([
      'decoder.activation_post.act.alpha',
      'decoder.resblocks.0.activations.0.act.alpha',
      'decoder.conv_in.weight',
    ])).toBe('vae')
    expect(detectFolderFromKeys([
      'vocoder.bwe_generator.act_post.act.alpha',
      'first_stage_model.decoder.conv_in.weight',
    ])).toBe('checkpoints')
  })

  it('still finds an sd-scripts LoRA that carries .alpha alongside its weights', () => {
    expect(detectFolderFromKeys([
      'lora_unet_blocks_24_attn_qkv_proj.alpha',
      'lora_unet_blocks_24_attn_qkv_proj.lora_down.weight',
    ])).toBe('loras')
  })

  it('recognises a LoRA whose A/B tensors carry no .weight suffix', () => {
    // kroma-v0.1 spells them bare. Requiring `.weight` filed it as a diffusion
    // model, where the LoRA loader would never see it.
    expect(detectFolderFromKeys([
      'diffusion_model.blocks.0.attn.gate.lora_A',
      'diffusion_model.blocks.0.attn.gate.lora_B',
    ])).toBe('loras')
  })

  it('recognises a modern all-in-one checkpoint with no SD-era prefixes', () => {
    // ltx2310eros1.4 names its parts plainly instead of first_stage_model etc.
    expect(detectFolderFromKeys([
      'model.diffusion_model.blocks.0.attn.weight',
      'vocoder.bwe_generator.act_post.act.alpha',
      'vae.decoder.conv_in.weight',
      'audio_vae.decoder.conv_in.conv.bias',
      'text_embedding_projection.weight',
    ])).toBe('checkpoints')
  })

  it('calls a standalone VAE a VAE', () => {
    // Found by end-to-end sweep 2026-08-27: this used to fall through to
    // diffusion_models, so auto-detect filed a VAE where VAELoader cannot see
    // it. Keys from the real ae.safetensors.
    expect(detectFolderFromKeys([
      'decoder.conv_in.weight',
      'encoder.conv_out.bias',
      'decoder.mid.attn_1.k.weight',
    ])).toBe('vae')
  })

  it('calls a standalone LLM text encoder a text encoder', () => {
    expect(detectFolderFromKeys([
      'model.embed_tokens.weight',
      'model.layers.0.input_layernorm.weight',
    ])).toBe('text_encoders')
  })

  it('does not mistake a full checkpoint for a VAE', () => {
    // A checkpoint carries the same decoder tensors, nested one level down.
    expect(detectFolderFromKeys([
      'first_stage_model.decoder.conv_in.weight',
      'cond_stage_model.transformer.text_model.embeddings.position_ids',
      'model.diffusion_model.input_blocks.0.0.weight',
    ])).toBe('checkpoints')
  })

  it('calls LyCORIS adapters (LoKr/LoHa/OFT) LoRAs', () => {
    // famegrid_spicy, an ai-toolkit LoKr for Krea2, carries no `lora_*` key at
    // all and was filed under diffusion_models/, where the LoRA picker can
    // never see it. Suffixes taken from ComfyUI's own comfy/weight_adapter/.
    expect(detectFolderFromKeys([
      'diffusion_model.blocks.0.attn.wq.alpha',
      'diffusion_model.blocks.0.attn.wq.lokr_w1',
      'diffusion_model.blocks.0.attn.wq.lokr_w2',
    ])).toBe('loras')
    expect(detectFolderFromKeys([
      'lora_unet_blocks_0_attn.hada_w1_a',
      'lora_unet_blocks_0_attn.hada_w2_b',
    ])).toBe('loras')
    expect(detectFolderFromKeys([
      'diffusion_model.blocks.0.attn.wq.oft_blocks',
    ])).toBe('loras')
  })

  it('lets the LoRA rule outrank the checkpoint rule', () => {
    // A LoRA that also patches the text encoder carries cond_stage_model keys.
    // It is still a LoRA, and putting it in checkpoints/ makes it unloadable.
    expect(detectFolderFromKeys([
      'cond_stage_model.transformer.text_model.layers.0.self_attn.q_proj.lora_down.weight',
      'lora_te_text_model_encoder_layers_0_self_attn_q_proj.alpha',
    ])).toBe('loras')
  })
})
