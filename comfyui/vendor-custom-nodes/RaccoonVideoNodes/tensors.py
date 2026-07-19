"""Image tensor helpers for ComfyUI wiring."""

import base64
import os
from io import BytesIO

import numpy as np
import torch
from PIL import Image

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
VIDEO_EXTS = {
    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".flv",
    ".mpeg", ".mpg", ".3gp", ".ogv",
}


def is_image_filename(name: str) -> bool:
    ext = os.path.splitext(name or "")[1].lower()
    return ext in IMAGE_EXTS and ext not in VIDEO_EXTS


def image_dimensions(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        with Image.open(path) as pil:
            return int(pil.width), int(pil.height)
    except Exception:
        return None


def open_rgb(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        with Image.open(path) as pil:
            return pil.convert("RGB")
    except Exception:
        return None


def resize_pil(pil, max_side):
    max_side = max(32, int(max_side))
    w, h = pil.size
    if max(w, h) <= max_side:
        return pil
    if w >= h:
        nw, nh = max_side, max(1, int(h * max_side / w))
    else:
        nh, nw = max_side, max(1, int(w * max_side / h))
    return pil.resize((nw, nh), Image.Resampling.LANCZOS)


def pil_jpeg_bytes(pil, quality=82):
    buf = BytesIO()
    pil.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def pil_preview_b64(pil, max_side=1024, quality=82):
    thumb = resize_pil(pil, max_side)
    raw = pil_jpeg_bytes(thumb, quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")


def make_black(w, h):
    return torch.zeros(1, max(64, int(h)), max(64, int(w)), 3, dtype=torch.float32)


def b64_to_tensor(b64_str):
    if b64_str.startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    raw = base64.b64decode(b64_str)
    pil = Image.open(BytesIO(raw)).convert("RGB")
    arr = np.array(pil).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def load_path(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        pil = Image.open(path).convert("RGB")
        arr = np.array(pil).astype(np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)
    except Exception:
        return None


def resize(t, w, h):
    w, h = max(64, int(w)), max(64, int(h))
    if t is None:
        return make_black(w, h)
    try:
        from torch.nn.functional import interpolate
        t2 = t.permute(0, 3, 1, 2)
        t2 = interpolate(t2, size=(h, w), mode="bilinear", align_corners=False)
        return t2.permute(0, 2, 3, 1).clamp(0, 1)
    except Exception:
        return make_black(w, h)