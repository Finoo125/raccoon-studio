"""LTX 2.3 negative prompt.

One rule: **every term names something a frame could actually contain.**
"wrong hand count", "head only turn" and "third person view" describe a
narrative failure, not pixels — a sampler has no embedding for them, so they
cost conditioning weight and buy nothing. Each is replaced here by the artifact
it actually looks like (extra fingers, frozen frame, camera in frame).

Terms are deduped on the way out: a repeated term weights the repeated concept
in a negative exactly as it does in a positive.
"""

# Always on. Grouped so the reason for each is visible.
_QUALITY = "blurry, out of focus, low quality, compression artifacts"
_ANATOMY = ("deformed hands, extra fingers, fused fingers, extra limbs, "
            "warped face, melted features, twisted neck, head facing backward")
_OVERLAY = "watermark, logo, on-screen text, subtitles, captions, timecode overlay"
# What "static" and "still image" actually look like, plus the deform artifacts
# CANON rule 2/3 police in the positive.
_TEMPORAL = ("frozen frame, flicker, strobing, jitter, ghosting, duplicated limbs, "
             "morphing, warping, motion smear, stretched limbs")

# POV: the failure is the apparatus or a second body becoming visible, so name
# objects rather than the concept "third person". The hand terms mirror the
# four-channel HANDS rule in brain._pov_contract — the positive spends 30
# lines preventing exactly these, and the negative should back it up.
_POV = ("camera in frame, phone in frame, selfie stick, tripod, "
        "camera operator visible, second pair of hands, disembodied arms, "
        "floating hands, palm facing camera, splayed fingers, oversized hands")

# LTX 2.3 generates audio, so mouth-shape terms and sound terms both carry.
_SILENT = "moving lips, open mouth mid-speech, talking, speech, singing, voiceover"


def _dedupe(groups):
    seen, out = set(), []
    for group in groups:
        for t in str(group or "").split(","):
            t = " ".join(t.split()).strip().lower()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return ", ".join(out)


def build(pov=False, music=False, silent=False):
    terms = [_QUALITY, _ANATOMY, _OVERLAY, _TEMPORAL]
    if not music:
        # Only suppress music when no soundtrack preset is active — otherwise
        # the negative fights the positive prompt.
        terms.append("background music, score, soundtrack")
    if silent:
        terms.append(_SILENT)
    if pov:
        terms.append(_POV)
    return _dedupe(terms)
