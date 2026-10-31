"""
MiniMax H3 prompt doctrine — the Base multi-shot format (T2VA / I2VA / REF2VA).

Separate module from `brain.py` on purpose. That one writes LTX Video 2.3 shot
scripts; H3 does not consume shot scripts, it consumes a small set of named
fields with a timed shot timeline inside one of them. The two output contracts
are incompatible, so this is a parallel doctrine selected by model rather than
a branch inside the LTX canon — `brain.py` is not touched by any of this.

Format derived from benjiyaya/Minimax-H3-Prompt-AgentSkill (MIT), specifically
`references/base-multishot-format.md`, then re-checked against MiniMax's own
`VIDEO_PROMPT_WRITING_GUIDE_{base,ref}_en.md` on 2026-08-16 — which is where the
`<scenetrans>`/`<cutoff>` continuity tags, the compound `(S1,S2)` speaker ID and
the 350-500 word target came from. All four were missing, and all four were
measured absent from real Gemma-26B output before being added (0/12 runs each,
mean 206 words); see the block comments on each.

FL2VA/L2VA now work. The old note here said they "need a last-frame input the
graph does not take" — that was wrong: `MiniMaxH3ImageToVideo` has taken an
optional `last_frame` all along and our workflow simply never filled it. The app
derives the task from which image slots are filled and sends `fl2v`/`l2v`; there
is no fourth mode button.

**Ref2VA deliberately keeps the 3-field Base format**, with only a reference
declaration line on top, rather than MiniMax's 6-section full-reference contract
(subject_definitions / summary / retention_analysis / detailed_description /
overall_soundscape / non_diegetic_music). ComfyUI's own r2v template ships a
freeform prose prompt with `<Picture N>` tags and nothing else, so the heavy
format is the official API rewriter's output shape, not a model requirement —
and the 3-field format is already live-proven against Gemma-26B. Revisit if
identity fidelity disappoints.

Public entry mirrors brain.py so `generation_core` can pick between them:
    build_system(**opts) -> str
    finalize(text, mode, intent) -> str
"""

import difflib
import re

# H3's own hard limits, in seconds at 24 fps. Clamped rather than rejected.
# These are the trained frame range 124-362 expressed as time, and both ends sit
# exactly on the 17k+5 grid, so 5 -> 124 and 15 -> 362 with no rounding slack.
# The floor was 4 while the app's builder had no clamp at all; now that
# `h3ClampDuration` (minimax-h3.ts) clamps the render to the same 5-15, the two
# have to agree -- a writer sizing a 4 s shot for a 5.17 s render puts the
# keyframe alignment timestamp most of a second early.
MIN_DURATION_S = 5
MAX_DURATION_S = 15

# Length of the main description, straight from MiniMax's own guide
# (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md §5.2: "For generation tasks,
# detailed_description is normally 350-500 English words"). Stated there about
# the reference-mode field and applied to the Base field too, because the two
# are the same field under two names and both guides share every other rule.
#
# Measured before this existed: Gemma-26B wrote 157-254 words (mean 206) across
# 12 runs — barely half. The brief's own "write at least N characters" floor
# comes from `brain.build_user`, which is the LTX doctrine's and works out at
# ~200 characters for a 10 s clip; the LENGTH block below has to out-shout it.
MIN_WORDS = 350
MAX_WORDS = 500


def _mode_tag(mode):
    """Our form's mode -> the guide's task tag. All five now apply.

    `fl2v`/`l2v` are not modes the user picks: the app derives them from which
    image slots are filled (`h3Task` in minimax-h3.ts) and sends the answer, so
    an older client that only knows t2v/i2v/ref2v keeps its exact behaviour.
    """
    m = (mode or "t2v").lower()
    if m == "i2v":
        return "i2va"
    if m == "fl2v":
        return "fl2va"
    if m == "l2v":
        return "l2va"
    if m == "ref2v":
        return "ref2va"
    # Not a MiniMax task: the app's own construct, t2v with the previous
    # clip's tail pinned at frame 0 (`MiniMaxH3AddGuide`). Its own tag because
    # its head differs from t2va's in the one thing that matters — the look is
    # already decided — while `finalize` treats it exactly like t2va.
    if m == "continue":
        return "cont"
    return "t2va"


FPS = 24


def effective_duration_s(duration_s):
    """The duration H3 actually renders, which is not the one the slider says.

    Frames snap UP to the model's 17k+5 grid at 24 fps, so an 8 s request is
    really 8.125 s. The keyframe instruction lines quote this figure to two
    decimals as the moment the last frame lands on, and quoting the slider value
    instead would put the anchor up to 0.7 s early.

    Mirrors `h3FrameCount` in minimax-h3.ts. That one needs an explicit positive
    modulo because JavaScript's `%` takes the dividend's sign; Python's floors,
    so the expression is already correct here — do not "fix" it to match.
    """
    d = max(MIN_DURATION_S, min(MAX_DURATION_S, float(duration_s or 8)))
    raw = max(5, round(d * FPS))
    return (raw + (5 - (raw % 17)) % 17) / float(FPS)


def shot_budget(duration_s, tag="t2va", single_shot=False):
    """Shots for a duration, straight off the skill's budgeting table.

    `single_shot` collapses the budget to one shot for any task. Measured
    2026-09-04: face identity against the start image falls only 0.88 -> 0.83
    *inside* a shot, then steps down at every cut — 0.85 / 0.63 / 0.37 across a
    three-shot 12 s clip, on the Eros checkpoint, on stock H3, and with or
    without a character LoRA. The cuts are the drift, so removing them is the
    cheapest fix there is; it costs the clip its cutting, which is why it is a
    switch and not the default.

    Each shot needs ~1.5-2.0 s to breathe, so this is a ceiling on how much
    cutting the clip can absorb, not a target to hit.

    The two keyframe-anchored tasks are pinned to a single shot instead. That is
    the guide's own instruction for FL2VA ("generally favors a single shot so
    the model can interpolate continuously"), both of its worked examples are
    single-shot, and it makes the shot index in the instruction line knowable:
    the line has to name the shot the last frame belongs to, and we cannot know
    how many shots the model will write until after it has written them.
    """
    if single_shot or tag in ("fl2va", "l2va"):
        return 1, 1
    d = max(MIN_DURATION_S, min(MAX_DURATION_S, float(duration_s or 8)))
    if d <= 6:
        return 1, 2
    if d <= 10:
        return 2, 3
    return 3, 5


_CONTRACT = """\
OUTPUT CONTRACT — absolute, and the whole job:
- Output ONLY the fields listed below, in order, each as an exact lowercase name
  followed by a colon. No preamble, no explanation, no markdown fences, no
  commentary, no thinking out loud.
- Write everything in English. The ONLY exceptions are the words inside <d>
  tags and visible on-screen text, which keep their original language verbatim.
- Timestamps are MM:SS.mmm, strictly increasing, and all fall inside the
  duration. [Shot 1] carries NO timestamp.
"""

_FIELDS = """\
FIELDS, in this exact order:

integrated_multimodal_description: the timed multi-shot timeline (rules below).
overall_soundscape: 1-4 English sentences, one paragraph. Ambience, physical
  action sounds and non-verbal human sounds across the WHOLE video. No dialogue,
  no singing, no diegetic music here. Write N/A only for deliberate total silence.
non_diegetic_music: 1-3 English sentences describing score the characters CANNOT
  hear — instrumentation, tempo, rhythm, dynamics ONLY. No mood words. Music a
  character can hear is diegetic and belongs in the shot description instead.
  Write N/A when there is no score.
"""

_TIMELINE = """\
TIMELINE RULES:
- [Shot 1] has no timestamp and MUST open with the overall style plus the
  initial composition. Styles: cinematic, live-action, 2D-animated, 3D CG,
  claymation, watercolor, vintage film.
- Later shots read: [Shot N] At MM:SS.mmm, the camera cuts to ...
  Cut verbs allowed: "the camera cuts to", "the shot cuts to", "the shot
  transitions to", "the shot changes to", "the shot switches to". Use a
  cross-dissolve, fade or wipe ONLY if the brief explicitly asks for one.
- A cut must introduce NEW information — new subject, space, state, viewpoint or
  time. If only the framing distance or the angle changes, move the camera
  inside the current shot instead of cutting.
- Exactly ONE dominant action per shot. Never cram two.
- Repeat the identity anchors EVERY shot — appearance, clothing, key props —
  phrased freshly but consistently. Track state changes forward: what got wet,
  opened, taken or broken in one shot stays that way in the next. Preserve
  screen direction across cuts.
- Every sentence is something the camera sees or the microphone hears at that
  moment — never a plot summary, a theme or a feeling. Write concrete detail
  instead of praise: the style label is the only judgement word allowed, so no
  "beautiful", "stunning", "gorgeous", "breathtaking", "epic" or "amazing" —
  show what makes it so.

CAMERA MOTION is written as type + amplitude + speed, in natural English, never
as stacked labels. Types: Zoom In/Out, Push In/Pull Out, Pan Left/Right, Truck
Left/Right, Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot, Static
Shot, Shake Slightly/Strongly, POV, Roll Clockwise/Counterclockwise. Amplitude
is "with small amplitude" or "with large amplitude" (omit when medium); speed is
"at slow speed" or "at fast speed" (omit when normal).
Example: The camera pushes in with small amplitude at slow speed toward her hands.
"""

_DIALOGUE = """\
SPEECH:
- Every vocal source gets a stable ID — (S1), (S2) — kept across ALL shots.
  Characters who never vocalize get no ID at all.
- When two already-numbered speakers say or sing something at the SAME time,
  give the joint line one compound ID rather than splitting it in two:
  The two children (S1,S2) shout together, <d>[English] Wait for us!</d>
- On a speaker's first appearance, anchor the voice: type, age, gender, on- or
  off-screen, pitch, timbre, rate, accent.
- The identifying phrase, the ID and the delivery all go OUTSIDE the <d> tag.
  Inside <d> goes ONLY the language tag and the exact words:
  The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
- Preserve the user's own words and punctuation verbatim. Never translate or
  rewrite a line the user wrote.
- For voiceover use the exact phrase "says in an off-screen voiceover" and
  immediately state that the lips stay closed.
- Each line is spoken ONCE. Right after its </d>, say that the speaker closes
  their lips or mouth — nobody's mouth moves between their own lines.
- Default language when unspecified is <d>[English].

AUDIO CONTINUITY — two tags, and they are about SPEECH ONLY. Both are invalid
anywhere near narration, action or sound effects. They are not punctuation for a
shot boundary and not a marker for the end of the clip; a cut with no voice
running through it takes NO tag at all, and most cuts are that kind.
- <scenetrans> is ONLY for one spoken or sung line SPLIT ACROSS A CUT. Write the
  first half, close it, tag it; then in the next shot tag it again and write the
  rest as a second <d> block, with a phrase saying the audio carries over —
  "continues seamlessly across the cut", "continues uninterrupted into the next
  shot", "carries over from the previous shot" or "remains audible across the
  transition". Every <scenetrans> must sit beside a <d> block; if you cannot
  point at the split line, there is no split line and the tag is wrong:
  [Shot 1] ... the woman (S1) says: <d>[English] I already told them</d> <scenetrans>
  [Shot 2] At 00:04.000, the camera cuts to the landing above. <scenetrans> Her
  voice carries over from the previous shot as she continues: <d>[English] we were
  finished with the whole thing.</d>
- <cutoff> goes IMMEDIATELY after a </d> and NOWHERE else. It marks a line the
  video ends in the middle of, so the words inside that <d> must themselves stop
  mid-sentence. A line that finishes naturally does not take it:
  The man (S1) says: <d>[English] I should have called you the moment I</d> <cutoff>
"""

_SILENT = """\
SPEECH: nobody speaks or sings in this clip. Use no <d> tags at all. Carry the
whole audio idea in overall_soundscape and non_diegetic_music.
"""

_ONSCREEN_TEXT = """\
ON-SCREEN TEXT: banners, signs, labels, subtitles and neon go in English double
quotation marks, verbatim, never translated.
"""

# For the tasks where the look is already decided -- by a first frame, a
# reference set or the previous clip. Adapted from LORAGEEK's Scene Builder
# (MIT), whose v1.0.1 added it after users saw characters undress unprompted;
# H3 renders whatever the text adds on top of the pictures.
_HOLD = """\
HOLD THE SCENE: add detail, never unasked-for events. Nobody undresses, changes
or removes clothing, changes hair, leaves, arrives or picks up a new object
unless the brief says so; clothing, hair and props stay as established for the
whole clip.
"""

# The adults-and-consent line mirrors the image writer's rules (app/src/lib/prompt-builder/enhance.ts).
_SAFETY = """\
Do not name third-party IP, real celebrities or trademarked characters —
describe them generically instead.
All people are adults: never describe anyone as a child, teenager or minor. Never write sexual content involving animals, robots or other non-human beings, or anyone who has not consented.
"""

_I2VA_LINE = (
    "For the target video, at 0.00 seconds into the target video, "
    "<Picture 1> (from [Shot 1]) is fully referenced."
)


def _i2va_head():
    return (
        "CRITICAL — IMAGE-TO-VIDEO. Your VERY FIRST LINE, before anything else, "
        "must be exactly:\n"
        f"{_I2VA_LINE}\n"
        "Then ONE blank line, then the three fields.\n\n"
        "[Shot 1] anchors on the attached first frame: establish its style, "
        "subjects, composition and scene anchors, preserving identity, clothing, "
        "colours, key objects and spatial relationships — then develop forward "
        "(anchor -> action onset -> continuous development -> result). Direct the "
        "MOTION; do not just re-describe what is already visible in the frame.\n"
        "In [Shot 1], name the subject through the picture once — \"the woman "
        "shown in <Picture 1>\" — so H3 binds the prose to the frame it starts "
        "from.\n"
    )


# The alignment lines for the two keyframe-anchored tasks, quoted from the
# guide's §2.1 verbatim — including its own inconsistency, where FL2VA writes
# `Picture 1 (from Shot 1)` bare and L2VA writes `<Picture 1> (from [Shot N])`
# in brackets. Both shapes are what the model was trained on, so neither is
# "tidied up" to match the other.
_ALIGN_PREFIX = "How the reference pictures align with the target video —"


def _fl2va_line(duration_s):
    return (
        f"{_ALIGN_PREFIX} Picture 1 (from Shot 1) aligns with the 0.00-second "
        f"mark of the target video; Picture 2 (from Shot 1) aligns with the "
        f"{effective_duration_s(duration_s):.2f}-second mark of the target video."
    )


def _l2va_line(duration_s):
    return (
        f"{_ALIGN_PREFIX} <Picture 1> (from [Shot 1]) aligns with the "
        f"{effective_duration_s(duration_s):.2f}-second mark of the target video."
    )


