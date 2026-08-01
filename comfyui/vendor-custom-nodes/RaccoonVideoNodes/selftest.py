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

# ── plumbing contract: node.py calls build() with the kwargs it now takes ────
import inspect  # noqa: E402
sig = inspect.signature(negatives.build)
sig.bind(pov=True, music=False, silent=True)
inspect.signature(brain.max_tokens).bind(15, "t2v", True, True)

if fails:
    print(f"FAIL — {len(fails)} problem(s):")
    for f in fails:
        print(f"  ✗ {f}")
    sys.exit(1)
print("OK — prompt assembly, detectors, budgets and negative all pass.")
