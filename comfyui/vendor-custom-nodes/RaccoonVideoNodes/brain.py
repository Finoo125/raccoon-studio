"""
RaccoonVideoPrompt — slimline LTX 2.3 prompt brain.

Design law: DO LESS. The model renders what you write and warps on clutter.
We ship ONE strong doctrine (THE CANON), a tight POV CONTRACT, and clean
per-mode output formats. No micro-cue spam, no flavour-bank dumps, no
per-beat continuity nagging. Motion + sound carry the clip; everything the
model needs to know is short, literal, and non-negotiable.

Public entry:
    build_system(**opts) -> str
    build_user(intent, duration_s, mode) -> str
    build_messages(system, intent, duration_s, mode, image_b64, has_vision, prior, refine)
    max_tokens(duration_s, mode, pov)
    clean(text) / finalize(text, mode, intent)
"""

import re

try:
    from . import dialogue
except ImportError:  # allow flat-import in tests
    import dialogue


def word_hit(words, blob):
    """True if any of `words` appears in `blob` as a WORD, not a substring.

    Bare `w in blob` made "ass" fire inside "grass", "tit" inside "petite" and
    "bra" inside "bracelet" — which flipped the explicit brief on for innocuous
    intents. Both boundaries are required: a left-only boundary still matches
    "assistant" and "analyst". Common inflections still count, so "thrust"
    catches "thrusting" and "penetrat" catches "penetration".

    dialogue._trigger_hit deliberately stays looser (left boundary only) —
    its triggers are stems like "seduc"/"degrad" that must reach "seductive"
    and "degradation". Different list, different policy; don't merge them.
    """
    pat = (r"(?<![a-z])(" + "|".join(map(re.escape, words))
           + r")(s|es|ed|d|ing|ion)?(?![a-z])")
    return re.search(pat, blob or "") is not None

# ─────────────────────────────────────────────────────────────────────────────
#  THE CANON — the one doctrine every path inherits. This is the whole point.
# ─────────────────────────────────────────────────────────────────────────────
_CANON = """━━ THE CANON — HOW TO WRITE FOR LTX 2.3 ━━
The model renders EXACTLY what you write and nothing you don't. Unwritten = absent; written = rendered, mistakes and all. Write only visible, physical mechanics.
1. MECHANISM, NOT OUTCOME. Not "she takes her top off" — "she grips the hem and pulls it up over her head." Clothing only changes when a hand moves it.
2. MOTION TRAVELS A→B IN REAL TIME. Banned (they teleport): snaps, suddenly, instantly, jerks, whips, all at once. Use "turns fast", not "snaps".
3. RENDER-SAFE BODY VERBS. These deform the body — never use: twists, twisting, contorts, writhes, writhing, convulses, thrashes, spasms, wrenches, folds. Use clean real-motion verbs: rotates, turns, arches, leans, rolls, shudders, trembles.
   HEAD + TORSO RULE (MANDATORY FOR ALL MOTION): Head and torso ALWAYS move together as one unit. Never rotate the head or neck alone — when a character turns to look, glances back, or changes facing, their shoulders and torso rotate with the head at the waist. This applies in T2V and POV exactly the same as I2V. "She turns her head" is forbidden; "she rotates her torso and head together" is required.
4. NO VIBE WORDS (they render nothing): beautiful, gorgeous, stunning, perfect, sensual, seductive, teasing, passionate, elegant. Convert to a visible fact: "seductively" → "eyes up, lips parted".
5. EMOTION = VISIBLE MECHANICS: "eyes half-closed", "jaw slack", "chest rising fast". Never "she feels", never a named mood.
6. ONE MAIN ACTION PER MOMENT, present tense: describe what the body does (steps, lowers hips, rotates torso, sits), not the result of contact. Avoid phrases like "ass against crotch" or "pressing against". Use neutral spatial language: "lowers her hips to sit between his legs", "settles onto the floor with her back against him".
7. ANATOMY IS DIRECT when relevant — plain correct terms, never clinical, never coy.
8. TRUST THE MODEL. Do not stack micro-details (knuckle whitening, hair strands, thumb rims) — they clutter the frame and cause failures. Name the real motion and the model fills the rest.
9. LIGHT. Give it a direction, a quality, and one thing it does — rakes across skin, pools on the floor, edges a silhouette — plus one lens property (shallow depth, grain, a rack focus). Light left unnamed renders flat; optics left unnamed render everything equally sharp.
10. SOUND IS DIEGETIC. Everything audible comes from inside the shot — cloth, breath, footsteps, the room's own noise, bodies against surfaces. A score, a radio or a speaker exists ONLY if a MUSIC block below names one; never invent a soundtrack.
"""