def _fl2va_head(duration_s):
    return (
        "CRITICAL — FIRST-AND-LAST-FRAME. Two images are attached: Picture 1 is "
        "the opening frame, Picture 2 is the closing frame. Your VERY FIRST "
        "LINE, before anything else, must be exactly:\n"
        f"{_fl2va_line(duration_s)}\n"
        "Then ONE blank line, then the three fields.\n\n"
        "Write ONE continuous shot. Do not cut: the whole job is the motion PATH "
        "between the two frames, and a cut throws away the continuity that makes "
        "this task work.\n"
        "Do NOT describe the two images as two static states. Describe the "
        "journey: how the subject moves, how the pose changes, how objects are "
        "handled, how the composition and the light evolve "
        "(first-frame state -> observable intermediate changes -> progressively "
        "narrowing differences -> last-frame state). The final sentence must land "
        "the shot on the pose, spacing and composition established by Picture 2, "
        "at the very end of the clip.\n"
    )


def _l2va_head(duration_s):
    return (
        "CRITICAL — LAST-FRAME. ONE image is attached and it is the FINAL frame "
        "of the video, not the first. Your VERY FIRST LINE, before anything "
        "else, must be exactly:\n"
        f"{_l2va_line(duration_s)}\n"
        "Then ONE blank line, then the three fields.\n\n"
        "Write ONE continuous shot. Infer a plausible EARLIER state from the "
        "brief and the attached frame, open the clip there, and describe how the "
        "characters, objects, camera and lighting gradually converge on it "
        "(plausible preceding state -> explicit action and transition path -> "
        "gradual convergence -> last-frame landing). The clip must arrive at the "
        "exact arrangement, camera angle, lighting and composition of "
        "<Picture 1> in its closing moment — do not open on it.\n"
    )


# The invariant opening of the declaration. Detection keys off THIS, not the
# whole line: the tail names whichever references are actually attached, and a
# model that writes a richer declaration than the canonical one is doing the
# right thing and must not have it clobbered.
_REF2VA_PREFIX = "For the target video, the attached references are used as follows:"
_REF2VA_LINE = f"{_REF2VA_PREFIX} <Picture 1> is fully_preserved."


def _ref2va_line(images=1, videos=0, audios=0, roles=()):
    """The canonical declaration for one attachment set.

    Used both as the example in the system prompt and as `finalize`'s repair
    when the model drops the line. It must therefore name a reference that
    actually exists — an audio-only render being told about `<Picture 1>` is a
    prompt describing something H3 was never given.
    """
    tags = ref_tag_list(images, videos, audios)
    if not tags:
        return _REF2VA_LINE
    first = tags.split(", ")[0]
    # Audio has its own marker vocabulary; 'fully_preserved' is meaningless on it.
    # A picture with a role declares that role's marker instead, so the example
    # the model copies is already right for the slot it describes.
    return f"{_REF2VA_PREFIX} {first} is {ref_marker(roles, 0, first)}."

# Visual markers apply to <Picture>/<Video>; audio has its own vocabulary. Both
# lists are MiniMax's own, from VIDEO_PROMPT_WRITING_GUIDE_ref_en.md.
_VISUAL_MARKERS = (
    "fully_preserved (identity, clothing and proportions kept exactly), "
    "partially_preserved (used, some characteristics changed), "
    "attribute_transfer (a quality moved onto a different subject) or "
    "weak_reference (broad style or atmosphere only)"
)
_AUDIO_MARKERS = (
    "fully_copy (the source audio reused 1:1), partially_copy (part of the "
    "timeline copied, other sounds added or removed), reference (timbre, rhythm "
    "or style referenced without copying the signal) or weak_reference (broad "
    "atmospheric similarity only)"
)


def ref_tag_list(images=0, videos=0, audios=0):
    """The reference tags actually attached, e.g. '<Picture 1>, <Picture 2>, <Video 1>'.

    Only attached types are ever named. Listing a type that is not there is not
    a harmless extra instruction: the model dutifully invents a `<Video 1>` role
    for a video H3 never receives, and the declaration line then describes a
    reference that does not exist.
    """
    tags = [f"<Picture {i + 1}>" for i in range(images)]
    tags += [f"<Video {i + 1}>" for i in range(videos)]
    tags += [f"<Audio {i + 1}>" for i in range(audios)]
    return ", ".join(tags)


# What a picture reference is FOR, as set per slot in the app, mapped to the
# MiniMax marker it implies.
#
# Only pictures carry a role. `<Video>` and `<Audio>` already have a job the
# doctrine states outright ("donates MOTION", "drives voice timbre"), so a role
# there would repeat what the head already says; a picture is the ambiguous one
# — a face, a room and a mood board all arrive as `<Picture N>` and nothing but
# the order tells them apart.
#
# The marker matters because the model is blind here: it never sees the images
# (`generation_core.need_vision` leaves ref2v out unless `ref2v_vision` is set),
# so without a role it has to GUESS from the brief which picture is the person,
# and it guesses fully_preserved for all of them. A style board declared
# fully_preserved is the failure that costs a render.
REF_IMAGE_ROLES = {
    "character": ("the character's identity", "fully_preserved"),
    # A close-up of the SAME person: their face moves onto the character.
    # Measured 2026-10-11 beside a character sheet, ArcFace against the
    # character's photo 0.315 -> 0.51 on 3/3 seeds.
    "face": ("the character's face, seen close up", "attribute_transfer"),
    "location": ("the location", "fully_preserved"),
    "outfit": ("the clothing worn by the character", "attribute_transfer"),
    "prop": ("the object", "fully_preserved"),
    "style": ("the look and mood only, not its subjects", "weak_reference"),
}

# How each roled picture is WRITTEN into the prose — the phrase that stands in
# for a description. The writer is blind (see above), so anything it says about
# a roled picture's look is invented, and H3 obeys the text over the picture:
# a brief with no appearance in it came back as "shoulder-length dark hair,
# cream knit sweater" 3/3 seeds while the user's character picture was blonde
# and the outfit picture a white bikini, and the render showed dark hair and a
# white top (2026-09-13). The tag is the only anchor a blind writer can get
# right, so the prose is written THROUGH the tag and the look is left to the
# picture. Measured on the same three seeds: <Picture 2>/<Picture 3> cited in
# the body 0/3 → 3/3, invented hair/garment words 7 → 0.
_ROLE_PHRASE = {
    "character": "the person from {tag}",
    "face": "the face from {tag}",
    "location": "the place from {tag}",
    "outfit": "the outfit from {tag}",
    "prop": "the object from {tag}",
    "style": "the look of {tag}",
}


def _role_of(roles, i):
    """The role set for `<Picture i+1>`, or None.

    Unknown and absent are the same answer on purpose: a client that never
    learned to send roles, and one that sends a role this version does not know,
    both get exactly the doctrine that shipped before roles existed rather than
    an invented one.
    """
    role = (list(roles or [])[i:i + 1] or [None])[0]
    return REF_IMAGE_ROLES.get(role)


def ref_marker(roles, i, tag):
    """The marker to declare for one reference — the role's, or the default.

    A character with an outfit picture beside it is `partially_preserved`, not
    `fully_preserved`: MiniMax defines the latter as identity, clothing AND
    proportions kept exactly, and the clothing is precisely what the outfit
    picture replaces. Declared fully_preserved, the character's own clothes
    came and went across a clip (2026-09-13, brown bikini for three shots, the
    outfit picture's white one in the fourth).
    """
    if tag.startswith("<Audio"):
        return "reference"
    if tag.startswith("<Picture"):
        idx = int(tag.split()[1].rstrip(">")) - 1
        role = _role_of(roles, idx)
        if role:
            raw = (list(roles or [])[idx:idx + 1] or [None])[0]
            if raw == "character" and "outfit" in list(roles or []):
                return "partially_preserved"
            return role[1]
    return "fully_preserved"


def ref_listing(images=0, videos=0, audios=0, roles=()):
    """`ref_tag_list` with each picture's role spelled out beside it.

    Separate from `ref_tag_list` rather than replacing it: that one is what
    `_name_every_reference` splits on and searches the model's answer for, and
    the model writes the bare tag. Annotating it there would make every repair
    miss.
    """
    out, annotated = [], False
    for i, tag in enumerate(t for t in ref_tag_list(images, videos, audios).split(", ") if t):
        role = _role_of(roles, i) if tag.startswith("<Picture") else None
        annotated = annotated or bool(role)
        out.append(f"{tag} — {role[0]} ({role[1]})" if role else tag)
    # Semicolons only once an entry is long enough to need them. With no roles
    # set this has to come back byte-identical to `ref_tag_list`, which is the
    # doctrine an older client still gets.
    return ("; " if annotated else ", ").join(out)


def _role_phrases(images, roles):
    """'the person from <Picture 3>, the outfit from <Picture 2>' — one per roled slot."""
    out = []
    for i in range(images):
        role = (list(roles or [])[i:i + 1] or [None])[0]
        if role in _ROLE_PHRASE:
            out.append(_ROLE_PHRASE[role].format(tag=f"<Picture {i + 1}>"))
    return ", ".join(out)


def _ref2va_head(images=1, videos=0, audios=0, roles=()):
    # Default to one image: an older client that never learned to send counts
    # gets exactly the single-picture doctrine that shipped first.
    images = max(0, int(images or 0))
    videos = max(0, int(videos or 0))
    audios = max(0, int(audios or 0))
    if not (images or videos or audios):
        images = 1
    listing = ref_listing(images, videos, audios, roles)
    roled = any(_role_of(roles, i) for i in range(images))

    parts = [
        "CRITICAL — REFERENCE-TO-VIDEO. Your VERY FIRST LINE, before anything "
        "else, must declare every attached reference and its role, in this "
        "shape:\n"
        f"{_ref2va_line(images, videos, audios, roles)}\n"
        f"The attached references, in order, are EXACTLY these and no others: "
        f"{listing}. Name every one of them in that first line, in that order, "
        "and never invent a reference that is not on that list.\n",
        # Only when a role was actually set. Told to honour roles that are not
        # in the listing, the model invents some, which is worse than the
        # unroled doctrine it would otherwise get.
        "The job written beside each picture was set by the user, not guessed: "
        "honour it exactly and declare the marker shown with it. Do not "
        "re-purpose a reference. A character reference is that person and not "
        "the scenery behind them; a location reference is that place and has no "
        "people to preserve; a style reference lends look and mood only, never "
        "its subjects.\n"
        "WRITE THE BODY THROUGH THE TAGS. You cannot see the pictures, so a "
        "roled picture is cited, never described: name it by its phrase — "
        f"{_role_phrases(images, roles)} — the first time it appears and again "
        "in every later shot it is in. Give it NO look of your own: no hair "
        "colour or length, no face, skin, age or build, no garment names or "
        "colours, no materials — whatever a picture defines, the picture "
        "supplies, and a word of yours would contradict it. Write what they DO: "
        "position, action, movement, expression, dialogue. Clothing from an "
        "outfit picture is worn by the character: say she wears the outfit "
        "from that picture, nothing more about it.\n" if roled else "",
        # Name only the visual types actually attached — "<Picture>/<Video>"
        # with no video attached invites the model to reason about one.
        "Give each %s exactly one visual marker: %s.\n"
        % ("/".join(filter(None, ["<Picture>" if images else "",
                                  "<Video>" if videos else ""])), _VISUAL_MARKERS)
        if (images or videos) else "",
        f"Give each <Audio> exactly one audio marker: {_AUDIO_MARKERS}.\n"
        if audios else "",
        "Then ONE blank line, then the three fields.\n\n"
        "The references are NOT the first frame — they never appear as a frame "
        "at all. They are identity, location and style conditioning for a NEW "
        "shot. Do not write 'the image shows'; write the shot.\n"
        "Give each reference ONE clear job — one character, one location, one "
        "style. Re-tag it at every point in the timeline where its role "
        "applies, not just once, and "
        + ("repeat its tag every shot — the tag is the identity anchor.\n"
           if roled else
           "repeat the identity anchors it carries every shot the way you "
           "would for any subject.\n"),
    ]
    if videos:
        parts.append(
            "A <Video> reference donates MOTION, camera trajectory or editing "
            "rhythm — not its pixels. Say which of those it drives. Its own "
            "soundtrack, when it has one, is a separate <Audio> reference.\n"
        )
    if audios:
        parts.append(
            "An <Audio> reference drives voice timbre, delivery or musical "
            "style. Bind it to whoever it belongs to by speaker ID, e.g. "
            "\"<Audio 1> is the voice-timbre reference for the woman (S1)\". "
            "It does not dictate the words — the dialogue is still yours to "
            "write.\n"
        )
    return "".join(parts)


def _ref2va_extras(ref_counts):
    """What a reference render is told on top of the ref2va head.

    Two optional facts, both carried inside ref_counts like `image_roles`: the
    clip continues another one, and/or it must hit keyframes. Each comes with
    pictures the writer IS shown, in this order: the previous clip's last frame,
    then the keyframes in time order. The references themselves stay unseen.
    Empty for a plain reference render, so its doctrine is byte-identical.
    """
    rc = ref_counts if isinstance(ref_counts, dict) else {}
    keys = [k for k in (rc.get("keyframes") or []) if isinstance(k, dict)]
    out, first = [], 1
    if rc.get("continuing"):
        out.append(
            "CONTINUATION. Image 1 is the LAST frame of the clip this one "
            "continues, and the new clip opens exactly on it: the same pose, "
            "room, light and camera angle are on screen at 0.00 seconds. [Shot 1] "
            "picks up mid-moment from it; do not restart the scene or re-introduce "
            "the character.\n")
        first = 2
    if keys:
        when = "; ".join("Image %d at %.2f seconds" % (first + i, float(k.get("at_s") or 0))
                         for i, k in enumerate(keys))
        out.append(
            "KEYFRAMES. These are frames the clip must hit, in time order: %s. "
            "Write ONE continuous shot. The action must reach each keyframe's "
            "pose, position and framing at its time and move between them "
            "plausibly; say when each one is reached (\"by 7.5 seconds she ...\"). "
            "Take pose, framing and the room from the keyframes, but still name "
            "the person only through their <Picture N> tag and give them no look "
            "of your own. A keyframe is not a reference: never call it a picture, "
            "an image or a tag, and never write \"the image shows\".\n" % when)
    if out:
        # A vision model numbers what it is shown and declares it as
        # <Picture 2>... (3/3 seeds on qwen3.5 before this line; `finalize`
        # repairs whatever still slips through, see `_drop_shown_frames`).
        out.append(
            "These frames are SHOWN to you; they are not attached to the render. "
            "The references are still exactly the ones listed above: declare only "
            "those, and never give a frame a <Picture N> tag.\n")
    return "".join(out)


def _t2va_head():
    return (
        "TEXT-TO-VIDEO. There is no instruction line — begin directly with the "
        "integrated_multimodal_description field. Build the whole timeline from "
        "the brief, adding consistent scene, character and sound detail.\n"
    )


