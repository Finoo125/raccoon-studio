"""Self-check for the prompt-assembly path. `python selftest.py` — no ComfyUI,
no LLM, no network.

Scope is deliberately narrow: the invariants that broke before, plus the call
contract between generation_core (the plumbing) and brain/negatives (the law
modules). Signature drift between those two is invisible to any test that calls
the law modules directly with hand-written kwargs, so everything here goes
through assemble_preview() — the same entry the /rvn/* routes use.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import brain as brain          # noqa: E402
import generation_core as gc      # noqa: E402
import negatives                  # noqa: E402

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


def preview(**body):
    body.setdefault("video_mode", "t2v")
    body.setdefault("duration_s", 15)
    return gc.assemble_preview(body)


# ── detectors: substring matching used to fire on innocuous words ────────────
for intent in ("A petite Korean woman walks through the grass in London.",
               "She strides across the glass floor of the office.",
               "The analyst passes a document to the assistant.",
               "He wears a bracelet and a washed denim jacket.",
               "A bassist tunes up while she brushed her hair.",
               "She has a great attitude and a titanium ring."):
    check(not gc._infer_explicit(intent), f"false explicit: {intent}")
    check(not brain._wants_undress(intent, ""), f"false undress: {intent}")

for intent in ("she sucks his cock", "hardcore sex, he thrusts into her",
               "a nude woman, penetration from behind", "she is naked and orgasms",
               "she is riding him", "cumming hard", "a sexy dance"):
    check(gc._infer_explicit(intent), f"missed explicit: {intent}")

for intent in ("she undresses slowly", "she unzips her dress and pulls it off",
               "she strips out of her panties", "she takes off her shirt",
               "stripping down", "removing her bra"):
    check(brain._wants_undress(intent, ""), f"missed undress: {intent}")

# the explicit clause must not reach a brief that never asked for it
p = preview(user_intent="A petite Korean woman walks through the grass in London.")
check(not p["explicit"], "innocuous intent flagged explicit")
check("name cock, pussy" not in p["system"], "explicit clause leaked into brief")

# ── max_tokens must not silently undercut the brief's own arithmetic ─────────
for dur in (2, 6, 10, 12, 15, 20, 25, 30):
    lo, hi = brain._sections_hint(dur)
    want = 480 + hi * 300 + 200 + 300           # pov + talkative, the worst case
    got = brain.max_tokens(dur, "t2v", True, True)
    check(got >= want, f"max_tokens clamps at {dur}s: asks {want}, grants {got}")

# ── the brief states each law once ───────────────────────────────────────────
for mode in ("i2v", "t2v"):
    s = preview(video_mode=mode, pov=True,
                user_intent="she leans against the wall")["system"].lower()
    check(s.count("reminder for") == 0, f"{mode}: REMINDER restatement block is back")
    heads = (s.count("head + torso rule") + s.count("body orientation rule")
             + s.count("body mechanics"))
    check(heads == 1, f"{mode}: head/torso rule stated {heads}x, expected 1")
    anchor = s.count(brain._I2V_ANCHOR.lower())
    # i2v: the rule + the worked example. t2v: never.
    check(anchor == (2 if mode == "i2v" else 0),
          f"{mode}: i2v anchor appears {anchor}x")
    check("light." in s and "sound is diegetic" in s, f"{mode}: LIGHT/SOUND law missing")

# ── negative prompt: artifact names only, no repeats ─────────────────────────
DEAD = ("wrong hand count", "head only turn", "head swivel without body",
        "third person view", "still image", "bad quality")
for kw in ({}, {"pov": True}, {"music": True}, {"silent": True},
           {"pov": True, "music": True, "silent": True}):
    n = negatives.build(**kw)
    terms = [t.strip() for t in n.split(",")]
    check(len(terms) == len(set(terms)), f"negative has duplicates for {kw}: {n}")
    for d in DEAD:
        check(d not in n, f"non-visual term {d!r} back in negative for {kw}")

check("background music" not in negatives.build(music=True),
      "negative fights the positive: music suppressed while a preset is active")
check("background music" in negatives.build(music=False),
      "music not suppressed when no preset is active")
check("moving lips" in negatives.build(silent=True), "silent bank missing")
check("moving lips" not in negatives.build(silent=False), "silent bank leaked")
check("second pair of hands" in negatives.build(pov=True), "POV apparatus bank missing")

# ── director doctrine: a timeline of shots, not one start frame ──────────────
d = preview(video_mode="director", user_intent="she walks the corridor")["system"].lower()
check("this clip's shots" in d, "director brief never says the images are the shots")
check(brain._I2V_ANCHOR.lower() not in d, "director brief carries the i2v start-image anchor")
check("with no reference image" not in d, "director brief claims there is no reference image")

# ── vision: Director hands over EVERY shot picture, not just the first ───────
many = brain.build_messages("sys", "intent", 15, "director",
                            image_b64=["aaa", "bbb", "ccc"], has_vision=True)[1]["content"]
check(sum(1 for p in many if p["type"] == "image_url") == 3,
      f"build_messages dropped director shot images: kept {len(many) - 1}")
check(many[-1]["type"] == "text", "build_messages lost the text part")
# a bare string still works — every other mode sends exactly one
one = brain.build_messages("sys", "intent", 15, "i2v", image_b64="aaa", has_vision=True)[1]["content"]
check(sum(1 for p in one if p["type"] == "image_url") == 1,
      "build_messages broke the single-image path")
# no pictures at all: content stays a plain string, not a one-element list
none = brain.build_messages("sys", "intent", 15, "t2v", image_b64=[], has_vision=False)[1]["content"]
check(isinstance(none, str), "text-only messages grew a content list")
# a data: URL is stripped once, never re-prefixed
pre = brain.build_messages("s", "i", 15, "director",
                           image_b64=["data:image/png;base64,zzz"], has_vision=True)[1]["content"]
check(pre[0]["image_url"]["url"] == "data:image/jpeg;base64,zzz",
      f"data: prefix mishandled: {pre[0]['image_url']['url']}")

# ── generation_core: which modes open a vision pass, and on what ─────────────
# All three gates below return before any I/O, so this needs no LLM — only the
# managed backend (the gates are inert on a remote one) and a stubbed boot, so
# a body that passes every gate stops instead of launching llama-server.
import asyncio  # noqa: E402


async def _stub_boot(*_a, **_k):
    yield "error: boot-stub"


gc.boot_llama = _stub_boot
llm_backend_was = gc.llm.CONN["backend"]
gc.llm.CONN["backend"] = gc.llm.MANAGED


def gate(**body):
    """The error `generate_prompt` stops at, before it reaches the LLM.

    Stripped: the node slices its own `error:` prefix off by a fixed 6 chars,
    so anything it forwards keeps a leading space.
    """
    body.setdefault("model_file", "m.gguf")
    body.setdefault("mmproj_file", "None (text-only)")
    body.setdefault("duration_s", 15)
    body["skip_flush"] = True
    return asyncio.run(gc.generate_prompt(body)).get("error", "").strip()


PIC = ["aaa", "bbb"]
NEEDS_MM = "needs an mmproj"
# i2v still refuses to run blind, and still accepts one bare string.
check(gate(video_mode="i2v", image_b64="") == "I2V needs an image", "i2v blind gate gone")
check(gate(video_mode="i2v", image_b64=[]) == "I2V needs an image", "empty list read as an image")
check(NEEDS_MM in gate(video_mode="i2v", image_b64="aaa"), "i2v lost its vision pass")
# Director: pictures mean vision, no pictures means write blind rather than fail.
check(NEEDS_MM in gate(video_mode="director", image_b64=PIC), "director shots never reach vision")
check(gate(video_mode="director", image_b64=[]) == "boot-stub",
      "an empty director timeline no longer writes blind")
# ref2v is deliberately excluded — H3's reference doctrine was tuned without a
# vision pass, and switching one on would silently rewrite every ref2v prompt.
check(gate(video_mode="ref2v", image_b64=PIC) == "boot-stub", "ref2v grew a vision pass")

gc.llm.CONN["backend"] = llm_backend_was

# ── plumbing contract: node.py calls build() with the kwargs it now takes ────
import inspect  # noqa: E402
sig = inspect.signature(negatives.build)
sig.bind(pov=True, music=False, silent=True)
inspect.signature(brain.max_tokens).bind(15, "t2v", True, True)

# Both doctrines take generation_core's ONE kwarg set. The H3 reference work
# added `ref_counts` to that call and to h3_brain alone, and every LTX and
# Director enhance then died on an unexpected keyword before reaching Ollama.
import h3_brain  # noqa: E402
_DOCTRINE_CALL = dict(
    mode="t2v", duration_s=15.0, pov=False, pov_gender="female", explicit=False,
    dialogue_tier="standard", energy=5, intent="x", environment_block="",
    scenario_block="", camera_block="", music_block="", seed=1, ref_counts=None,
)
for _doc in (brain, h3_brain):
    for _fn in ("build_system", "finalize"):
        try:
            inspect.signature(getattr(_doc, _fn)).bind(
                **(_DOCTRINE_CALL if _fn == "build_system" else {}),
                **({"text": "x", "mode": "t2v", "intent": "x", "ref_counts": None}
                   if _fn == "finalize" else {}),
            )
        except TypeError as e:
            fails.append(f"{_doc.__name__}.{_fn} rejects generation_core's call: {e}")

if fails:
    print(f"FAIL — {len(fails)} problem(s):")
    for f in fails:
        # ASCII marker on purpose: a Windows console runs cp1252, and printing
        # "✗" there raises UnicodeEncodeError — so the one run that has
        # something to report is the one that dies before reporting it.
        print(f"  x {f}")
    sys.exit(1)
print("OK — prompt assembly, detectors, budgets and negative all pass.")