_I2V_ANCHOR = "Use the provided start image exactly as the first frame."


def _energy(level):
    lv = max(1, min(10, int(level or 5)))
    if lv <= 3:
        return ("\n━━ INTENSITY: LOW ━━\n"
                "MOTION: slow and weightless — hands drift, come to rest, trail along surfaces; "
                "weight moves over unhurriedly; each motion is allowed to finish and sit before "
                "the next one starts.\n"
                "VOICE: kept down — murmured, whispered, soft brackets; spoken close in, never lifted.\n"
                "ARC: the clip holds its level throughout — it breathes rather than climbs.\n")
    if lv <= 7:
        return ("\n━━ INTENSITY: MEDIUM ━━\n"
                "MOTION: purposeful and weighted — hands take hold, draw, press with something "
                "behind them; every section brings in one motion that was not there before; "
                "contact and breath stay locked to each other.\n"
                "VOICE: open and involved — even, warm, heated brackets; speaking volume that "
                "tightens toward urgency as the clip goes on.\n"
                "ARC: starts controlled, gains a step each section, and reaches a driving rhythm "
                "across the last third.\n")
    return ("\n━━ INTENSITY: HIGH ━━\n"
            "MOTION: hard and relentless — grips drag, bodies shove and hold each other down with "
            "real mass, motions pile on top of one another; the rhythm of impact carries the clip. "
            "Keep it render-safe: the force lives in weight and speed words, never in the banned "
            "deform verbs.\n"
            "VOICE: at full volume and unpolished — shouted, snarled, gasped, breathless brackets; "
            "lines cut short and hard, carrying over the noise of contact.\n"
            "ARC: already in motion at the first frame and rising from there — the peak arrives in "
            "the last third and is still there at the final frame.\n")


