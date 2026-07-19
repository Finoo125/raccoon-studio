"""
LoraForge LD — LTX 2.3 LoRA controller with audio/visual split.
10-slot LTX 2.3 LoRA controller with audio/visual split.
"""

import os
import json
import folder_paths
import comfy.utils
import comfy.lora

try:
    from comfy.lora import load_lora_for_models as _load_lora
except (ImportError, AttributeError):
    from comfy.sd import load_lora_for_models as _load_lora

NUM_SLOTS = 10

def _is_audio_key(k):
    return "audio" in k.lower()

def _apply_slot(model, clip, lora_name, lora_str, vs, as_):
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path or not os.path.isfile(lora_path):
        print(f"[RaccoonLoraStack] LoRA not found: {lora_name}")
        return model, clip

    weights = comfy.utils.load_torch_file(lora_path, safe_load=True)

    video_weights = {k: v for k, v in weights.items() if not _is_audio_key(k)}
    audio_weights = {k: v for k, v in weights.items() if _is_audio_key(k)}

    v_final = lora_str * vs
    a_final = lora_str * as_

    print(f"[RaccoonLoraStack] '{lora_name}' V:{len(video_weights)}@{v_final:.2f}  A:{len(audio_weights)}@{a_final:.2f}")

    if video_weights and v_final != 0.0:
        model, clip = _load_lora(model, clip, video_weights, v_final, v_final)
    if audio_weights and a_final != 0.0:
        model, clip = _load_lora(model, clip, audio_weights, a_final, a_final)

    return model, clip


class RaccoonLoraStack:
    """✦ Raccoon LoRA Stack — 10-slot LTX 2.3 LoRA controller (video/audio split)."""

    @classmethod
    def INPUT_TYPES(s):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "stack_data": ("STRING", {"default": "[]", "multiline": False}),
            },
            "hidden": {"available_loras": (lora_list,)}
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "apply_stack"
    CATEGORY = "RaccoonStudio/Video"

    def apply_stack(self, model, clip, stack_data, available_loras=None):
        m, c = model, clip
        try:
            data = json.loads(stack_data)
        except Exception as e:
            print(f"[RaccoonLoraStack] bad stack_data JSON — no LoRAs applied: {e}")
            return (m, c)
        for row in data:
            if not row.get("on") or row.get("lora") in ("None", "", None):
                continue
            lora_str = float(row.get("str", 1.0))
            vs = float(row.get("vs", 1.0))
            as_ = float(row.get("as", 1.0))
            m, c = _apply_slot(m, c, row["lora"], lora_str, vs, as_)
        return (m, c)


NODE_CLASS_MAPPINGS = {"RaccoonLoraStack": RaccoonLoraStack}
NODE_DISPLAY_NAME_MAPPINGS = {"RaccoonLoraStack": "✦ Raccoon LoRA Stack"}