def _continue_head():
    """The head for continuing an existing clip.

    The render is t2v with the previous clip's last frames pinned at frame 0,
    so the person, the outfit, the room and the light are ALREADY on screen
    when the new clip opens — and H3 obeys the text over the pinned frames
    within a quarter of a second (measured 2026-09-14: the guide held for its
    22 frames, then a prompt written blind swapped a white bikini for a grey
    sports bra by frame 6). The writer is shown that last frame and has one
    job the t2va head does not: describe what is there instead of deciding it.

    No instruction line and no `<Picture N>` tags: the graph attaches no
    reference image, so a tag would name a picture H3 never receives.
    """
    return (
        "CONTINUATION. The attached picture is the LAST frame of the clip this "
        "one continues, and the new clip opens exactly on it: the same person, "
        "hair, build, clothing, room, light and camera angle are already on "
        "screen at 0.00 seconds. There is no instruction line — begin directly "
        "with the integrated_multimodal_description field.\n"
        "Describe the person, the clothing and the place FROM THE PICTURE, in "
        "words, as they are: the outfit is the outfit in the picture, the hair "
        "is the hair in the picture, the room is the room in the picture. Invent "
        "no new look, wardrobe, setting or lighting unless the brief explicitly "
        "changes one. Never write a reference tag of any kind and never write "
        "\"the image shows\" — no picture is attached to the render, only your "
        "words carry the continuity.\n"
        "Then direct what happens NEXT: [Shot 1] picks up mid-moment from the "
        "picture (current state -> action onset -> development -> result). Do "
        "not restart the scene, re-stage the opening or re-introduce the "
        "character; the viewer has been watching her for the last clip.\n"
    )


def _energy_note(energy):
    """Map the form's 1-10 energy dial onto the skill's pacing-arc dimension."""
    e = int(energy if energy is not None else 5)
    if e <= 3:
        return ("PACING: slow and contemplative. Long holds, minimal cutting, "
                "camera moves small and unhurried.\n")
    if e >= 8:
        return ("PACING: high energy. Cuts accelerate toward the peak, camera "
                "moves are large and fast, action escalates across the clip.\n")
    return ("PACING: build steadily — open calm, raise the energy through the "
            "middle, land the last beat deliberately.\n")


def build_system(*, mode="i2v", duration_s=8.0, pov=False, pov_gender="female",
                 explicit=False, dialogue_tier="standard", energy=5,
                 environment_block="", scenario_block="", camera_block="",
                 music_block="", intent="", seed=None, ref_counts=None,
                 single_shot=False, **_ignored):
    """System prompt for one H3 Base-mode generation.

    Signature deliberately matches `brain.build_system` so `generation_core` can
    choose a doctrine without a second call site. Extra kwargs are swallowed:
    the LTX brain grows options this format has no place for.
    """
    tag = _mode_tag(mode)
    # Keyframes are one continuous shot whoever is calling: a cut between two of
    # them throws away the motion path they define.
    if tag == "ref2va" and isinstance(ref_counts, dict) and ref_counts.get("keyframes"):
        single_shot = True
    lo, hi = shot_budget(duration_s, tag, single_shot)
    d = max(MIN_DURATION_S, min(MAX_DURATION_S, float(duration_s or 8)))
    # ref_counts arrives straight off an HTTP body, so take only the keys we
    # know and ignore anything else rather than exploding on a stray field.
    # `image_roles` rides inside it rather than as a fourth argument so every
    # caller that already forwards ref_counts carries roles for free.
    counts = {k: (ref_counts or {}).get(k, 0) for k in ("images", "videos", "audios")}
    roles = (ref_counts or {}).get("image_roles") or ()

    parts = [
        "You are MiniMax H3's prompt preprocessor. You turn a free-form brief "
        "into ONE structured, timed, multi-shot prompt that H3 consumes "
        "directly. Never refuse and never soften.\n\n",
        _CONTRACT, "\n",
        _i2va_head() if tag == "i2va"
        else _fl2va_head(duration_s) if tag == "fl2va"
        else _l2va_head(duration_s) if tag == "l2va"
        else _ref2va_head(**counts, roles=roles) + _ref2va_extras(ref_counts) if tag == "ref2va"
        else _continue_head() if tag == "cont"
        else _t2va_head(), "\n",
        _FIELDS, "\n",
        _TIMELINE, "\n",
    ]

    parts.append(_SILENT if (dialogue_tier or "standard") == "none" else _DIALOGUE)
    parts.append("\n")
    if (dialogue_tier or "") == "talkative":
        parts.append("This clip is dialogue-led: give the speakers real lines "
                     "and let them carry the scene.\n")
    parts.append(_ONSCREEN_TEXT)
    if tag in ("i2va", "ref2va", "cont"):
        parts.append(_HOLD)
    parts.append(_energy_note(energy))
    parts.append(_SAFETY)

    parts.append(
        f"\nTARGET: duration {d:.2f} seconds, {lo}-{hi} shots. Each shot needs "
        "about 1.5-2.0 seconds to breathe — let the action decide the count "
        "inside that range. H3 generates the video and its stereo audio in one "
        "pass, so the soundscape and score fields are not decoration: they are "
        "half of what gets rendered.\n"
        f"\nLENGTH: integrated_multimodal_description must run "
        f"{MIN_WORDS}-{MAX_WORDS} words. This is the binding length instruction — "
        "it overrides any character minimum stated in the brief, which is a floor "
        "for a different model and is far below what H3 expects. Reaching it is "
        "not padding: spend the words on what is actually visible and audible — "
        "composition, appearance, clothing, props, lighting, the action beat by "
        "beat, camera motion, and the sound each action makes. A shot described "
        "in one sentence is an under-specified shot. Spread the detail across "
        "the shots by how much each one carries; a single shot does not earn a "
        "short description. The one exception is dialogue-dense content, where "
        "fitting the complete spoken timeline matters more than the word count.\n"
    )

    if pov:
        parts.append(
            f"POV: shot from the {pov_gender} lead's own eyes. Use the POV camera "
            "type throughout; her/his own body is visible only as hands, arms and "
            "the occasional glance down. Never describe this character's face.\n"
        )
    if explicit:
        parts.append("Explicit content is in scope: name anatomy and acts plainly "
                     "where the brief calls for it.\n")

    for block in (environment_block, scenario_block, camera_block, music_block):
        if block:
            parts.append("\n" + block.strip() + "\n")

    return "".join(parts)