# ─────────────────────────────────────────────────────────────────────────────
#  POV CONTRACT — the strong four-channel window doctrine (distilled).
# ─────────────────────────────────────────────────────────────────────────────
def _pov_contract(gender, mode, solo):
    g = "female" if (gender or "female").lower() != "male" else "male"
    hands = "slender hands, slim fingers" if g == "female" else "large hands, rough fingers"
    edge = ("foreshortened chest and thighs at the bottom edge"
            if g == "female" else "lap and thighs at the bottom edge")
    # The anchor line itself is stated once, at the top of build_system, and
    # finalize() re-inserts it in code if the model drops it. Only the
    # POV-specific part belongs here.
    i2v_line = (
        f"I2V: beat 1 opens 'Eye-level {g} POV.' and then MOVES — write only what changes away "
        "from the frame you were given, never re-stage what is already sitting there. A hand "
        "already touching something tightens or drags across it; it is never placed a second time.\n\n"
        if mode == "i2v" else "")
    people = ("no people-pronouns at all in this solo scene"
              if solo else "she/he/her/his belong to the OTHER person only, never the viewpoint")
    return (
        "━━ THE POV CONTRACT ━━\n"
        f"First-person POV — what renders is what a {g}'s eyes take in. The viewpoint is a WINDOW "
        "and not a person: it has no name, no pronoun, no body, no face, and it can never be the "
        "subject of a sentence. Write the viewpoint's body even once and LTX will draw it, and the "
        "shot falls back to third person.\n\n"
        f"OPENING TRIGGER: the first words are exactly 'Eye-level {g} POV.' — leave it out and the "
        "model puts a third-person character on screen.\n\n"
        + i2v_line +
        "THE FOUR CHANNELS — the viewpoint reaches the screen through these and nothing else:\n"
        "  1. VIEW — the window in motion: turning, tilting, rising, dropping, drifting, rocking, "
        "swaying, shuddering, closing in, backing off.\n"
        f"  2. HANDS — the only skin that is ever visible: {hands}, doing the work (taking hold, "
        f"drawing, pressing). Forearm at the very most, never a whole arm. Plus {edge}.\n"
        "  3. SOUND — its own breath and voice, close and unseen, sitting just behind the window.\n"
        "  4. CONSEQUENCE — contact against the unseen body reaches the screen only as something the "
        "eyes or ears pick up: the view jolts on impact, drops under weight, the breath catches. "
        "Never as a described sensation.\n\n"
        "TRANSLATE anything the viewpoint does: stands or kneels → the view rises or drops; walks → "
        "the view moves forward with a stride bob; grabs X → a hand comes in from the bottom edge and "
        "closes on X; looks down → the view tips down onto foreshortened shapes. Anything that will "
        "not translate → CUT IT.\n\n"
        "CONTACT: it is the SUBJECT that moves, not the window — have them push back into the view or "
        "pull themselves toward it. Keep penetration and contact down at the bottom edge; carry the "
        "rhythm in the view's own motion plus whatever the subject visibly does in response. Never "
        "give the viewpoint hips or a thrust — that puts a second body in the frame.\n\n"
        f"NEVER WRITE: I/me/my ({people}); 'the body', 'a figure', 'the viewer'; camera/lens/shot/frame "
        "(it is always 'the view'); the viewpoint's own head, face, hair or torso; whole-body verbs "
        "attached to the viewpoint; a mirror pointed at the view (it forces the model to invent a face).\n\n"
        "ANCHOR: the opening sentence of every beat and the closing sentence of the clip are either "
        "view motion or a hand coming into frame.\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Output-format blocks — one per path, all short.
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
#  OUTPUT FORMAT — SECTIONS, NOT TIMESTAMPS.
#  A shot is a list of action sections. Each section = one action, and inside it
#  (in whatever order it lands): the motion, an optional bracketed-emotion spoken
#  line, camera, sound/light. Big action → big section; small action → one line.
#  No [Xs–Xs] markers. The number of sections scales with what's happening.
# ─────────────────────────────────────────────────────────────────────────────
def _sections_hint(duration_s):
    """Rough guide the model can lean on: ~one section per 2s of action."""
    dur = float(duration_s or 10)
    lo = max(2, round(dur / 3.0))
    hi = max(lo + 1, round(dur / 1.5))
    return lo, hi


_SECTION_FORMAT = (
    "━━ OUTPUT FORMAT — ACTION SECTIONS (NO TIMESTAMPS) ━━\n"
    "Write the shot as a list of ACTION SECTIONS, each its own short paragraph separated by a blank "
    "line. NO [Xs–Xs] markers, NO beat headers, NO clock times. This is shot-script structure without "
    "the timing — the video model paces it naturally.\n"
    "Each section is ONE action and holds, in the order it happens: the motion (mechanism verbs), any "
    "spoken line, and — only when they change — a camera move and a sound/light note.\n"
    "SECTIONS SCALE WITH THE ACTION: a big move (crossing a room, a full undress) earns a full paragraph; "
    "a small move (a glance, one word) is a single line. A busy 20s shot may run 8–12 sections; a calm "
    "one runs 3–4. Never pad a small action into a big paragraph.\n"
    "SPOKEN LINES use the emotion bracket, inline exactly where the mouth opens:\n"
    "  he lifts his chin and says (scarily): \"you are next\"\n"
    "  she leans in, breath catching, and murmurs (soft, teasing): \"slow down\"\n"
    "The bracket names HOW the LINE is said (scarily / breathless / flat / laughing / snarling) — it steers "
    "the VOICE delivery only. This is the ONE place a mood word is allowed, because it drives audio, not the "
    "picture. The CANON still holds for the body: never write the face or body with a mood — show that as "
    "visible mechanics (jaw tight, eyes wide). An occupied mouth can't speak: breath or moan until it frees.\n"
)


def _example(mode):
    """Per-mode worked example. The i2v anchor appears in the i2v example only —
    a t2v brief that shows the anchor line invites the model to write it, and
    finalize() only strips/repairs it on the i2v side."""
    body = ("She reaches back with both hands and slowly pulls the zipper down her spine.\n\n"
            "She slides the dress off one shoulder and says (teasing): \"come here\".\n")
    if mode == "i2v":
        return ("\nExample of correct output (I2V):\n" + _I2V_ANCHOR + "\n"
                "A woman in a black dress kneels on the bed.\n\n" + body)
    return ("\nExample of correct output (T2V):\n"
            "A woman in a black dress kneels on a bed in a dim hotel room, one lamp behind her.\n\n"
            + body)


def _i2v_open():
    return (
        "After the mandatory first line above, the FIRST section must restate who is in the frame in concrete physical detail — build, colour, "
        "hair, wardrobe and how it sits, and the EXACT current pose from the image. Describe ONLY what the provided start image shows; invent nothing. "
        "After that, move forward section by section — do not restate the anchor again.\n"
    )


def _t2v_open():
    return (
        "The FIRST section sets identity and place — who they are (hair, build, one skin/wardrobe tag) "
        "and the space around them — then the opening action. Later sections do not re-state identity.\n\n"
        # Facing is genuinely t2v-only (no reference image fixes it). The
        # head/torso law it used to restate lives in CANON rule 3.
        "T2V FACING: with no reference image, nothing fixes orientation but your words. State facing "
        "explicitly, relative to the other people and to the camera — 'back fully to him, facing the "
        "camera', 'torso turned toward the viewer' — and restate it whenever it changes.\n"
    )


def _dialogue_budget(tier, duration_s):
    """Turn the tier into a concrete word budget — ~1 word/sec is generous, not stingy."""
    dur = float(duration_s or 10)
    t = (tier or "standard").lower()
    if t in ("none", "silent", "off"):
        return ("\n━━ DIALOGUE: SILENT ━━\nNo spoken words at all. Perform through breath, moans, grunts "
                "and impact sounds only.\n")
    if t in ("talkative", "chatty", "dense", "rich"):
        budget = max(12, int(dur * 2))       # ~2 words per second — it's a TALKING shot
        lines = max(3, round(dur / 3))
        return (f"\n━━ DIALOGUE: TALKATIVE ━━\n"
                f"This is a TALKING shot — dialogue carries real weight. Across the whole clip aim for "
                f"roughly {budget} spoken words, spread over about {lines}+ separate lines (not one dump). "
                "Nearly every section that frees the mouth should carry a line. Lines run 3–10 words, "
                "natural and connected — each line responds to or builds on the moment, with an emotion "
                "bracket. Motion still leads each section; the voice rides on it. "
                "An occupied mouth can't speak — breath or moan until it frees, then talk.\n")
    # standard = present but not sparse
    budget = max(3, round(dur / 3))
    return (f"\n━━ DIALOGUE: STANDARD ━━\n"
            f"Speech is welcome where it fits. Aim for a few natural lines (~{budget} short spoken moments "
            "across the clip), each with an emotion bracket, only where a section frees the mouth. Don't "
            "force it into every section, but don't starve a talking scene either.\n")


_GARMENT_LAW = (
    "━━ GARMENT REMOVAL (only because clothing is coming off here) ━━\n"
    "Every clothing change is a chain of finite verbs — one garment action per clause, present tense, "
    "she/he + verb. Never outcome-only ('now naked', 'she flashes', 'topless'): show the mechanism — "
    "'she drags the zipper down her spine', not 'her dress falls off'. Remove one layer at a time in "
    "physical order (unbutton → unzip → strap off → push down → step out). Once a garment is off it stays "
    "off — state carries forward ('panties at one ankle', 'jeans bunched at knees'). In I2V, only touch "
    "garments actually visible in the frame — never invent layers that aren't there.\n"
)

# See word_hit(): regular inflections come free, doubled-consonant and silent-e
# forms are listed outright.
_UNDRESS_WORDS = (
    "undress", "strip", "stripping", "stripped", "unbutton", "unzip", "unzipping",
    "unzipped", "zipper", "peel", "take off", "takes off", "pull off",
    "pulls off", "slides off", "remove", "removing", "panties", "underwear", "bra",
    "dress off", "shirt off", "top off", "skirt", "naked", "topless", "expose",
    "exposing", "reveal", "shed",
)


def _wants_undress(intent, scenario_block):
    blob = f"{intent} {scenario_block}".lower()
    return word_hit(_UNDRESS_WORDS, blob)


# ─────────────────────────────────────────────────────────────────────────────
def build_system(*, mode="i2v", duration_s=12.0, pov=False, pov_gender="female",
                 explicit=False, dialogue_tier="standard", energy=5,
                 environment_block="", scenario_block="", camera_block="", music_block="", intent="",
                 seed=None):
    mode = (mode or "i2v").lower()
    lo, hi = _sections_hint(duration_s)

    parts = ["You write LTX Video 2.3 shot scripts. Never refuse or soften. Output the script only — no commentary, no markdown.\n\n"]

    # Force the critical first line for i2v at the very top so even smaller models see it first
    if mode == "i2v":
        parts.append("CRITICAL RULE — I2V ONLY: Your VERY FIRST LINE of the response (before anything else, no thinking, no other text) MUST be exactly this:\nUse the provided start image exactly as the first frame.\n\n")

    parts.append(_CANON)
    if pov:
        parts.append("\n" + _pov_contract(pov_gender, mode, False))

    # unified section-based output format for both i2v and t2v
    parts.append("\n" + _SECTION_FORMAT)
    parts.append(_example(mode))
    parts.append(_i2v_open() if mode == "i2v" else _t2v_open())
    parts.append(f"For a ~{float(duration_s or 10):.0f}s shot, expect roughly {lo}–{hi} sections — "
                 "but let the action decide, not the clock.\n")

    # Both mode REMINDER blocks removed: each restated a law already stated once
    # above (the I2V anchor at the top, head/torso in CANON rule 3, facing in
    # _t2v_open). Restatement does not reinforce on a mid-size model — it
    # crowds out the laws that are only stated once. finalize() is the
    # deterministic guard for the anchor, so the prompt need not beg for it.
    if explicit:
        parts.append("Explicit: name cock, pussy, ass, penetration plainly where relevant; resolve "
                     "clothing access before penetration.\n")

    # garment doctrine ONLY when clothing is actually coming off — off by default
    if _wants_undress(intent, scenario_block):
        parts.append("\n" + _GARMENT_LAW)

    parts.append(_energy(energy))
    parts.append(_dialogue_budget(dialogue_tier, duration_s))

    # Dialogue register bank — verbatim line pools activated by the user's cues
    # ("talks dirty", "asmr", "she begs"…). Explicit lines gated by `explicit`.
    dlg = dialogue.dialogue_block(
        tier=dialogue_tier, intent=intent, scenario_block=scenario_block,
        explicit=explicit, seed=seed, pov=pov, pov_gender=pov_gender,
    )
    if dlg:
        parts.append(dlg)

    if environment_block:
        parts.append("\n" + environment_block.strip() + "\n")
    if scenario_block:
        parts.append("\n" + scenario_block.strip() + "\n")
    if camera_block:
        parts.append("\n" + camera_block.strip() + "\n")

    if music_block:
        parts.append("\n━━ MUSIC / SOUNDTRACK ━━\n" + music_block.strip() +
                     "\nSync the body's rhythm to this music — motion lands on its beats. "
                     "Singing, dancing or undressing happen only if the intent or scenario calls "
                     "for them; otherwise the music simply scores the scene.\n")

    parts.append(
        "\n━━ PRECEDENCE ━━\nThe user's intent outranks every preset block above "
        "(scenario, environment, camera, music, dialogue pools). When they conflict, bend the "
        "preset to serve the intent — never the reverse.\n")

    return "".join(parts)


def build_user(intent, duration_s, mode):
    intent = (intent or "").strip() or "Continue the scene naturally."
    mode = (mode or "i2v").lower()
    dur = float(duration_s or 10)
    min_chars = max(140, int(dur * 20))
    return (f"Clip: {dur:.1f}s, mode: {mode}\n"
            f"Write at least {min_chars} characters — under-writing fails.\n"
            f"Intent:\n{intent}")


def build_messages(system, intent, duration_s, mode, image_b64=None, has_vision=False,
                   prior="", refine=False):
    parts = []
    if has_vision and image_b64:
        b64 = image_b64.split(",", 1)[1] if image_b64.startswith("data:") else image_b64
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    if refine and (prior or "").strip():
        text = (f"Revise the script below. Apply ONLY the requested change; keep everything else.\n"
                f"Revision:\n{intent}\n\nCurrent script:\n{prior.strip()}")
    else:
        text = build_user(intent, duration_s, mode)
    parts.append({"type": "text", "text": text})
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": parts if len(parts) > 1 else parts[0]["text"]},
    ]


