"""Minimal LTX stability negative."""

BASE = [
    "morphing", "distortion", "warping", "flicker", "jitter",
    "bad quality", "blurry", "watermark", "text", "logo",
    "extra limbs", "deformed hands", "wrong hand count",
    "twisted neck", "head facing backward", "head only turn", "neck twist", "head swivel without body", "static", "still image",
    "subtitles",
]


def build(pov=False, music=False):
    terms = list(BASE)
    if not music:
        # only suppress music when no soundtrack preset is active —
        # otherwise the negative fights the positive prompt
        terms.append("background music")
    if pov:
        terms.extend(["third person view", "visible camera", "filmed from behind"])
    return ", ".join(terms)