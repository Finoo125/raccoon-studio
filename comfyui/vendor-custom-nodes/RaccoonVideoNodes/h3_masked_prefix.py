"""Continue an H3 clip by freezing its tail inside the new clip's latent.

Core `MiniMaxH3AddGuide` pins the previous tail as a *keyframe* -- conditioning
the model re-generates from -- and H3 reads its audio as "a separate clip that
sounds like this" (measured 2026-08-29: seam audio correlation 0.31-0.46). This
node instead copies the tail's video AND audio latents into the head of the new
latent and gives both a denoise mask of 0 there, so the sampler keeps them as
they are and generates only what follows. Core v0.38 carries per-stream masks
for H3 (`audio_denoise_mask`, comfy/ldm/minimax/model.py), but no stock node
builds one.

Mechanism after ComfyUI-H3-Continuum's `masked_continuation.py`
(ukr8b3g-cmyk, MIT); written fresh against core's own helpers. This is how the
app's Continue works since 2026-10-02 (`H3_CONTEXT_FRAMES` in minimax-h3.ts):
measured on Eros over 13 joins it halved the visible step at the join and
took audio continuity from 0.34-0.65 to 0.95-0.98.

`context_frames` must sit on BOTH grids: 17k+5 video frames, and a whole number
of 40 Hz audio ticks at 24 fps (frames * 5/3 integral). 39 is the smallest that
does -- 22, the AddGuide pin, is 36.67 ticks.
"""

import torch

import comfy.nested_tensor
from comfy_extras.nodes_minimax_h3 import FPS, AUDIO_LATENT_FPS, _encode_ref_audio, _resize, video_latent_t


def legal_context_frames(n):
    return n >= 5 and n % 17 == 5 and (n * AUDIO_LATENT_FPS) % FPS == 0


class RaccoonH3MaskedPrefix:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "latent": ("LATENT",),
            "vae": ("VAE",),
            "audio_vae": ("VAE",),
            "video": ("IMAGE", {"tooltip": "The previous clip's frames (all of them; the tail is taken here)."}),
            "audio": ("AUDIO", {"tooltip": "The previous clip's soundtrack."}),
            "context_frames": ("INT", {"default": 39, "min": 39, "max": 362, "step": 51}),
        }}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "build"
    CATEGORY = "Raccoon/video"

    def build(self, latent, vae, audio_vae, video, audio, context_frames):
        n = int(context_frames)
        if not legal_context_frames(n):
            raise ValueError("context_frames %d is not on both the 17k+5 frame grid and the 40 Hz audio grid "
                             "(39, 90, 141, ...)" % n)
        samples = latent["samples"]
        if not getattr(samples, "is_nested", False) or len(samples.tensors) != 2:
            raise ValueError("RaccoonH3MaskedPrefix expects a MiniMax H3 AV latent")
        if video.shape[0] < n:
            raise ValueError("the previous clip has %d frames; %d are needed" % (video.shape[0], n))
        target_v, target_a = samples.tensors
        slots, ticks = video_latent_t(n), n * AUDIO_LATENT_FPS // FPS
        if target_v.shape[2] <= slots or target_a.shape[-1] <= ticks:
            raise ValueError("the new clip is too short to hold a %d-frame prefix" % n)

        frames = _resize(video[-n:], target_v.shape[4] * 16, target_v.shape[3] * 16, "center")
        tail_v = vae.encode(frames)[:, :, :slots]

        # The audio that plays under those frames, by time rather than "the last
        # N seconds": H3's soundtrack overhangs the picture by part of a tick.
        sr = audio["sample_rate"]
        start = round((video.shape[0] - n) / FPS * sr)
        wave = audio["waveform"][..., start:start + round(n / FPS * sr)]
        tail_a, got = _encode_ref_audio(audio_vae, {"waveform": wave, "sample_rate": sr})
        ticks = min(ticks, got)

        v, a = target_v.clone(), target_a.clone()
        v[:, :, :slots] = tail_v.to(v.device, v.dtype)
        a[..., :ticks] = tail_a[..., :ticks].to(a.device, a.dtype)
        vmask = torch.ones((v.shape[0], 1) + tuple(v.shape[2:]), device=v.device)
        amask = torch.ones((a.shape[0], 1) + tuple(a.shape[2:]), device=a.device)
        vmask[:, :, :slots] = 0.0
        amask[..., :ticks] = 0.0

        out = dict(latent)
        out["samples"] = comfy.nested_tensor.NestedTensor((v, a))
        out["noise_mask"] = comfy.nested_tensor.NestedTensor((vmask, amask))
        return (out,)


NODE_CLASS_MAPPINGS = {"RaccoonH3MaskedPrefix": RaccoonH3MaskedPrefix}
NODE_DISPLAY_NAME_MAPPINGS = {"RaccoonH3MaskedPrefix": "H3 Masked Prefix (continue a clip)"}