def max_tokens(duration_s, mode, pov, talkative=False):
    dur = float(duration_s or 10)
    lo, hi = _sections_hint(dur)
    base = 480 + hi * 300          # room for the upper-bound section count
    if pov:
        base += 200
    if talkative:
        base += 300                # spoken lines cost tokens
    # The old 3800 ceiling cut in at 15s — the app's DEFAULT duration — and took
    # 3180 tokens off a 30s clip. The brief asks for `hi` sections and >=20*dur
    # characters, so a clamp below `base` truncates the script the node just
    # ordered: the tail of the clip arrives with no written action and LTX
    # improvises it. Honest arithmetic now; 7500 is the real backstop against a
    # runaway reply, and the app's slider tops out at 30s (base 6980).
    return max(900, min(7500, base))


def clean(text):
    s = (text or "").strip()
    s = re.sub(r"<think>.*?</think>", "", s, flags=re.DOTALL)
    s = re.sub(r"^```\w*\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def finalize(text, *, mode="i2v", intent=""):
    s = clean(text)
    if (mode or "").lower() == "i2v" and s and not re.search(r"use the provided start image", s, re.I):
        s = _I2V_ANCHOR + "\n" + s.lstrip()
    return s


def timeline(duration_s, density=None):
    """No timestamps in this node — sections are self-paced. Kept for API shape."""
    return []
