"""
RVN_PACK — bundled Raccoon Video Prompt output for a single ComfyUI socket.
Wire Prompt Lab → RVN Unpack to recover image / prompts / dimensions.
"""

RVN_PACK = "RVN_PACK"


def make_pack(image, positive, negative, width, height):
    return {
        "image": image,
        "positive": (positive or "").strip(),
        "negative": (negative or "").strip(),
        "width": int(width),
        "height": int(height),
    }


def unpack(pack):
    if not isinstance(pack, dict):
        raise ValueError("[RVN Unpack] Expected RVN_PACK bundle — connect Raccoon Video Prompt pack output.")
    for key in ("image", "positive", "negative", "width", "height"):
        if key not in pack:
            raise ValueError(f"[RVN Unpack] Bundle missing '{key}'.")
    return (
        pack["image"],
        pack["positive"],
        pack["negative"],
        int(pack["width"]),
        int(pack["height"]),
    )