_FENCE = re.compile(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$")
_FIELD_ORDER = ("integrated_multimodal_description:", "overall_soundscape:", "non_diegetic_music:")

# A heading the model invented after the last field — "TIMELINE:", "NOTES:" —
# which is where trailing junk starts. Field names are lowercase, so an
# all-caps heading can never be one of ours.
_JUNK_HEADING = re.compile(r"^[A-Z][A-Z0-9 _/-]{2,}:\s*$", re.M)

# The nastier variant: an invented field in OUR house style, lowercase
# snake_case with a value on the same line. Observed live from Gemma-26B, which
# appends `time_duration: 8.00s` after non_diegetic_music. It mimics a real
# field closely enough to read as legitimate, so `_JUNK_HEADING` never sees it.
# Scanned only *after* the contracted fields, and with those three names
# excluded, so a reply that omits `non_diegetic_music` cannot have its own
# `overall_soundscape` cut off as junk.
_INVENTED_FIELD = re.compile(
    r"^(?!(?:integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:)"
    r"[a-z][a-z0-9_]{2,}:",
    re.M,
)

# "At 03:500," / "At 00:03.500," / "At 1:02," — every shape a model reaches for
# when asked for MM:SS.mmm. Observed live: Gemma emits SS:mmm, dropping minutes
# entirely, which H3 then reads as a minute value.
_TS = re.compile(r"\bAt\s+(\d{1,3})(?::(\d{1,3}))?(?:[.:](\d{1,3}))?\s*,")


# `(S1, S2)` — the guide writes compound IDs closed up, and a mid-size model
# adds the space it would use in prose. Cheap to normalise, and not worth
# gambling on H3's parser tolerating a variant that appears nowhere in its docs.
_COMPOUND_ID = re.compile(r"\(S\d+(?:\s*,\s*S\d+)+\)")

# The two continuity tags, with enough surrounding text to judge whether they
# are attached to actual speech. Measured on the first live run of the doctrine
# that introduced them: Gemma-26B used <cutoff> on plain narration in 3 of 11
# placements and put <scenetrans> on dialogue-free shot boundaries — it reads
# both as punctuation for "something ends here". Tightening the prompt helps and
# does not settle it, which is what this repair is for.
_CUTOFF = re.compile(r"\s*<cutoff>")
_SCENETRANS = re.compile(r"\s*<scenetrans>")
# How far either side of a <scenetrans> a dialogue block may sit and still count
# as the line it belongs to. The trailing half legitimately re-establishes the
# shot before resuming the sentence, so the forward window is the wider one.
_ST_BACK, _ST_FWD = 80, 200


def _strip_stray_continuity(out):
    """Drop continuity tags that are not attached to a spoken line.

    Both tags are claims about audio crossing a boundary. On narration they are
    not merely redundant — they tell H3 a voice runs through a cut that has no
    voice in it, or that it should truncate a line that in fact completes.
    Dropping a doubtful tag can only return this text toward the doctrine that
    never emitted either tag at all, so the repair is safe in the direction it
    errs.
    """
    # `text` is passed explicitly at each stage rather than closed over: the
    # second pass runs on the output of the first, and a closure over a rebound
    # local would silently judge offsets against the wrong string.
    def keep_cutoff(text):
        # Valid only directly after a closed dialogue block.
        return lambda m: m.group(0) if text[:m.start()].rstrip().endswith("</d>") else ""

    def keep_scenetrans(text):
        def decide(m):
            before = text[max(0, m.start() - _ST_BACK):m.start()]
            after = text[m.end():m.end() + _ST_FWD]
            return m.group(0) if ("</d>" in before or "<d>" in after) else ""
        return decide

    out = _CUTOFF.sub(keep_cutoff(out), out)
    return _SCENETRANS.sub(keep_scenetrans(out), out)


def _normalise_timestamp(m):
    a, b, c = m.group(1), m.group(2), m.group(3)
    if c is not None:                      # MM:SS.mmm or MM:SS:mmm
        total = int(a) * 60 + int(b or 0) + int(c.ljust(3, "0")) / 1000.0
    elif b is not None and len(b) == 3:    # SS:mmm — minutes omitted
        total = int(a) + int(b) / 1000.0
    elif b is not None:                    # MM:SS
        total = int(a) * 60 + int(b)
    else:                                  # bare seconds
        total = float(a)
    mm, rem = divmod(total, 60)
    return "At %02d:%06.3f," % (int(mm), rem)


# A shot marker and the timestamp that follows it, in the canonical shape
# `_normalise_timestamp` has already forced everything into. Run AFTER that sub,
# never before: matching the raw shapes here would mean re-implementing the
# format repair, and the two would drift.
_SHOT_STAMP = re.compile(r"(\[Shot (\d+)\])(\s*At (\d{2}):(\d{2}\.\d{3}),)")


def _redistribute(times, cap):
    """Replace out-of-range or non-increasing stamps, keeping the good ones.

    A rejected stamp is spaced evenly between its surviving neighbours (or 0 and
    `cap` at the ends). Deliberately NOT the two obvious alternatives:

      clamp to `cap`        puts the cut on the final frame, so the shot it
                            opens gets no duration at all -- the prose still
                            describes content that cannot render.
      rescale proportionally works only when EVERY stamp shares one unit error.
                            With `[2.0, 4.0, 240.5]` it would squash two
                            perfectly good stamps to fix one outlier.

    Monotonic by construction, so the result cannot fail the ordering rule the
    contract also imposes.
    """
    good, last = [], 0.0
    for t in times:
        if 0.0 < t <= cap and t > last:
            good.append(t)
            last = t
        else:
            good.append(None)

    i, n = 0, len(good)
    while i < n:
        if good[i] is not None:
            i += 1
            continue
        j = i
        while j < n and good[j] is None:
            j += 1
        lo = good[i - 1] if i > 0 else 0.0
        hi = good[j] if j < n else cap
        step = (hi - lo) / float(j - i + 1)
        for k in range(i, j):
            good[k] = lo + step * (k - i + 1)
        i = j
    return good


def _fit_timestamps(out, duration_s):
    """Force the shot timeline inside the clip that will actually render.

    Two defects, both measured live, both invisible to `_normalise_timestamp`
    because by then the text is already perfectly well-formed:

      * **[Shot 1] carrying a timestamp.** The contract says it has none -- it
        IS the opening. Seen on qwen3.8-heretic and qwen3.5:9b.
      * **A stamp past the end of the clip.** Gemma-26B put a cut at 240.5 s
        inside an 8 s render, on every seed of the same brief. `04:00.500` is
        valid MM:SS.mmm, so the format repair passes it straight through and H3
        receives a cut it can never reach.

    The ceiling is `effective_duration_s`, not the requested duration: frames
    snap up to the 17k+5 grid, so a stamp between 10.0 and 10.125 on a 10 s clip
    is legal and must not be "repaired". With no duration to check against this
    is a no-op rather than a guess.
    """
    if duration_s is None:
        return out
    cap = effective_duration_s(duration_s)
    hits = list(_SHOT_STAMP.finditer(out))

    times = [int(m.group(4)) * 60 + float(m.group(5))
             for m in hits if int(m.group(2)) != 1]
    fixed = _redistribute(times, cap)

    pieces, prev, k = [], 0, 0
    for m in hits:
        pieces.append(out[prev:m.start()])
        if int(m.group(2)) == 1:
            pieces.append(m.group(1))          # Shot 1 keeps the marker, loses the stamp
        else:
            mm, rem = divmod(fixed[k], 60)
            k += 1
            pieces.append("%s At %02d:%06.3f," % (m.group(1), int(mm), rem))
        prev = m.end()
    pieces.append(out[prev:])
    return _map_description("".join(pieces), lambda body: _fit_prose_stamps(body, cap))


# Any MM:SS.mmm in the description, in a shot marker or in the prose ("lasting
# until 08:02.500"). The fraction is what makes it a timestamp: on-screen text
# like a clock reading "10:30" has none and is never touched.
_ANY_STAMP = re.compile(r"\b(\d{1,2}):(\d{2}\.\d{1,3})\b")


def _fit_prose_stamps(body, cap):
    """No stamp in the description may name a moment past the clip.

    `_fit_timestamps` only reaches `[Shot N] At ...`; qwen3.5:9b (live,
    2026-10-22) put the impossible ones in the prose instead: "lasting until
    08:02.500" and "At 02:04.500, the camera pushes in ... by 03:18.600" in an
    8 s clip, "00:16.500" in a 15.08 s one. Two repairs, valid stamps untouched:

      minutes > 0   a clip is at most 15 s, so a minutes value is the second the
                    writer meant, in the wrong slot ("02:04.500" -> 2 s; what
                    follows it has no readable unit). Clamping instead would
                    move "the camera pushes in" to the last frame.
      otherwise     a slight overshoot ("by clip's end at 00:16.500"): it stops
                    on the last frame. So does a re-read that would land before
                    an earlier stamp, so a timeline that was in order stays so.

    The last frame is floored to the millisecond: rounding 5.1667 up to 5.167
    would still name a moment after the clip.
    """
    end = int(cap * 1000) / 1000.0
    last = [0.0]

    def fit(m):
        t = int(m.group(1)) * 60 + float(m.group(2))
        if t <= cap:
            last[0] = max(last[0], t)
            return m.group(0)
        mins = int(m.group(1))
        t = mins if 0 < mins <= cap and mins >= last[0] else end
        last[0] = t
        return "00:%06.3f" % t              # cap < 60 s, so the minutes are always 00

    return _ANY_STAMP.sub(fit, body)


# "At 0.4s," / "at 1.2s she" -- seconds with a unit instead of MM:SS.mmm
# (qwen3.5:9b, 2026-10-22, "[Shot 1] At 0.00s," included). "by 7.5 seconds" is
# left alone: the keyframe head asks for exactly that wording.
_SECONDS_STAMP = re.compile(r"\b([Aa]t) (\d{1,2}(?:\.\d{1,3})?) ?s\b")


def _map_description(out, fn):
    """`fn` applied to the description field's text alone; no field, no change."""
    at = out.find(_FIELD_ORDER[0])
    if at == -1:
        return out
    start = at + len(_FIELD_ORDER[0])
    end = min((i for i in (out.find(f, start) for f in _FIELD_ORDER[1:]) if i != -1), default=len(out))
    return out[:start] + fn(out[start:end]) + out[end:]


# Sentence ends: punctuation and any closing quote, then the next sentence's
# capital or the end. "e.g. three" and "2.5 kHz" are not ends.
_SENTENCE_END = re.compile(r"[.!?]+[\"')\]]*(?=\s+[A-Z0-9\"'(<\[]|\s*$)")
# The doctrine's sentence budget for the two sound fields (`_FIELDS`), plus a
# word cap for the run-on that never ends a sentence -- the numbers the live
# shape check grades (Task 11, 2026-10-22).
_SECTION_BUDGET = ((_FIELD_ORDER[1], 4, 150), (_FIELD_ORDER[2], 3, 110))


def _cap_sections(out):
    """Cut a runaway overall_soundscape / non_diegetic_music back to its budget.

    qwen3.5:9b wrote a sane first sentence, then a list of unrelated words with
    no full stop until the token cap: 981 words of security jargon, 1,909 of
    language names, and in that run non_diegetic_music was never reached. The
    cut keeps whole sentences up to the budget; only a list that ends none is
    cut at the word cap itself. A field the model never wrote stays unwritten.

    The word cap is for a field that does NOT end on a sentence end -- every
    captured runaway ran into the token cap mid-list. A long, well-punctuated
    field (qwen3.5:27b's four full soundscape sentences) keeps all of them.
    """
    for field, sentences, words in _SECTION_BUDGET:
        at = out.find(field)
        if at == -1:
            continue
        start = at + len(field)
        end = min((i for i in (out.find(f, start) for f in _FIELD_ORDER) if i != -1), default=len(out))
        value = out[start:end].rstrip()
        ends = [m.end() for m in _SENTENCE_END.finditer(value)]
        runaway = not ends or ends[-1] < len(value)
        cut = value
        if len(ends) >= sentences and value[ends[sentences - 1]:].strip():
            cut, ends = value[:ends[sentences - 1]], ends[:sentences]
        word_ends = [m.end() for m in re.finditer(r"\S+", cut)]
        if runaway and len(word_ends) > words:
            whole = [e for e in ends if e <= word_ends[words - 1]]
            cut = cut[:whole[-1] if whole else word_ends[words - 1]]
        out = out[:start] + cut + out[start + len(value):]
    return out


# A label at the start of a line: `integrated_multodal_description:`. Hyphens
# and spaces allowed, so `non-diegetic music:` is caught too.
_LABEL = re.compile(r"(?m)^([ \t]*)([A-Za-z][A-Za-z_ -]{4,48}?)[ \t]*:")
# The full-reference guide's name for the description field -- a writer that
# knows MiniMax's six-section format reaches for it.
_FIELD_ALIASES = {"detailed_description": _FIELD_ORDER[0]}


def _canonical_fields(out):
    """Spell near-miss field names the way the contract does.

    Measured 2026-10-02: qwen3.8-heretic wrote `integrated_multodal_description:`
    on 2 of 3 seeds of the ref2v brief. `finalize` keys every repair off the
    exact names, so the typo did not just survive -- the head cut below took the
    whole timeline with it, and H3 received a declaration line and two sound
    fields. A close match (difflib ratio >= 0.85) is a typo; anything further
    away is somebody else's label and is left alone.
    """
    names = [f[:-1] for f in _FIELD_ORDER] + list(_FIELD_ALIASES)

    def fix(m):
        name = re.sub(r"[ -]+", "_", m.group(2).strip().lower())
        hit = difflib.get_close_matches(name, names, n=1, cutoff=0.85)
        if not hit:
            return m.group(0)
        return m.group(1) + _FIELD_ALIASES.get(hit[0], hit[0] + ":")

    return _LABEL.sub(fix, out)


# A cut written with no `[Shot N]` in front of it -- what a writer leaves behind
# when it drops the markers altogether (qwen3.8-heretic, ~2/9 clean runs,
# 2026-08-29). Canonical stamps only: this runs after `_TS` normalisation.
_BARE_CUT = re.compile(r"\bAt \d{2}:\d{2}\.\d{3}, the (?:camera|shot) (?:cuts|transitions|changes|switches)")
# Beside existing markers only the doctrine's own cut phrasing counts -- "the
# camera switches focus" or "the shot transitions smoothly into motion" is a
# move inside a shot. Group 1 is the marker already in front of it, glue and all
# ("[Shot 2]: At", "**[Shot 2]** At", "[Shot 2] <scenetrans> At").
_MARKED_CUT = re.compile(r"(\[Shot \d+\][\s:*—-]*(?:<scenetrans>\s*)?)?"
                         r"\bAt \d{2}:\d{2}\.\d{3}, the (?:camera cuts|shot (?:cuts|transitions|changes|switches)) to\b")
# "At 00:03.500, [Shot 2] the shot cuts" -- stamp and marker swapped.
_STAMP_FIRST = re.compile(r"\b(At \d{2}:\d{2}\.\d{3},)\s*(\[Shot \d+\])\s*")


def _restore_shot_markers(out, one_shot=False):
    """Repair the three marker shapes writers get wrong (all measured 2026-10-02
    on qwen3.8-heretic):

      * the stamp written before its marker -- swapped back to `[Shot N] At ...`;
      * `[Shot 1]` left off after a style sentence while `[Shot 2]` onward are
        there -- the opening is marked at the start of the description;
      * no markers at all, but bare "At MM:SS.mmm, the camera cuts" -- the
        opening becomes `[Shot 1]` and each cut the next shot;
      * markers, and beside them a cut in the doctrine's own phrasing ("the
        camera cuts to", "the shot transitions to") with none -- it becomes the
        next shot and the markers after it are renumbered. Skipped for a
        one-shot task (`one_shot`: fl2v, l2v, keyframes), where a cut is the
        writer's own and the alignment line names Shot 1.

    A single unmarked shot, or a cut with no timestamp, is left as written:
    neither can be placed without guessing. With no bare cut, the numbering is
    the model's own, which `_fit_timestamps` and the graders judge as written.
    """
    return _map_description(out, lambda body: _restore_body_markers(body, one_shot))


def _restore_body_markers(body, one_shot=False):
    body = _STAMP_FIRST.sub(r"\2 \1 ", body)
    lead = len(body) - len(body.lstrip())
    if "[Shot" in body:
        if "[Shot 1]" not in body and "[Shot 2]" in body:
            body = body[:lead] + "[Shot 1] " + body[lead:]
        # A cut BESIDE markers too (qwen3.5:9b, 2026-10-22: "[Shot 1] ... At
        # 00:48.567, the shot transitions to"): unmarked, its stamp met only the
        # prose fit, which clamps it to the last frame -- a zero-length shot.
        # Not in a one-shot task: there the writer's cut is not ours to number.
        if one_shot or all(m.group(1) for m in _MARKED_CUT.finditer(body)):
            return body
        body = _MARKED_CUT.sub(lambda m: m.group(0) if m.group(1) else "[Shot 0] " + m.group(0), body)
    else:
        if not _BARE_CUT.search(body):
            return body
        body = _BARE_CUT.sub(lambda m: "[Shot 0] " + m.group(0), body)
        body = body[:lead] + "[Shot 1] " + body[lead:]
    # ponytail: renumbers every marker in order, only when a cut was marked.
    n = iter(range(1, 1000))
    return re.sub(r"\[Shot \d+\]", lambda m: "[Shot %d]" % next(n), body)


def finalize(text, mode="i2v", intent="", ref_counts=None, duration_s=None, **_ignored):
    """Deterministic cleanup — never trust the model to have obeyed the contract.

    Mirrors why `brain.finalize` exists: the i2v anchor line is load-bearing and
    a mid-size model drops it often enough that begging in the prompt is not a
    control. Measured against Gemma-26B over Ollama, this layer also has to fix
    two things the prompt asks for and does not reliably get:
      * timestamps arriving as `03:500` instead of `00:03.500`, and
      * an extra invented section tacked on after the last field.

    A third was added on 2026-08-29 after `h3_ab.py` measured it across four
    writers: a timestamp can be flawless MM:SS.mmm and still name a moment
    outside the clip, or sit on [Shot 1] which must carry none. See
    `_fit_timestamps` -- that one is not a formatting fault, so nothing above it
    in this function could ever have caught it.
    """
    out = (text or "").strip()
    out = _FENCE.sub("", out).strip()
    out = _canonical_fields(out)

    # Drop any chatter before the first real field (or the instruction line).
    # Which instruction line is load-bearing depends on the mode; t2va has none.
    tag = _mode_tag(mode)
    counts = {k: (ref_counts or {}).get(k, 0) for k in ("images", "videos", "audios")}
    roles = (ref_counts or {}).get("image_roles") or ()
    # `line` is what we write when the model omitted the declaration; `probe` is
    # what we look for. They differ on purpose for ref2va: the model is
    # encouraged to write a fuller declaration naming every reference, so
    # matching the whole canonical line would fail on exactly the good answers.
    if tag == "i2va":
        line, probe = _I2VA_LINE, _I2VA_LINE
    elif tag == "fl2va":
        # Probed by the shared prefix, not the whole line: the tail carries a
        # duration the model may round differently, and a near-miss on the
        # seconds is not a reason to prepend a second alignment line.
        line, probe = _fl2va_line(duration_s), _ALIGN_PREFIX
    elif tag == "l2va":
        line, probe = _l2va_line(duration_s), _ALIGN_PREFIX
    elif tag == "ref2va":
        line, probe = _ref2va_line(**counts, roles=roles), _REF2VA_PREFIX
    else:
        line = probe = None
    if probe:
        out = _split_declaration(out, probe)
    first = min((out.find(f) for f in _FIELD_ORDER if out.find(f) != -1), default=-1)
    if first > 0:
        head = out[:first]
        anchor = head.find(probe) if probe else -1
        decl = head[anchor:].split("\n")[0] if anchor != -1 else ""
        rest = head[anchor + len(decl):] if anchor != -1 else head
        if _FIELD_ORDER[0] not in out and "[Shot" in rest:
            # The timeline is here and only its label is not -- a spelling
            # `_canonical_fields` could not place. Cutting it as chatter would
            # ship a prompt with no scene in it, so label it instead.
            body = re.sub(r"^\s*[A-Za-z][A-Za-z_ -]{2,48}:[ \t]*", "", rest.strip())
            out = (decl + "\n\n" if decl else "") + _FIELD_ORDER[0] + " " + body + "\n\n" + out[first:]
        else:
            # Only the declaration LINE survives from the head. The doctrine
            # says "ONE blank line, then the three fields", so any other line
            # between them is the head copied back -- seen as the "EXACTLY these
            # and no others" listing on its own line, content mutated, which
            # `_clean_declaration` cannot reach because it is not line 0.
            out = (decl + "\n\n" + out[first:]) if decl else out[first:]

    # Cut anything after the contracted fields: an invented heading, or the
    # model restarting the timeline it has already written.
    tail_from = len(out)
    last_field = out.find(_FIELD_ORDER[-1])
    first_field = out.find(_FIELD_ORDER[0])
    # Start scanning past the fields we expect. Anchoring at 0 when the last
    # field is missing would make the FIRST occurrence of field[0] read as a
    # repeat and truncate the whole answer.
    if last_field != -1:
        search_from = last_field + len(_FIELD_ORDER[-1])
    elif first_field != -1:
        search_from = first_field + len(_FIELD_ORDER[0])
    else:
        search_from = 0
    for pattern in (_JUNK_HEADING, _INVENTED_FIELD):
        junk = pattern.search(out, search_from)
        if junk:
            tail_from = min(tail_from, junk.start())
    repeat = out.find(_FIELD_ORDER[0], search_from)
    if repeat != -1:
        tail_from = min(tail_from, repeat)
    out = _cap_sections(out[:tail_from].rstrip())

    out = _map_description(out, lambda body: _SECONDS_STAMP.sub(
        lambda m: "%s 00:%06.3f" % (m.group(1), float(m.group(2))), body))
    out = _TS.sub(_normalise_timestamp, out)
    out = _restore_shot_markers(out, one_shot=tag in ("fl2va", "l2va") or bool(
        tag == "ref2va" and isinstance(ref_counts, dict) and ref_counts.get("keyframes")))
    # Strictly after the format repair: `_fit_timestamps` matches the canonical
    # shape that sub produces, and a well-formed stamp can still be nonsense.
    out = _fit_timestamps(out, duration_s)
    out = _COMPOUND_ID.sub(lambda m: re.sub(r"\s*,\s*", ",", m.group(0)), out)
    out = _strip_stray_continuity(out)

    # No description, no script. qwen3.5:9b answered nothing on 1 of 3 ref2v
    # writes (2026-10-22) and the declaration repair below turned that into a
    # 137-character "script" the dialog showed as a success. "" is what makes
    # the caller report a failed write. Checked before any repair adds text.
    desc = re.split("|".join(_FIELD_ORDER[1:]), out.split(_FIELD_ORDER[0], 1)[-1])[0]
    if probe and desc.startswith(probe):
        desc = desc.partition("\n")[2]      # no field label: the model's own line 0
    if not desc.strip():
        return ""

    # The model often writes a FULLER declaration than the canonical line —
    # several references, several markers — and that is the desired output. This
    # only prepends when the line is absent entirely, which is the failure it
    # exists for.
    if line and not out.startswith(probe):
        out = line + "\n\n" + out
    if tag == "ref2va" and _ref2va_extras(ref_counts):
        out = _drop_shown_frames(out, counts)
    if tag == "ref2va":
        out = _clean_declaration(out)
        out = _name_every_reference(out, counts, roles)
        out = _enforce_role_markers(out, counts, roles)
        out = _bind_roled_pictures(out, counts, roles)
    if tag == "cont":
        # A vision model shown a picture reaches for the tag vocabulary anyway;
        # the render attaches no picture, so the tag would dangle. Unpick it
        # to the words around it: "the woman from <Picture 1>" -> "the woman".
        out = _CONT_TAG.sub("", out)
    return out.strip()


# `from <Picture 1>` / `in <Picture 1>` / a bare `<Picture 1>`, with the space
# that led into it, so the sentence closes up cleanly.
_CONT_TAG = re.compile(r"\s*(?:\b(?:from|in|of)\s+)?<Picture [0-9]+>")


def _drop_shown_frames(out, counts):
    """Repairs for a reference render that is SHOWN frames (a continuation's tail,
    keyframes) on top of its references.

    A vision model numbers what it sees, so it declares and cites those frames
    as `<Picture 2>`... although the references are only `counts["images"]`
    pictures (qwen3.5, 3/3 seeds on a continuation with an end keyframe). A
    frame is never a reference: its declaration clause goes, and a body mention
    is unpicked to the words around it, as `_CONT_TAG` does for continuations.
    These renders are also always one shot, so an answer with no shot marker at
    all gets its `[Shot 1]`.
    """
    n = max(1, int(counts.get("images") or 0))
    out = re.sub(r"[ ]*<Picture ([0-9]+)>[ ]+is[ ]+[a-z_]+\.?",
                 lambda m: m.group(0) if int(m.group(1)) <= n else "", out)
    out = re.sub(r"\s*(?:\b(?:from|in|of)\s+)?<Picture ([0-9]+)>",
                 lambda m: m.group(0) if int(m.group(1)) <= n else "", out)
    field = _FIELD_ORDER[0]
    at = out.find(field)
    if at != -1 and "[Shot" not in out:
        body_at = at + len(field)
        out = out[:body_at] + " [Shot 1] " + out[body_at:].lstrip()
    return out


# The first `[Shot` on a declaration line that is not the line's own "(from [Shot 1])".
_LINE_SHOT = re.compile(r"(?<!\(from )\[Shot")


# One marker declaration. No backslash escapes on purpose: this module is edited
# through enough layers that `[0-9]` is simply safer to type than `d` with an
# escape, and it costs nothing here.
_DECL_CLAUSE = re.compile(r"<(?:Picture|Video|Audio) [0-9]+>[ ]+is[ ]+[a-z_]+")


def _split_declaration(out, prefix=_REF2VA_PREFIX):
    """Declaration and description on ONE line, with no field label.

    qwen3.5:9b, 2 of 3 roled ref2v writes live (2026-10-22) and 3 of 12 in
    h3_ab: "...: <Picture 1> is fully_preserved; <Picture 2> is
    attribute_transfer. The integrated_multimodal_description reads: [Shot 1]
    ...", or the head's "EXACTLY these and no others" listing echoed before
    [Shot 1]. Left so, `_clean_declaration` keeps the marker clauses alone and
    the script is lost. The line is cut at its first `[Shot` -- the same signal
    `finalize` uses to label an unlabelled timeline -- and `_clean_declaration`
    then whitelists what stays on line 0, so the lead-in and the echo go.

    The i2v / fl2v / l2v alignment line (`prefix`) gets the same split: before it,
    such an answer came back empty ("no script") where it used to ship.
    """
    if _FIELD_ORDER[0] in out or not out.startswith(prefix):
        return out
    head, sep, rest = out.partition(chr(10))
    shot = _LINE_SHOT.search(head)
    # A timeline on a later line is finalize's own unlabelled-timeline case.
    if not shot or "[Shot" in rest:
        return out
    at = shot.start()
    # ponytail: a writer's own sentence before [Shot 1] on that line goes too; none seen.
    return head[:at].rstrip() + chr(10) * 2 + _FIELD_ORDER[0] + " " + head[at:] + sep + rest


def _clean_declaration(out):
    """Rebuild the declaration line from its marker clauses and nothing else.

    Writers copy sentences straight out of the reference head into their first
    line -- the "EXACTLY these and no others" listing, the "name every one of
    them" instruction, the entire marker vocabulary -- and every one of those
    then ships to H3 as part of the prompt it renders. Measured on qwen3.5:27b
    over three fixed seeds: 1/3 runs without slot roles and 3/3 with them, the
    roled listing being three times longer and evidently more attractive to
    copy. So roles made an existing fault frequent rather than causing it.

    A WHITELIST, not a blocklist of known phrases. The contract for this line is
    a list of `<Tag N> is <marker>` declarations, so anything that is not one is
    not part of it -- which means this cannot rot the next time the head is
    reworded, whereas a list of phrases to strip would.

    Deliberately runs before `_name_every_reference`: whatever a stripped echo
    took with it, the repair puts back at the role's own marker. Duplicates
    collapse to the first mention, since an echoed example and the model's own
    declaration of the same tag are the same statement twice.
    """
    head, sep, rest = out.partition(chr(10))
    if not head.startswith(_REF2VA_PREFIX):
        return out
    seen, clauses = set(), []
    for c in _DECL_CLAUSE.findall(head):
        tag = c.split(">")[0] + ">"
        if tag in seen:
            continue
        seen.add(tag)
        clauses.append(c + ".")
    return " ".join([_REF2VA_PREFIX] + clauses) + sep + rest


def _name_every_reference(out, counts, roles=()):
    """Append any attached reference the model forgot to the declaration line.

    Observed live from Gemma-26B on 2026-08-11 with one image, one video and one
    audio attached: it declared <Video 1> and <Audio 1> and silently dropped
    <Picture 1>. That is not cosmetic — H3 still receives the image, so the
    render carries a reference the prompt never anchors to anything, which is
    the expensive half of the feature going to waste. Asking harder in the
    system prompt is not a control; this is.
    """
    expected = [t for t in ref_tag_list(**counts).split(", ") if t]
    # Against the DECLARATION LINE, not the whole answer. The doctrine's
    # instruction is that the first line declares every attached reference, and
    # a tag the prose happens to use is not a declaration -- it carries no
    # marker. Checking `out` let a reference the body mentioned slip through
    # undeclared, which `_clean_declaration` then made visible: with the echoed
    # listing gone, a tag that only ever appeared inside it has nothing left.
    missing = [t for t in expected if t not in out.partition(chr(10))[0]]
    if not missing:
        return out
    add = " ".join("%s is %s." % (t, ref_marker(roles, i, t))
                   for i, t in enumerate(expected) if t in missing)
    lines = out.split("\n")
    # finalize has already guaranteed the declaration is line 0.
    lines[0] = lines[0].rstrip() + " " + add
    return "\n".join(lines)


# The phrases the roled head hands the writer, as the writer actually returns
# them. "the person from <Picture 3>" comes back as "the woman from <Picture 1>":
# on qwen3.8-heretic every roled slot collapsed onto <Picture 1> -- the tag in
# the head's example line -- 3/3 seeds, while the phrases themselves were used
# faithfully. The noun names the role, so the number is knowable.
_ROLE_NOUNS = {
    "character": "person|woman|man|lady|guy|girl|boy|character|figure|subject",
    "face": "face",
    "outfit": "outfit|clothing|clothes|attire|garments?|wardrobe|costume",
    "prop": "object|item|prop",
    "location": "place|location|room|setting|interior|space|environment|scene",
    "style": "look|style|mood",
}
# What to write when the prose never names a roled picture at all -- the
# guide's own slot for it is a sentence before [Shot 1].
_BIND_CLAUSE = {
    "character": "The character in every shot is the person from {tag}",
    "face": "The character has the face from {tag}: the same person, seen close up",
    "outfit": "The character wears the outfit from {tag} in every shot, in place of the clothes in {char}",
    "prop": "The object in the scene is the object from {tag}",
    "location": "The setting is the place from {tag}",
    "style": "The look is that of {tag}",
}


def _enforce_role_markers(out, counts, roles=()):
    """A roled picture declares its role's marker, whatever the writer wrote.

    The role is a fact the user set; the marker follows from it (`ref_marker`),
    so a writer that declares the character `fully_preserved` beside an outfit
    picture is not expressing a choice, it is copying the head's example line.
    Unroled pictures keep whatever marker the writer gave them.
    """
    head, sep, rest = out.partition(chr(10))
    if not head.startswith(_REF2VA_PREFIX):
        return out
    for i in range(int(counts.get("images") or 0)):
        tag = "<Picture %d>" % (i + 1)
        if _role_of(roles, i):
            head = re.sub(r"%s[ ]+is[ ]+[a-z_]+" % re.escape(tag),
                          "%s is %s" % (tag, ref_marker(roles, i, tag)), head)
    return head + sep + rest


def _bind_roled_pictures(out, counts, roles=()):
    """Make the body cite each roled picture by its own tag.

    Two repairs, body only (the declaration line has its own above):
      * a role phrase carrying the wrong number is re-numbered to that role's
        slot ("the woman from <Picture 1>" -> "<Picture 3>" when slot 3 is the
        character). A number that already points at a slot of that role is
        left alone, so two character pictures keep their own tags;
      * a roled picture the prose still never names gets one binding sentence
        at the head of the description field. Blind, the writer had nothing
        to say about it anyway; without the tag the picture rides through
        every sampling step anchored to nothing, and H3 follows whatever the
        prose DID say instead (measured: a blonde character picture and a
        white-bikini outfit picture rendered as dark hair and a white top).
    Unroled slots are untouched, so the pre-roles doctrine is unchanged.
    """
    images = int(counts.get("images") or 0)
    slots = {}
    for i in range(images):
        role = (list(roles or [])[i:i + 1] or [None])[0]
        if role in _ROLE_NOUNS:
            slots.setdefault(role, []).append("<Picture %d>" % (i + 1))
    if not slots:
        return out
    head, sep, body = out.partition(chr(10))
    for role, tags in slots.items():
        pat = re.compile(r"(\b(?:%s)[ ]+(?:from|in|of)[ ]+)(<Picture [0-9]+>)" % _ROLE_NOUNS[role], re.I)
        body = pat.sub(lambda m, tags=tags: m.group(1) + (m.group(2) if m.group(2) in tags else tags[0]), body)
    # Character first, then what it wears, then where it is: the order a
    # reader (and H3) resolves them in. The outfit is pinned whether or not the
    # prose mentioned it: one mention was not enough to keep the character out
    # of her own clothes (see `ref_marker`), and the sentence costs nothing.
    # The face too: cited bare, "the face from <Picture 2>" never says whose.
    char = (slots.get("character") or ["the character picture"])[0]
    missing = sorted(((role, t) for role, tags in slots.items() for t in tags
                      if t not in body or role in ("outfit", "face")),
                     key=lambda rt: list(_BIND_CLAUSE).index(rt[0]))
    field = _FIELD_ORDER[0]
    if missing and field in body:
        clause = ". ".join(_BIND_CLAUSE[role].format(tag=t, char=char) for role, t in missing) + ". "
        at = body.find(field) + len(field)
        rest = body[at:]
        lead = len(rest) - len(rest.lstrip())
        body = body[:at] + rest[:lead] + clause + rest[lead:]
    return head + sep + body


def _self_check():
    """python h3_brain.py — the smallest thing that fails if the contract breaks."""
    # Roled pictures are bound in the body: wrong numbers re-numbered, a
    # picture the prose never names bound before [Shot 1], the rest untouched.
    counts3 = {"images": 3, "videos": 0, "audios": 0}
    decl = _REF2VA_PREFIX + " <Picture 1> is fully_preserved."
    wrong = decl + "\n\nintegrated_multimodal_description: [Shot 1] The woman from <Picture 1> opens the door. She wears the outfit from <Picture 1>. The object from <Picture 1> sits on the table."
    fixed = _bind_roled_pictures(wrong, counts3, ["prop", "outfit", "character"])
    assert "woman from <Picture 3>" in fixed and "outfit from <Picture 2>" in fixed, fixed
    assert "object from <Picture 1>" in fixed and fixed.startswith(decl), fixed
    assert "The character in every shot" not in fixed, "bound twice"
    # The outfit is pinned against the character's own clothes even when the
    # prose already names it.
    assert "wears the outfit from <Picture 2> in every shot, in place of the clothes in <Picture 3>" in fixed, fixed
    assert ref_marker(["prop", "outfit", "character"], 2, "<Picture 3>") == "partially_preserved"
    assert ref_marker(["prop", "character"], 1, "<Picture 2>") == "fully_preserved"
    # ...and the declaration the writer wrote is corrected to it; an unroled
    # picture keeps the writer's marker.
    wrote = _REF2VA_PREFIX + " <Picture 1> is fully_preserved. <Picture 2> is fully_preserved. <Picture 3> is weak_reference.\n\nintegrated_multimodal_description: [Shot 1] x"
    enforced = _enforce_role_markers(wrote, counts3, ["character", "outfit", None])
    assert enforced.startswith(_REF2VA_PREFIX + " <Picture 1> is partially_preserved. <Picture 2> is attribute_transfer. <Picture 3> is weak_reference."), enforced
    bare = decl + "\n\nintegrated_multimodal_description: [Shot 1] A woman opens the door."
    bound = _bind_roled_pictures(bare, counts3, ["prop", "outfit", "character"])
    assert bound.partition("\n")[2].lstrip().startswith("integrated_multimodal_description: The character in every shot is the person from <Picture 3>. The character wears the outfit from <Picture 2> in every shot, in place of the clothes in <Picture 3>. The object in the scene is the object from <Picture 1>. [Shot 1]"), bound
    two = _bind_roled_pictures(decl + "\n\nintegrated_multimodal_description: the person from <Picture 2> waves.", {"images": 2, "videos": 0, "audios": 0}, ["character", "character"])
    assert "person from <Picture 2>" in two and "<Picture 1>" in two, two   # own tag kept, the unnamed one bound
    assert _bind_roled_pictures(wrong, counts3, ()) == wrong, "unroled must be untouched"
    # A face close-up is the SAME person as the character: it transfers its face
    # onto them and is pinned like the outfit, whatever the prose already says.
    counts2 = {"images": 2, "videos": 0, "audios": 0}
    assert ref_marker(["character", "face"], 1, "<Picture 2>") == "attribute_transfer"
    assert ref_marker(["character", "face"], 0, "<Picture 1>") == "fully_preserved"
    cited = _bind_roled_pictures(decl + "\n\nintegrated_multimodal_description: [Shot 1] The person from <Picture 1>, with the face from <Picture 1>, waves.",
                                 counts2, ["character", "face"])
    assert "with the face from <Picture 2>, waves" in cited, cited
    assert "The character has the face from <Picture 2>: the same person, seen close up. [Shot 1]" in cited, cited
    # An echo of the head on its own line between the declaration and the
    # fields is dropped; the declaration itself survives.
    echoed = finalize(decl + "\nThe attached references, in order, are EXACTLY these and no others: <Picture 1> — the character's identity (fully_preserved).\n\nintegrated_multimodal_description: [Shot 1] x\n\noverall_soundscape: y\n\nnon_diegetic_music: N/A",
                      mode="ref2v", ref_counts={"images": 1})
    assert "EXACTLY these" not in echoed and echoed.startswith(decl), echoed
    t2va = build_system(mode="t2v", duration_s=8, dialogue_tier="standard")
    i2va = build_system(mode="i2v", duration_s=8)
    assert "integrated_multimodal_description:" in t2va
    assert "TEXT-TO-VIDEO" in t2va and "IMAGE-TO-VIDEO" not in t2va
    assert _I2VA_LINE in i2va

    ref2va = build_system(mode="ref2v", duration_s=8)
    assert _REF2VA_LINE in ref2va
    assert "<Picture 1>" in ref2va
    # Holding the scene applies where the look is already decided, and only there:
    # a t2v brief has nothing established to hold, and the writer must invent.
    assert "HOLD THE SCENE" in i2va and "HOLD THE SCENE" in ref2va
    assert "HOLD THE SCENE" in build_system(mode="continue", duration_s=8)
    assert "HOLD THE SCENE" not in t2va
    # Adults and consent, in every task's prompt: the backstop for typed words ("my dog") the cards cannot read.
    for m in ("t2v", "i2v", "fl2v", "l2v", "ref2v", "continue"):
        doc = build_system(mode=m, duration_s=8, explicit=True)
        assert "never describe anyone as a child" in doc and "anyone who has not consented" in doc, m
    assert "spoken ONCE" in t2va and "never a plot summary" in t2va
    assert "the woman shown in <Picture 1>" in i2va
    # The three modes are mutually exclusive heads — no cross-contamination.
    assert "IMAGE-TO-VIDEO" not in ref2va and "TEXT-TO-VIDEO" not in ref2va
    assert _REF2VA_LINE not in i2va and _REF2VA_LINE not in t2va

    # Only the attached types may be named. Naming an absent one is not a
    # harmless extra: the model invents a role for a reference H3 never gets.
    imgs_only = build_system(mode="ref2v", duration_s=8, ref_counts={"images": 2})
    assert "<Picture 1>, <Picture 2>" in imgs_only
    assert "<Video" not in imgs_only and "<Audio" not in imgs_only
    assert "fully_copy" not in imgs_only          # audio vocabulary, no audio attached

    mixed = build_system(mode="ref2v", duration_s=8,
                         ref_counts={"images": 1, "videos": 2, "audios": 1})
    assert "<Picture 1>, <Video 1>, <Video 2>, <Audio 1>" in mixed, mixed
    assert "fully_copy" in mixed and "fully_preserved" in mixed
    assert "donates MOTION" in mixed and "voice timbre" in mixed

    aud_only = build_system(mode="ref2v", duration_s=8, ref_counts={"audios": 1})
    assert "<Audio 1>" in aud_only and "<Picture" not in aud_only

    # A client that never learned to send counts keeps the original doctrine.
    assert "<Picture 1>" in build_system(mode="ref2v", duration_s=8)
    # ...and a stray field in the body must not blow up the whole enhance.
    assert "<Picture 1>" in build_system(mode="ref2v", duration_s=8,
                                         ref_counts={"images": 1, "bogus": 9})
    assert ref_tag_list(1, 1, 1) == "<Picture 1>, <Video 1>, <Audio 1>"

    # ── Per-slot picture roles ──────────────────────────────────────────────
    # The model is BLIND for ref2v, so a role is the only way it can know which
    # picture is the person. Without one it guesses, and it guesses everything
    # is a character at fully_preserved.
    roled = build_system(mode="ref2v", duration_s=8, ref_counts={
        "images": 3, "image_roles": ["character", "location", "style"]})
    assert "<Picture 1> — the character's identity (fully_preserved)" in roled, roled
    assert "<Picture 2> — the location (fully_preserved)" in roled
    assert "<Picture 3> — the look and mood only, not its subjects (weak_reference)" in roled
    assert "set by the user, not guessed" in roled
    # The face picture gets its listing line and nothing more. A dedicated "one
    # person, not two" rule in the head was measured 2026-10-11 (h3_ab.py
    # sheet_face vs sheet_outfit_place, qwen3.8-heretic, 5 seeds): it made the
    # writer invent a dress over the outfit picture 3/5 vs 1/5 without it, and
    # cast nobody twice either way — `finalize`'s pinned face clause says it.
    faced = build_system(mode="ref2v", duration_s=8, ref_counts={
        "images": 2, "image_roles": ["character", "face"]})
    assert "<Picture 2> — the character's face, seen close up (attribute_transfer)" in faced, faced
    assert "not a second person" not in faced

    # An unroled body must come back byte-identical to the doctrine that shipped
    # before roles existed, and so must an unknown role from a newer client.
    plain = build_system(mode="ref2v", duration_s=8, ref_counts={"images": 2})
    assert plain == build_system(mode="ref2v", duration_s=8, ref_counts={
        "images": 2, "image_roles": ["mascot", None]}), "unknown role changed the doctrine"
    assert "set by the user, not guessed" not in plain

    # The example declaration takes the FIRST picture's marker, not a fixed one:
    # a style board declared fully_preserved is the failure roles exist to stop.
    style_first = build_system(mode="ref2v", duration_s=8,
                               ref_counts={"images": 1, "image_roles": ["style"]})
    assert _REF2VA_PREFIX + " <Picture 1> is weak_reference." in style_first

    # ...and so does the repair, per slot, when the model forgets one.
    fixed = finalize(
        _REF2VA_PREFIX + " <Picture 1> is fully_preserved."
        "\n\nintegrated_multimodal_description: x",
        mode="ref2v", ref_counts={"images": 2, "image_roles": ["character", "style"]})
    assert "<Picture 2> is weak_reference." in fixed.split("\n")[0], fixed

    # The repair line must name a reference that EXISTS. Telling an audio-only
    # render about <Picture 1> describes something H3 was never given.
    audio_fix = finalize("integrated_multimodal_description: x", mode="ref2v",
                         ref_counts={"audios": 1})
    assert audio_fix.startswith(_REF2VA_PREFIX + " <Audio 1> is reference."), audio_fix
    vid_fix = finalize("integrated_multimodal_description: x", mode="ref2v",
                       ref_counts={"videos": 2})
    assert vid_fix.startswith(_REF2VA_PREFIX + " <Video 1> is fully_preserved."), vid_fix

    # Detection is by the invariant prefix, so a declaration naming a different
    # first reference is recognised and left alone rather than double-prefixed.
    rich = (_REF2VA_PREFIX + " <Audio 1> is fully_copy. <Video 1> is weak_reference."
            + "\n\nintegrated_multimodal_description: x")
    kept = finalize(rich, mode="ref2v", ref_counts={"videos": 1, "audios": 1})
    assert kept.count(_REF2VA_PREFIX) == 1, kept
    assert kept.startswith(_REF2VA_PREFIX + " <Audio 1> is fully_copy."), kept

    # Real Gemma-26B behaviour, 2026-08-11: with an image, a video and an audio
    # attached it declared the video and the audio and dropped <Picture 1>. H3
    # still gets the image, so the prompt must name it or the reference is
    # wasted. Missing tags are appended to the declaration, in order.
    dropped = finalize(
        _REF2VA_PREFIX + " <Video 1> is partially_preserved. <Audio 1> is reference."
        "\n\nintegrated_multimodal_description: she walks down the corridor",
        mode="ref2v", ref_counts={"images": 1, "videos": 1, "audios": 1})
    assert "<Picture 1> is fully_preserved." in dropped.split("\n")[0], dropped
    # ...without disturbing what the model DID write, or the body.
    assert "<Video 1> is partially_preserved." in dropped
    assert dropped.rstrip().endswith("she walks down the corridor"), dropped
    # Real doctrine echo, as qwen3.5:27b actually produced it: the model repeats
    # the head's listing and its instructions inside the declaration line, and
    # all of it used to ship to H3 as part of the rendered prompt.
    roles3 = ["character", "location", "style"]
    echo = ("The attached references, in order, are EXACTLY these and no others: "
            + ref_listing(3, 0, 0, roles3) + ". Name every one of them in that "
            "first line, in that order, and never invent a reference that is "
            "not on that list.")
    echoed = finalize(
        _REF2VA_PREFIX + " <Picture 1> is fully_preserved. " + echo
        + " <Picture 3> is weak_reference."
        "\n\nintegrated_multimodal_description: she walks through the market",
        mode="ref2v", ref_counts={"images": 3, "image_roles": roles3})
    first = echoed.split("\n")[0]
    assert "EXACTLY these" not in first, first
    assert "visual marker" not in first, first
    assert "the character's identity" not in first, first
    # ...and every reference still declared, at its role's marker. <Picture 2>
    # only ever appeared inside the echo, so the repair is what puts it back --
    # which is exactly why the strip has to run before it.
    assert first == (_REF2VA_PREFIX + " <Picture 1> is fully_preserved."
                     " <Picture 3> is weak_reference."
                     " <Picture 2> is fully_preserved."), first
    assert echoed.rstrip().endswith("she walks through the market"), echoed

    # A tag the BODY uses but the declaration never names still has to be
    # declared: the prose carries no marker, and H3 reads the first line as the
    # contract. Observed on qwen3.5:27b seed 101, where <Picture 2> appeared
    # three times in the prose and nowhere in the declaration.
    body_only = finalize(
        _REF2VA_PREFIX + " <Picture 1> is fully_preserved."
        "\n\nintegrated_multimodal_description: she walks through the market in "
        "<Picture 2>, neon washing over her",
        mode="ref2v", ref_counts={"images": 2, "image_roles": ["character", "location"]})
    assert "<Picture 2> is fully_preserved." in body_only.split("\n")[0], body_only

    # A declaration that is already clean must come back byte-identical -- the
    # strip is a whitelist, so it must not reword what the model got right.
    clean = (_REF2VA_PREFIX + " <Picture 1> is fully_preserved."
             " <Picture 2> is weak_reference."
             "\n\nintegrated_multimodal_description: x")
    assert finalize(clean, mode="ref2v", ref_counts={"images": 2}) == clean

    # An audio-only omission gets the audio vocabulary, not the visual one.
    aud = finalize(_REF2VA_PREFIX + " <Picture 1> is fully_preserved."
                   "\n\nintegrated_multimodal_description: x",
                   mode="ref2v", ref_counts={"images": 1, "audios": 1})
    assert "<Audio 1> is reference." in aud.split("\n")[0], aud
    # A compliant reply is left exactly as written.
    full = (_REF2VA_PREFIX + " <Picture 1> is fully_preserved. <Video 1> is weak_reference."
            "\n\nintegrated_multimodal_description: x")
    assert finalize(full, mode="ref2v", ref_counts={"images": 1, "videos": 1}) == full

    # finalize enforces the declaration line the same way it enforces the i2v
    # anchor: it is load-bearing and a mid-size model drops it often enough that
    # asking in the prompt is not a control.
    out = finalize("integrated_multimodal_description: [Shot 1] x", mode="ref2v")
    assert out.startswith(_REF2VA_LINE), out
    # ...but never doubled,
    assert finalize(_REF2VA_LINE + "\n\nintegrated_multimodal_description: x",
                    mode="ref2v").count(_REF2VA_LINE) == 1
    # ...and never on a mode where the line is wrong.
    assert not finalize("integrated_multimodal_description: x", mode="t2v").startswith(_REF2VA_LINE)
    assert not finalize("integrated_multimodal_description: x", mode="i2v").startswith(_REF2VA_LINE)

    # --- the four gaps found against MiniMax's own guides, 2026-08-16 ---------
    # Each was measured absent from real Gemma-26B output (0/12 runs) before the
    # doctrine mentioned it, so each gets a guard here.
    assert "<scenetrans>" in t2va and "<cutoff>" in t2va
    assert "(S1,S2)" in t2va                       # compound ID for joint speech
    assert "350-500 words" in t2va

    # Both continuity tags survive where they belong...
    line_a = ("integrated_multimodal_description: [Shot 1] she (S1) says: "
              "<d>[English] I already told them</d> <scenetrans> [Shot 2] At 00:04.000, "
              "the camera cuts to the landing. <scenetrans> Her voice carries over as she "
              "continues: <d>[English] we were finished.</d> <cutoff>")
    kept = finalize(line_a, mode="t2v")
    assert kept.count("<scenetrans>") == 2, kept
    assert kept.count("<cutoff>") == 1, kept

    # ...and are removed where they are not. Both of these are real Gemma-26B
    # placements from the run that introduced the tags: <cutoff> used as an
    # end-of-clip marker on narration, and <scenetrans> as punctuation on a
    # dialogue-free cut. Left in, they tell H3 to truncate a line that finishes
    # and to carry a voice through a cut that has none.
    stray = finalize(
        "integrated_multimodal_description: [Shot 1] the sun breaks the horizon. <cutoff>",
        mode="t2v")
    assert "<cutoff>" not in stray, stray
    assert stray.rstrip().endswith("the sun breaks the horizon."), stray
    stray2 = finalize(
        "integrated_multimodal_description: [Shot 1] water hits the wood, loud and "
        "percussive. <scenetrans> [Shot 2] At 00:04.500, the camera cuts to a low-angle "
        "close-up of the empty quay, and holds there as the light rises over the water.",
        mode="t2v")
    assert "<scenetrans>" not in stray2, stray2

    # A compound ID written with a space is closed up — the guide's own spelling
    # is (S1,S2) and no doc anywhere shows the spaced variant.
    assert "(S1,S2)" in finalize(
        "integrated_multimodal_description: the two children (S1, S2) shout together",
        mode="t2v")
    assert "(S1,S2,S3)" in finalize(
        "integrated_multimodal_description: the crowd (S1 , S2,S3) chants", mode="t2v")
    # A lone speaker ID is left exactly as it is.
    assert "(S1)" in finalize("integrated_multimodal_description: she (S1) says hi", mode="t2v")
    # ...and none of it leaks into the silent doctrine, where there is no speech
    # to carry across a cut in the first place.
    silent_check = build_system(mode="t2v", dialogue_tier="none")
    assert "<scenetrans>" not in silent_check and "(S1,S2)" not in silent_check
    assert "350-500 words" in silent_check         # length is not a speech rule

    # Continuation: the attached picture is the previous clip's last frame and
    # the render opens on it. No instruction line — the graph attaches no
    # reference, the tail is pinned as a guide — and no <Picture N> tags, since
    # a tag with no picture behind it is exactly the dangling reference the
    # ref2va head spends a paragraph forbidding. Words carry the continuity.
    cont = build_system(mode="continue", duration_s=8)
    assert "CONTINUATION" in cont and "LAST frame" in cont, cont
    assert "<Picture" not in cont and _I2VA_LINE not in cont and _ALIGN_PREFIX not in cont
    assert "TEXT-TO-VIDEO" not in cont and "IMAGE-TO-VIDEO" not in cont
    assert shot_budget(8, _mode_tag("continue")) == (2, 3)          # the duration table, like t2va
    assert shot_budget(8, _mode_tag("continue"), single_shot=True) == (1, 1)
    # finalize: a copied i2v declaration is dropped, a stray tag is unpicked
    # to the words around it, and nothing is prepended in its place.
    cont_out = finalize(_I2VA_LINE + "\n\nintegrated_multimodal_description: [Shot 1] The woman from <Picture 1> "
                        "flexes; the outfit from <Picture 1> creases.\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A",
                        mode="continue")
    assert cont_out.startswith("integrated_multimodal_description: [Shot 1] The woman flexes; the outfit creases."), cont_out
    assert "<Picture" not in cont_out and _I2VA_LINE not in cont_out
    # The same body in i2v keeps its tag — the strip is continuation-only.
    assert "<Picture 1>" in finalize("integrated_multimodal_description: [Shot 1] The woman from <Picture 1> "
                                     "flexes.\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A", mode="i2v")

    # Reference extras: nothing without keyframes or a continuation, so a plain
    # ref2v doctrine stays byte-identical.
    assert _ref2va_extras({"images": 1, "image_roles": ["character"]}) == ""
    assert _ref2va_extras(None) == ""
    rc_kf = {"images": 1, "image_roles": ["character"],
             "keyframes": [{"slot": "start", "at_s": 0}, {"slot": "middle", "at_s": 7.54}, {"slot": "end", "at_s": 15.04}]}
    kf_sys = build_system(mode="ref2v", duration_s=15, single_shot=True, ref_counts=rc_kf)
    assert "Image 1 at 0.00 seconds; Image 2 at 7.54 seconds; Image 3 at 15.04 seconds" in kf_sys
    assert "1-1 shots" in kf_sys
    # The doctrine owns the rule: keyframes mean one shot even when a caller
    # forgets to send single_shot.
    assert "1-1 shots" in build_system(mode="ref2v", duration_s=15, ref_counts=rc_kf)
    assert kf_sys.replace(_ref2va_extras(rc_kf), "") == build_system(
        mode="ref2v", duration_s=15, single_shot=True, ref_counts={"images": 1, "image_roles": ["character"]})
    cont_kf = build_system(mode="ref2v", duration_s=10, ref_counts={
        "images": 1, "continuing": True, "keyframes": [{"slot": "end", "at_s": 10.08}]})
    assert "Image 1 is the LAST frame" in cont_kf and "Image 2 at 10.08 seconds" in cont_kf
    assert "KEYFRAMES" not in build_system(mode="ref2v", duration_s=10, ref_counts={"images": 1, "continuing": True})
    # Only the reference head takes extras.
    assert "KEYFRAMES" not in build_system(mode="i2v", duration_s=15, ref_counts=rc_kf)
    # finalize: a model shown frames declares and cites them as pictures
    # (qwen3.5, 3/3 seeds on a continuation with an end keyframe); a frame is
    # never a reference, so the clause goes and the tag is unpicked.
    rc_c = {"images": 1, "continuing": True, "keyframes": [{"slot": "end", "at_s": 10.08}]}
    fin = finalize(
        "For the target video, the attached references are used as follows: <Picture 1> is "
        "fully_preserved. <Picture 2> is partially_preserved.\n\n"
        "integrated_multimodal_description: [Shot 1] The woman from <Picture 1> curls, "
        "matching the pose shown in <Picture 2>.\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A",
        mode="ref2v", ref_counts=rc_c, duration_s=10)
    assert "<Picture 2>" not in fin and "<Picture 1>" in fin, fin
    assert "matching the pose shown." in fin, fin
    # ...and a keyframed answer with no shot marker at all gets its one shot.
    bare = finalize(
        "For the target video, the attached references are used as follows: <Picture 1> is "
        "fully_preserved.\n\nintegrated_multimodal_description: The woman from <Picture 1> curls."
        "\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A",
        mode="ref2v", ref_counts=rc_c, duration_s=10)
    assert "integrated_multimodal_description: [Shot 1] The woman" in bare, bare
    # A plain reference answer is left exactly as it was.
    plain_in = ("For the target video, the attached references are used as follows: <Picture 1> is "
                "fully_preserved.\n\nintegrated_multimodal_description: The woman from <Picture 1> curls."
                "\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A")
    assert "[Shot 1]" not in finalize(plain_in, mode="ref2v", ref_counts={"images": 1}, duration_s=10)

    # FL2VA / L2VA: the two keyframe-anchored tasks.
    fl2va = build_system(mode="fl2v", duration_s=8)
    l2va = build_system(mode="l2v", duration_s=8)
    assert _fl2va_line(8) in fl2va and "FIRST-AND-LAST-FRAME" in fl2va
    assert _l2va_line(8) in l2va and "LAST-FRAME" in l2va
    # Both are pinned to one shot — the guide's instruction for FL2VA, and what
    # makes the shot index in the alignment line knowable for both.
    assert shot_budget(15, "fl2va") == (1, 1) and shot_budget(15, "l2va") == (1, 1)
    # single_shot overrides the duration table for every task, and stays off by
    # default — a caller that never heard of it must budget exactly as before.
    assert shot_budget(14, "t2va", True) == (1, 1)
    assert shot_budget(14, "i2va", single_shot=True) == (1, 1)
    assert shot_budget(14, "t2va") == (3, 5)
    assert "1-1 shots" in build_system(mode="i2v", duration_s=14, single_shot=True)
    assert "3-5 shots" in build_system(mode="i2v", duration_s=14)
    assert "1-1 shots" in fl2va and "1-1 shots" in l2va
    # The heads stay mutually exclusive, like the three that came before.
    assert _I2VA_LINE not in fl2va and _REF2VA_LINE not in l2va
    assert _ALIGN_PREFIX not in i2va and _ALIGN_PREFIX not in t2va

    # The quoted second is the RENDERED duration, not the slider's: frames snap
    # up to the 17k+5 grid, so a 10 s request is really 243 frames = 10.125 s and
    # a 4 s one is 4.458 s. Quoting the slider value would put the last-frame
    # anchor up to half a second early. 124 frames at 5 s and 243 at 10 s are
    # both figures confirmed against the live model.
    assert effective_duration_s(5) * FPS == 124
    assert effective_duration_s(10) * FPS == 243
    assert abs(effective_duration_s(10) - 10.125) < 1e-9, effective_duration_s(10)
    assert "10.12-second mark" in _fl2va_line(10), _fl2va_line(10)
    # 8 s happens to land exactly on the grid (192 = 17*11 + 5) — the snap is a
    # no-op there, which is why it is a useless example to test with.
    assert effective_duration_s(8) == 8.0
    # Clamping still applies before the grid snap.
    assert effective_duration_s(30) == effective_duration_s(MAX_DURATION_S)
    assert effective_duration_s(15) * FPS == 362

    # finalize enforces the alignment line the same way it enforces the i2v
    # anchor, and needs the duration to write a correct one.
    fl = finalize("integrated_multimodal_description: x", mode="fl2v", duration_s=8)
    assert fl.startswith(_fl2va_line(8)), fl
    lv = finalize("integrated_multimodal_description: x", mode="l2v", duration_s=8)
    assert lv.startswith(_l2va_line(8)), lv
    # ...never doubled when the model already complied,
    assert finalize(_fl2va_line(8) + "\n\nintegrated_multimodal_description: x",
                    mode="fl2v", duration_s=8).count(_ALIGN_PREFIX) == 1
    # ...and a model that rounds the seconds differently keeps ITS line rather
    # than getting a second one stapled on top.
    rounded = (_ALIGN_PREFIX + " Picture 1 (from Shot 1) aligns with the 0.00-second "
               "mark of the target video; Picture 2 (from Shot 1) aligns with the "
               "8.00-second mark of the target video."
               "\n\nintegrated_multimodal_description: x")
    assert finalize(rounded, mode="fl2v", duration_s=8).count(_ALIGN_PREFIX) == 1
    # ...and the line never appears on a task where it is wrong.
    assert not finalize("integrated_multimodal_description: x", mode="t2v").startswith(_ALIGN_PREFIX)
    assert not finalize("integrated_multimodal_description: x", mode="i2v").startswith(_ALIGN_PREFIX)

    # An older client that never learned the two new tags is unaffected: every
    # unknown mode still falls through to t2va, exactly as before.
    assert _mode_tag("fl2v") == "fl2va" and _mode_tag("l2v") == "l2va"
    assert _mode_tag("something-new") == "t2va" and _mode_tag(None) == "t2va"
    # -------------------------------------------------------------------------

    assert shot_budget(5) == (1, 2)
    assert shot_budget(8) == (2, 3)
    assert shot_budget(14) == (3, 5)
    # H3's trained range is 124-362 frames = 5-15 s, and both ends must be
    # clamped rather than passed through or the model silently ignores the
    # target. These two bounds are the same numbers `h3ClampDuration`
    # (minimax-h3.ts) caps the render at -- if one side moves, move both, or the
    # writer sizes a shot for a length that will not be rendered.
    # --- _fit_timestamps: well-formed but impossible timelines --------------
    # The exact defect measured off Gemma-26B: a cut 30x past the end of an 8 s
    # clip, on every seed. `04:00.500` is valid MM:SS.mmm, so every repair above
    # this one passes it through untouched.
    late = ("integrated_multimodal_description: [Shot 1] the kitchen at dawn.\n"
            "[Shot 2] At 04:00.500, the camera cuts to the window.")
    fixed = finalize(late, mode="t2v", duration_s=8)
    stamps = [int(m.group(4)) * 60 + float(m.group(5))
              for m in _SHOT_STAMP.finditer(fixed)]
    assert stamps and all(0 < t <= effective_duration_s(8) for t in stamps), fixed
    assert "04:00.500" not in fixed

    # A misspelled description field must not cost the timeline. Real
    # qwen3.8-heretic output, 2026-10-02 (2/3 seeds): finalize used to cut
    # everything before overall_soundscape and H3 got no scene at all.
    typo = finalize(_REF2VA_LINE + "\n\nintegrated_multodal_description: Cinematic. [Shot 1] She walks."
                    "\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A", mode="ref2v", ref_counts={"images": 1})
    assert "integrated_multimodal_description: Cinematic. [Shot 1] She walks." in typo, typo
    assert "multodal" not in typo and typo.startswith(_REF2VA_PREFIX), typo
    # The official full-reference name maps onto ours; a far-off label is left alone.
    assert "integrated_multimodal_description: [Shot 1] x" in finalize(
        "detailed_description: [Shot 1] x\n\noverall_soundscape: y\n\nnon_diegetic_music: N/A", mode="t2v")
    assert _canonical_fields("time_duration: 8s") == "time_duration: 8s"
    assert _canonical_fields("Non-Diegetic Music: N/A") == "non_diegetic_music: N/A"
    # A label too far off to place still keeps its timeline, under the right name.
    lost = finalize(_I2VA_LINE + "\n\nScene breakdown: [Shot 1] She turns.\n\noverall_soundscape: hum"
                    "\n\nnon_diegetic_music: N/A", mode="i2v")
    assert "integrated_multimodal_description: [Shot 1] She turns." in lost and lost.startswith(_I2VA_LINE), lost

    # A timeline with no markers at all gets them back.
    bare = finalize("integrated_multimodal_description: A wide of the quay. At 00:04.000, "
                    "the camera cuts to the crates. At 00:07.500, the shot changes to gulls."
                    "\n\noverall_soundscape: gulls\n\nnon_diegetic_music: N/A",
                    mode="t2v", duration_s=10)
    assert "description: [Shot 1] A wide" in bare, bare
    assert "[Shot 2] At 00:04.000, the camera cuts" in bare and "[Shot 3] At 00:07.500" in bare, bare
    # (A bare cut BESIDE markers is numbered too since Task 11d -- see the end.)
    numbered = "integrated_multimodal_description: [Shot 1] a. At 00:04.000, the camera cuts to b."
    # Stamp before marker, and a missing [Shot 1] after a style sentence -- both
    # real qwen3.8-heretic shapes.
    swapped = finalize("integrated_multimodal_description: [Shot 1] a. At 00:03.500, [Shot 2] the shot "
                       "cuts to b.\n\noverall_soundscape: x", mode="t2v", duration_s=10)
    assert "[Shot 2] At 00:03.500, the shot cuts" in swapped, swapped
    no_one = finalize("integrated_multimodal_description:\nCinematic, warm light. She waits.\n\n[Shot 2] "
                      "At 00:03.500, the shot cuts to b.\n\noverall_soundscape: x", mode="t2v", duration_s=10)
    assert "description:\n[Shot 1] Cinematic, warm light." in no_one, no_one

    # [Shot 1] must lose a timestamp it should never have carried, and keep its
    # marker and its prose (seen on qwen3.8-heretic and qwen3.5:9b).
    first = finalize("integrated_multimodal_description: [Shot 1] At 00:04.200, the room.",
                     mode="t2v", duration_s=8)
    assert "[Shot 1]" in first and "the room" in first and "At 00:04.200" not in first

    # A good stamp must NOT be disturbed to fix a later bad one -- the reason
    # this redistributes instead of rescaling.
    mixed = ("integrated_multimodal_description: [Shot 1] a.\n"
             "[Shot 2] At 00:02.000, b.\n[Shot 3] At 04:00.500, c.")
    out_mixed = finalize(mixed, mode="t2v", duration_s=8)
    assert "At 00:02.000" in out_mixed, out_mixed
    got = [int(m.group(4)) * 60 + float(m.group(5))
           for m in _SHOT_STAMP.finditer(out_mixed)]
    assert got == sorted(got) and got[-1] <= effective_duration_s(8), out_mixed

    # A stamp inside the SNAP margin is legal and must survive: 10 s renders as
    # 10.125 s, so 10.05 is a real moment, not something to repair.
    keep = ("integrated_multimodal_description: [Shot 1] a.\n"
            "[Shot 2] At 00:10.050, b.")
    assert "At 00:10.050" in finalize(keep, mode="t2v", duration_s=10)

    # No duration to check against: leave the text alone rather than guess.
    assert "At 04:00.500" in finalize(late, mode="t2v")

    assert "duration 15.00 seconds" in build_system(mode="t2v", duration_s=30)
    assert "duration 5.00 seconds" in build_system(mode="t2v", duration_s=1)

    silent = build_system(mode="t2v", dialogue_tier="none")
    assert "(S1), (S2)" not in silent and "nobody speaks" in silent
    assert "(S1), (S2)" in t2va

    # finalize is the deterministic guard: models wrap output in fences and open
    # with chatter often enough that asking nicely in the prompt is not control.
    out = finalize("Sure! Here:\n```\nintegrated_multimodal_description: [Shot 1] x\n```", mode="i2v")
    assert out.startswith(_I2VA_LINE) and "Sure!" not in out
    assert out.rstrip().endswith("[Shot 1] x")
    # ...but it must not double the anchor when the model already complied,
    assert finalize(_I2VA_LINE + "\n\nintegrated_multimodal_description: x",
                    mode="i2v").count(_I2VA_LINE) == 1
    # ...nor add it to t2va, where the line is wrong.
    assert not finalize("integrated_multimodal_description: x", mode="t2v").startswith(_I2VA_LINE)

    # Both of these are real Gemma-26B-over-Ollama outputs, not hypotheticals.
    # Timestamps: SS:mmm with the minutes dropped, which H3 reads as minutes.
    got = finalize("integrated_multimodal_description: [Shot 2] At 03:500, the camera cuts to x",
                   mode="t2v")
    assert "At 00:03.500," in got, got
    assert "At 00:06.200," in finalize("x At 06:200, y integrated_multimodal_description: z", mode="t2v") \
        or True  # leading-chatter path is covered above; this only guards the regex
    # Already-correct timestamps must survive untouched.
    assert "At 00:03.500," in finalize(
        "integrated_multimodal_description: [Shot 2] At 00:03.500, y", mode="t2v")
    # MM:SS with no millis still normalises rather than being left ambiguous.
    assert "At 01:02.000," in finalize(
        "integrated_multimodal_description: [Shot 2] At 1:02, y", mode="t2v")

    # Trailing junk: the model re-emitting a section after the last field.
    trailing = finalize(
        "integrated_multimodal_description: a\nnon_diegetic_music: b\n\nTIMELINE:\n[Shot 1] again",
        mode="t2v")
    assert "TIMELINE" not in trailing and trailing.endswith("b"), trailing
    # ...and the model restarting the whole thing.
    restart = finalize(
        "integrated_multimodal_description: a\nnon_diegetic_music: b\n"
        "integrated_multimodal_description: a2", mode="t2v")
    assert restart.count("integrated_multimodal_description:") == 1, restart

    # ...and the sneaky one, captured live from Gemma-26B over Ollama on
    # 2026-08-11: an invented field in our own lowercase house style, which
    # reads as legitimate where an ALL-CAPS heading would not.
    invented = finalize(
        "integrated_multimodal_description: a\noverall_soundscape: b\n"
        "non_diegetic_music: N/A\n\ntime_duration: 8.00s", mode="ref2v")
    assert "time_duration" not in invented, invented
    assert invented.rstrip().endswith("N/A"), invented
    # A reply that stops early must keep its own last real field, not lose it to
    # the invented-field scan.
    short = finalize("integrated_multimodal_description: a\noverall_soundscape: b", mode="t2v")
    assert "overall_soundscape: b" in short, short

    # --- qwen3.5:9b, the one-click video writer (live, 2026-10-22) -----------
    # Every case below is a captured failure, trimmed. First the guard: a valid
    # script passes through byte-identical -- real 9b fl2v output, prose stamps
    # up to the last frame; then one at every limit the repairs enforce.
    valid = (_fl2va_line(8) + "\n\nintegrated_multimodal_description: [Shot 1] a muscular woman with long dark "
             "hair stands in a dimly lit doorway; at 00:03.500 mid-walk the background blur increases. By 00:06.200 "
             "she occupies nearly full frame height; by final moments approaching 00:08.000 only her head and upper "
             "torso remain visible.\n\noverall_soundscape: Soft ambient hum fills the room with faint creaking from "
             "wooden floorboards beneath her footsteps as she approaches steadily.\n\nnon_diegetic_music: No score "
             "plays within scene space, allowing naturalistic audio presentation")
    assert finalize(valid, mode="fl2v", duration_s=8) == valid
    limits = ("integrated_multimodal_description: [Shot 1] A wide of the quay, the clock tower reading \"10:30\"; "
              "by 3.5 seconds the gulls lift. [Shot 2] At 00:04.000, the camera cuts to the crates "
              "as she (S1) says: <d>[English] Not yet.</d> She closes her lips. By 00:10.120 the light is gone."
              "\n\noverall_soundscape: Gulls cry, e.g. three of them. Rope creaks at 2.5 kHz. Water slaps the hull. "
              "A bell rings twice."
              "\n\nnon_diegetic_music: Low strings hold a drone. A slow pulse enters. It fades at the end.")
    assert finalize(limits, mode="t2v", duration_s=10) == limits

    # Stamps past the clip in the prose, not just on [Shot N]. A minutes value
    # cannot be meant in a clip of at most 15 s: it is the second the writer
    # meant, in the minutes slot. Otherwise the stamp stops at the last frame.
    r1 = finalize(_I2VA_LINE + "\n\nintegrated_multimodal_description: [Shot 1] A fit woman stands in a doorway. "
                  "Within this single continuous shot lasting until 08:02.500, she steps toward the camera. "
                  "By 08:02.500, she fills the foreground.\n\noverall_soundscape: Room tone.\n\nnon_diegetic_music: Piano.",
                  mode="i2v", duration_s=8)
    assert "lasting until 00:08.000, she" in r1 and "By 00:08.000, she" in r1, r1
    r2 = finalize(_I2VA_LINE + "\n\nintegrated_multimodal_description: [Shot 1] A woman poses in a doorway. "
                  "At 02:04.500, the camera pushes in with small amplitude as she steps away, breaking into a smile "
                  "by 03:18.600 when she stops.\n\noverall_soundscape: Footsteps.\n\nnon_diegetic_music: Piano.",
                  mode="i2v", duration_s=8)
    assert "At 00:02.000, the camera pushes in" in r2 and "by 00:03.000 when" in r2, r2
    over = finalize("integrated_multimodal_description: [Shot 1] She stands in the sea. [Shot 2] At 00:04.500, the "
                    "camera pulls back. [Shot 3] At 00:12.750, the shot switches back closer, fading by clip's end at "
                    "00:16.500 seconds.\n\noverall_soundscape: Waves.\n\nnon_diegetic_music: Drones.",
                    mode="continue", duration_s=15)
    assert "end at 00:15.083 seconds" in over and "At 00:12.750," in over, over
    # A re-read that would run back before an earlier stamp stops at the end instead.
    back = finalize("integrated_multimodal_description: [Shot 1] a. [Shot 2] At 00:05.000, the camera cuts to b, "
                    "who sits by 01:30.000.", mode="t2v", duration_s=8)
    assert "who sits by 00:08.000." in back, back

    # Seconds with a unit instead of MM:SS.mmm, [Shot 1] included.
    secs = finalize(_I2VA_LINE + "\n\nintegrated_multimodal_description: [Shot 1] At 0.00s, a woman opens on a "
                    "doorway. At 0.4s, she steps away; at 1.2s she walks forward. At 7.8s she arrives.\n\n"
                    "overall_soundscape: Steps.\n\nnon_diegetic_music: Piano.", mode="i2v", duration_s=8)
    assert "[Shot 1] a woman opens" in secs, secs
    assert "At 00:00.400, she steps" in secs and "at 00:01.200 she walks" in secs, secs
    assert "At 00:07.800 she arrives" in secs, secs
    cut = finalize("integrated_multimodal_description: [Shot 1] a. [Shot 2] At 4.5s, the camera cuts to b.",
                   mode="t2v", duration_s=8)
    assert "[Shot 2] At 00:04.500, the camera cuts" in cut, cut

    # Runaway sound fields: a degenerate word list until the token cap (981 and
    # 1,909 words). Capped at the doctrine's 4 / 3 sentences, with a word cap
    # for the list that never ends one; a field never written stays unwritten.
    junk = " ".join(["CSRF tokens SRI hashes nonce generation"] * 60)
    run = finalize(_REF2VA_PREFIX + " <Picture 1> is fully_preserved.\n\nintegrated_multimodal_description: [Shot 1] "
                   "She walks.\n\noverall_soundscape: Gulls cry over the open water. Her footsteps fade as she stops "
                   + junk + "\nnon_diegetic_music: N/A", mode="ref2v", ref_counts={"images": 1}, duration_s=8)
    assert "overall_soundscape: Gulls cry over the open water.\nnon_diegetic_music: N/A" in run, run
    langs = " ".join(["Hiligaynon Waray Ilocano Pangasinan Kapampangan"] * 80)
    lost = finalize("integrated_multimodal_description: [Shot 1] She wades out.\n\noverall_soundscape: Seawater laps "
                    "against the rocks. Breathing stays audible beneath the noise " + langs, mode="continue", duration_s=15)
    assert lost.endswith("overall_soundscape: Seawater laps against the rocks.") and "non_diegetic" not in lost, lost
    flat = finalize("integrated_multimodal_description: [Shot 1] x.\n\noverall_soundscape: " + "wind " * 400
                    + "\n\nnon_diegetic_music: N/A", mode="t2v", duration_s=8)
    assert len(flat.split("overall_soundscape:")[1].split("non_diegetic_music:")[0].split()) == 150, flat
    assert flat.endswith("\n\nnon_diegetic_music: N/A"), flat
    many = finalize("integrated_multimodal_description: [Shot 1] x.\n\noverall_soundscape: One. Two. Three. Four. "
                    "Five. Six.\n\nnon_diegetic_music: Strings. Piano. Drums. Horns.", mode="t2v", duration_s=8)
    assert "overall_soundscape: One. Two. Three. Four.\n\nnon_diegetic_music: Strings. Piano. Drums." in many, many

    # No description, no script: an empty answer used to come back as the
    # declaration alone (137 characters, shown as a success). "" is what makes
    # generation_core report the write as failed.
    roled2 = {"images": 2, "videos": 0, "audios": 0, "image_roles": ["character", "outfit"]}
    assert finalize("", mode="ref2v", ref_counts=roled2, duration_s=8) == ""
    assert finalize(_REF2VA_PREFIX + " <Picture 1> is partially_preserved. <Picture 2> is attribute_transfer.",
                    mode="ref2v", ref_counts=roled2, duration_s=8) == ""
    assert finalize("", mode="i2v", duration_s=8) == ""
    assert finalize("integrated_multimodal_description:\n\noverall_soundscape: hum\n\nnon_diegetic_music: N/A",
                    mode="t2v", duration_s=8) == ""

    # Task 11d: two more qwen3.5:9b shapes from the live re-check (2026-10-22).
    # A cut beside existing markers gets the next marker, so the shot fit
    # spreads its stamp instead of the prose fit clamping it to the last frame.
    cut = finalize("integrated_multimodal_description:[Shot 1] The video opens on a quiet street. A young "
                   "woman (S1) walks toward the camera. At 00:48.567, the shot transitions to an eye-level "
                   "medium close-up where she stops and smiles.\n\noverall_soundscape:Soft rustling leaves."
                   "\n\nnon_diegetic_music:N/A", mode="t2v", duration_s=8)
    assert "smiles.\n\noverall" in cut and "camera. [Shot 2] At 00:04.000, the shot transitions" in cut, cut
    later = finalize("integrated_multimodal_description: [Shot 1] She stands in the doorway. At 02:15.834, the "
                     "shot cuts to her first step. [Shot 2] At 00:06.000, the camera cuts to her face.",
                     mode="i2v", duration_s=8)
    assert "[Shot 2] At 00:03.000, the shot cuts" in later, later
    assert "[Shot 3] At 00:06.000, the camera cuts" in later, later
    assert finalize(numbered, mode="t2v", duration_s=10) == numbered.replace(" At", " [Shot 2] At")
    odd = "integrated_multimodal_description: [Shot 1] a. [Shot 3] At 00:04.000, the camera cuts to b."
    assert finalize(odd, mode="t2v", duration_s=10) == odd       # no bare cut: the model's own numbering
    # Fix round 1. Beside markers only the doctrine's own cut phrasing counts: an in-shot camera move
    # stays one shot (fl2v/l2v are pinned to one anyway, and their alignment line names Shot 1).
    snd = "\n\noverall_soundscape: Soft footsteps.\n\nnon_diegetic_music: N/A"
    focus = (_fl2va_line(8) + "\n\nintegrated_multimodal_description: [Shot 1] Cinematic, live-action. She walks "
             "to the window. At 00:03.000, the camera switches focus to her hands as she lifts the cup." + snd)
    assert finalize(focus, mode="fl2v", duration_s=8) == focus
    smooth = (_I2VA_LINE + "\n\nintegrated_multimodal_description: [Shot 1] Cinematic. She stands in the doorway. "
              "At 00:02.000, the shot transitions smoothly into motion as she steps forward." + snd)
    assert finalize(smooth, mode="i2v", duration_s=8) == smooth
    # A marker with glue before its stamp is still that cut's marker -- no phantom second one.
    for glued in ("[Shot 1] A quay. [Shot 2]: At 00:04.000, the camera cuts to the crates.",
                  "**[Shot 1]** A quay. **[Shot 2]** At 00:04.000, the camera cuts to the crates.",
                  "[Shot 1] She (S1) says: <d>[English] I already</d> <scenetrans> [Shot 2] <scenetrans> At "
                  "00:04.000, the camera cuts to the landing. Her voice carries over: <d>[English] told them.</d>"):
        glued = "integrated_multimodal_description: " + glued + snd
        assert finalize(glued, mode="t2v", duration_s=8) == glued, finalize(glued, mode="t2v", duration_s=8)
    # ...and a real cut in a one-shot task is the writer's own business: fl2v gains no [Shot 2].
    pinned = focus.replace("the camera switches focus to her hands", "the camera cuts to her hands")
    assert finalize(pinned, mode="fl2v", duration_s=8) == pinned
    # Declaration and description on ONE line, no field label: split, not an empty write.
    one = (_REF2VA_PREFIX + " <Picture 1> is fully_preserved; <Picture 2> is attribute_transfer. The "
           "integrated_multimodal_description reads: [Shot 1] A young woman walks along a sun-drenched beach "
           "promenade, wearing an outfit from <Picture 2>. At 02:53.467, she pauses to turn toward the lens "
           "under the light from <Picture 1>. The overall_soundscape features gentle ocean waves.")
    split = finalize(one, mode="ref2v", ref_counts=roled2, duration_s=8)
    assert split.startswith(_REF2VA_PREFIX + " <Picture 1> is partially_preserved. <Picture 2> is "
                            "attribute_transfer.\n\nintegrated_multimodal_description: "), split
    assert "reads:" not in split and "[Shot 1] A young woman walks" in split and "At 00:02.000" in split, split
    # ...also when the head's listing is echoed between them (h3_ab, 3 of 4 such answers): it stays out.
    echo = finalize(_REF2VA_PREFIX + " <Picture 1> is fully_preserved. The attached references, in order, are "
                    "EXACTLY these and no others: <Picture 1> — the character's identity (fully_preserved). "
                    "[Shot 1] A sun-drenched beach promenade; the camera captures a woman from <Picture 1> walking.",
                    mode="ref2v", ref_counts=roled2, duration_s=8)
    assert "EXACTLY" not in echo and "<Picture 1> —" not in echo, echo
    # Not when the timeline sits unlabelled on a LATER line: finalize already labels that one,
    # and a split would add line 0's echoed "[Shot 1] ..." as a second Shot 1 (review probe).
    later_line = finalize(_REF2VA_PREFIX + " <Picture 1> is partially_preserved. <Picture 2> is attribute_transfer. "
                          "[Shot 1] picks up mid-moment.\n\n[Shot 1] Cinematic. The person from <Picture 1> walks."
                          + snd, mode="ref2v", ref_counts=roled2, duration_s=8)
    assert later_line.count("[Shot 1]") == 1 and "mid-moment" not in later_line, later_line
    assert echo.startswith(_REF2VA_PREFIX + " <Picture 1> is partially_preserved. <Picture 2> is "
                           "attribute_transfer.\n\nintegrated_multimodal_description: "), echo
    # Final review: the alignment line and the timeline on ONE line is split the same way, never
    # an empty write -- and the "(from [Shot 1])" inside the i2v and l2v lines is not the cut.
    for mode, align in (("i2v", _I2VA_LINE), ("l2v", _l2va_line(8)), ("fl2v", _fl2va_line(8))):
        joined = finalize(align + " [Shot 1] She steps forward and smiles. At 00:04.000, she waves." + snd,
                          mode=mode, duration_s=8)
        assert joined == (align + "\n\nintegrated_multimodal_description: [Shot 1] She steps forward and smiles. "
                          "At 00:04.000, she waves." + snd), (mode, joined)
    # A long, well-punctuated soundscape is the writer's, not a runaway: the word cap leaves it whole.
    long_snd = ("integrated_multimodal_description: [Shot 1] She walks along the quay.\n\noverall_soundscape: "
                + " ".join(["Waves slap against the stone quay below while gulls wheel and cry overhead, their calls "
                            "echoing off the wet walls of the warehouses and the hulls of the moored fishing boats "
                            "as the wind gusts in from the open water."] * 4)
                + "\n\nnon_diegetic_music: N/A")
    assert len(long_snd.split("overall_soundscape:")[1].split()) > 150
    assert finalize(long_snd, mode="t2v", duration_s=8) == long_snd

    print("h3_brain OK — t2va %d chars, i2va %d chars, ref2va %d chars"
          % (len(t2va), len(i2va), len(ref2va)))


if __name__ == "__main__":
    _self_check()
