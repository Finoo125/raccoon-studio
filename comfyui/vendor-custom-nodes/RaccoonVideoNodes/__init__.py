"""RaccoonVideoNodes — Raccoon Studio's LTX 2.3 video prompt + LoRA nodes."""

from .node import NODE_CLASS_MAPPINGS as _PROMPT_NODES, NODE_DISPLAY_NAME_MAPPINGS as _PROMPT_NAMES
from .lora_forge import NODE_CLASS_MAPPINGS as _LORA_NODES, NODE_DISPLAY_NAME_MAPPINGS as _LORA_NAMES
from .tiled_vae_decode import NODE_CLASS_MAPPINGS as _DECODE_NODES, NODE_DISPLAY_NAME_MAPPINGS as _DECODE_NAMES
# Vendored from 10S_Nodes so the video workflow no longer needs that pack — and,
# with the CoreModelPatcher unwrap in latent_upsampler_tiled, so ComfyUI core is
# no longer pinned to keep one node importable. See LICENSE-10S_Nodes.
from .latent_upsampler_tiled import NODE_CLASS_MAPPINGS as _UPSAMPLER_NODES, NODE_DISPLAY_NAME_MAPPINGS as _UPSAMPLER_NAMES
from .ltx_reference_conditioning import NODE_CLASS_MAPPINGS as _REFCOND_NODES, NODE_DISPLAY_NAME_MAPPINGS as _REFCOND_NAMES
from .ltx_reference_enable import NODE_CLASS_MAPPINGS as _REFEN_NODES, NODE_DISPLAY_NAME_MAPPINGS as _REFEN_NAMES

NODE_CLASS_MAPPINGS = {
    **_PROMPT_NODES,
    **_LORA_NODES,
    **_DECODE_NODES,
    **_UPSAMPLER_NODES,
    **_REFCOND_NODES,
    **_REFEN_NODES,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **_PROMPT_NAMES,
    **_LORA_NAMES,
    **_DECODE_NAMES,
    **_UPSAMPLER_NAMES,
    **_REFCOND_NAMES,
    **_REFEN_NAMES,
}

# ASCII only, deliberately. This runs at import, and ComfyUI is launched with
# stdout redirected to a logfile -- on Windows that stream can be cp1252, where a
# single em-dash or a display name's decorative glyph raises UnicodeEncodeError.
# That exception propagates out of __init__, so ComfyUI registers NONE of this
# pack's nodes and video fails with `missing_node_type` and no obvious cause.
# The registered ids are ASCII by construction; the display names are not.
print("[RaccoonVideo] loaded: " + ", ".join(sorted(NODE_CLASS_MAPPINGS)))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
