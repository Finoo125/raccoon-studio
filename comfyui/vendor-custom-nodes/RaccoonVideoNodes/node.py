"""
Raccoon Video Prompt — slimline LTX 2.3 prompt node.
His UI (coverflow carousel + res-master), your brain (CANON + POV contract),
your 3-backend llama_manager. LTX video only — i2v / t2v.
"""

from .api import register_routes, _scan_gguf, _models_dir, resolve_input_image
from .environments_ld import ENV_KEYS
from .scenarios_ld import SCENARIO_KEYS as SCN_KEYS
from .camera_ld import KEYS as CAM_KEYS
from .music_ld import MUSIC_KEYS
from .negatives import build as build_negative
from .pack_ld import RVN_PACK, make_pack, unpack
from .tensors import b64_to_tensor, load_path, make_black, resize

try:
    register_routes()
except Exception as _e:
    print(f"[RaccoonVideo] route registration skipped: {_e}")


class RaccoonVideoPrompt:
    """Slimline LTX 2.3 shot-writer — strong core, minimal clutter."""

    @classmethod
    def INPUT_TYPES(cls):
        gguf, mmproj = _scan_gguf(_models_dir())
        d_gguf = gguf[1] if len(gguf) > 1 else "None"
        d_mm = mmproj[1] if len(mmproj) > 1 else "None (text-only)"
        return {
            "required": {
                "model_file": (gguf, {"default": d_gguf}),
                "mmproj_file": (mmproj, {"default": d_mm}),
                "video_mode": (["i2v", "t2v"], {"default": "i2v"}),
                "environment": (ENV_KEYS, {"default": ENV_KEYS[0]}),
                "scenario": (SCN_KEYS, {"default": SCN_KEYS[0]}),
                "camera_move": (CAM_KEYS, {"default": CAM_KEYS[0]}),
                "music": (MUSIC_KEYS, {"default": MUSIC_KEYS[0]}),
                "pov": ("BOOLEAN", {"default": False}),
                "pov_gender": (["female", "male"], {"default": "female"}),
                "dialogue_tier": (["none", "standard", "talkative"], {"default": "standard"}),
                "intensity": ("INT", {"default": 5, "min": 1, "max": 10}),
                "user_intent": ("STRING", {"multiline": True, "default": ""}),
                "confirmed_prompt": ("STRING", {"multiline": True, "default": ""}),
                "image_b64": ("STRING", {"default": ""}),
                "image_filename": ("STRING", {"default": ""}),
                "rm_w": ("INT", {"default": 1088, "min": 64, "max": 16384}),
                "rm_h": ("INT", {"default": 1920, "min": 64, "max": 16384}),
            },
            "optional": {
                "duration_s": ("FLOAT", {"default": 12.0, "min": 1.0, "max": 60.0, "step": 0.5, "forceInput": True}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 60, "forceInput": True}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = (RVN_PACK,)
    RETURN_NAMES = ("pack",)
    FUNCTION = "run"
    CATEGORY = "RaccoonStudio/Video"
    OUTPUT_NODE = True

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def run(self, model_file, mmproj_file, video_mode, environment, scenario, camera_move, music, pov,
            pov_gender, dialogue_tier, intensity, user_intent,
            confirmed_prompt, image_b64, image_filename, rm_w, rm_h,
            duration_s=None, fps=None, unique_id=None):
        out_w = max(64, int(rm_w or 1088))
        out_h = max(64, int(rm_h or 1920))

        # Only text committed in the UI (▶ Generate) reaches the positive pin.
        positive = (confirmed_prompt or "").strip()
        negative = build_negative(pov=bool(pov),
                                  music=bool(music) and not str(music).startswith("None"))

        if video_mode == "i2v":
            t = load_path(resolve_input_image(image_filename) or "")
            if t is None and (image_b64 or "").strip():
                t = b64_to_tensor(image_b64)
            if t is None:
                raise ValueError("[RaccoonVideo] I2V requires an uploaded image.")
            image_out = resize(t, out_w, out_h)
        else:
            image_out = make_black(out_w, out_h)

        print(f"[RaccoonVideo] {video_mode.upper()} → {out_w}×{out_h} | pov={pov} | music={bool(music)} | {len(positive)} chars")
        return (make_pack(image_out, positive, negative, out_w, out_h),)


class RaccoonVideoPromptUnpack:
    """Split the RVN pack into image / positive / negative / width / height."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pack": (RVN_PACK,)}}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "positive", "negative", "width", "height")
    FUNCTION = "run"
    CATEGORY = "RaccoonStudio/Video"

    def run(self, pack):
        return unpack(pack)


NODE_CLASS_MAPPINGS = {
    "RaccoonVideoPrompt": RaccoonVideoPrompt,
    "RaccoonVideoPromptUnpack": RaccoonVideoPromptUnpack,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "RaccoonVideoPrompt": "✦ Raccoon Video Prompt",
    "RaccoonVideoPromptUnpack": "✦ Raccoon Video Prompt Unpack",
}
