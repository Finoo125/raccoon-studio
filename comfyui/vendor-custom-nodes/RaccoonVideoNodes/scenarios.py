"""
scenarios.py — Scenario / position presets
=============================================
Behaves like environments.py and the camera_angle dropdown: a BACKGROUND
ACTIVATION LAYER. The user picks a scenario and its choreography hint is laid
ON TOP of whatever they typed — even where the two overlap, the scenario
"activates" the position so the LLM renders that exact choreography reliably
instead of being left to infer it.

Mental model:  environment + scenario + user input + sliders = prompt

Each scenario is a tuple:
    (tag, setup, choreography)
      tag          — "SFW" or "NSFW" (does nothing on its own here; the scene-content
                     detector still decides explicit vs clean. The tag is a label plus
                     an optional signal the node can read.)
      setup        — one plain sentence fixing the position / starting arrangement
      choreography — the movement grammar that makes the position land: continuous,
                     finite verbs, one action per clause, in physical order.
                     MUST spell out facing relative to the man and the camera.
                     Any turn or look-back ALWAYS rotates torso + head together
                     (never the head or neck alone).
                     Facing away means back and hips to him, front to camera.
                     Never assume the model will infer the torso.

Sentinels:
    None      → no scenario (LLM / user's prompt decides)
    "RANDOM"  → seed picks one at runtime

The hint goes in as an additive block; the user's own words keep priority for
identity, wardrobe and specifics. The scenario supplies only the ARRANGEMENT and
the MOTION, so a blank or vague box still produces a well-choreographed clip.

Keep every setup and choreography as ONE string literal — no implicit
concatenation across lines. update_scenario_in_source() below rewrites entries
in place with a regex that expects exactly three literals per tuple, and the
UI's edit-scenario button goes through it.
"""

SCENARIO_PRESETS = {
    "None — user's prompt decides": None,
    '🎲 Random — seed picks': "RANDOM",
    '🚶 Walk in and stop': ('SFW', 'Someone walks into the space and halts.',
        'She walks into the room at an even pace, comes to a halt in the middle of it, and stands there with her weight settling onto both feet.'),
    '🪑 Sit down on a chair': ('SFW', 'Someone crosses to a chair and takes a seat.',
        'She crosses to the chair, rotates to face outward, and lowers herself into the seat in one unbroken motion.'),
    '🪑 Straddle a chair backwards': ('SFW', 'Someone sits astride a chair facing the backrest.',
        'She swings one leg over the seat, lowers herself astride it facing the backrest, and folds both arms along the top of it with her chin coming to rest on them.'),
    '🪟 Draw the curtains open': ('SFW', 'Someone opens a set of curtains and lets the light in.',
        'She steps up to the window, takes a curtain in each hand, and draws them apart in one movement, then stands still as the light lands across her.'),
    '🖐 Press a palm to the glass': ('SFW', 'Someone puts a hand flat against a window.',
        'She steps up to the glass and lays one palm flat on it, leaning her weight onto that arm, her breath fogging the pane in front of her.'),
    '🌆 Lean on a railing, looking out': ('SFW', 'Someone leans onto a railing and looks out.',
        'She sets both forearms on the railing, tips her weight forward onto them, and looks out ahead.'),
    '🪜 Climb onto a ledge and sit': ('SFW', 'Someone climbs up onto a ledge and sits on it.',
        'She takes the ledge in both hands, pushes herself up onto it, rotates around to face outward, and lets both legs hang over the edge.'),
    '👠 Step into a pair of heels': ('SFW', 'Someone puts on a pair of heels.',
        'She braces one hand on the wall, lifts a foot and slides it into the shoe, does the same with the other, then straightens up onto both heels and settles her weight.'),
    '🚿 Step under the water': ('SFW', 'Someone steps under a running shower.',
        'She steps forward into the falling water, tips her head back into it, and runs both hands back across her scalp as the water sheets down her.'),
    '💦 Lean back under water': ('SFW', 'Someone tips back into water and surfaces.',
        'She drops her head back into the water, then comes back up with water pouring off her face and shoulders.'),
    '🌊 Wade out into the water': ('SFW', 'Someone walks out from the shore into the water.',
        'She walks forward off the sand into the shallows, the water climbing her legs with every step, and stops once it reaches her waist with both hands trailing on the surface.'),
    '💨 Turn into the wind': ('SFW', 'Someone turns to face into a strong wind.',
        'She rotates her torso and head together to face into the wind, her hair lifting back off her face, and holds there with her eyes half closed against it.'),
    '🕯 Lean in and blow out a candle': ('SFW', 'Someone leans down to put out a candle.',
        'She leans in over the flame, draws a breath, and blows it out in one steady exhale, her face dropping into darkness as it goes.'),
    '🍷 Pour a drink and raise the glass': ('SFW', 'Someone pours a drink and lifts it.',
        'She tips the bottle and fills the glass, sets the bottle down, then lifts the glass toward the camera and holds it up.'),
    '🎧 Roll her shoulders into the beat': ('SFW', 'Someone picks up a rhythm and starts moving with it.',
        'She drops her shoulders loose, rolls them back one after the other into the beat, and lets the motion carry down into her hips.'),
    '💃 Dance slowly on the spot': ('SFW', 'Someone sways through a slow solo dance.',
        'She rocks her hips side to side without moving her feet, her arms rising loosely with the motion.'),
    '👗 Slow twirl in a dress': ('SFW', 'Someone turns slowly on the spot to show off a dress.',
        'She stands facing the camera and rotates through a full circle without leaving the spot. Her torso leads, shoulders and head follow, and the dress lifts and flares. She comes back around to face the camera again.'),
    '🛋 Flop onto a couch': ('SFW', 'Someone drops backward onto a couch.',
        'She turns her back to the couch and lets herself drop, sinking into the cushions.'),
    '🧎 Slide down the wall to the floor': ('SFW', 'Someone lowers themselves down a wall until they are sitting on the floor.',
        'She sets her back flat to the wall and slides down it, knees folding under her, until she is sitting on the floor with her legs drawn up.'),
    '🛏 Stretch on a bed': ('SFW', 'Someone stretches out lazily on a bed.',
        'She pushes both arms up past her head and lifts her back off the mattress in a long slow arch.'),
    '🧎 Kneel up and arch': ('SFW', 'Someone comes up onto their knees and arches.',
        'She lifts up onto her knees and eases her back into an arch, both hands sliding up her thighs.'),
    '😏 Bite lip and look over shoulder': ('SFW', 'Someone glances back with a loaded look.',
        'She rotates torso and head together at the waist to look back over her shoulder at the camera, drawing her lower lip in between her teeth while her hips stay turned away.'),
    '🍑 Walk away, glance back': ('SFW', 'Someone walks off and looks back over a shoulder.',
        'She walks unhurriedly away from the camera with her back squarely to it. She halts, then rotates torso and head together at the waist to look back at the camera while her feet and hips stay pointed away.'),
    '💋 Blow a kiss to camera': ('SFW', 'Someone blows a kiss.',
        'She touches her fingertips to her mouth, then sweeps her hand outward toward the camera in a slow arc.'),
    '🤲 Reach out and pull him in': ('SFW', 'Someone reaches for another person and draws them in close.',
        'She puts out both hands, closes them on his shirt, and pulls him in against her, bringing her arms around his back.'),
    '🔥 Missionary': ('NSFW', 'Explicit sex — missionary, penetration visible. She is on her back facing up at him (facing the camera).',
        'She lies on her back facing up at him with her knees bent and open. He settles between her legs and drives his cock into her pussy at a steady pace.'),
    '🔥 Legs over his shoulders': ('NSFW', 'Explicit sex — missionary variant with her legs up over his shoulders. She is on her back facing up at him.',
        'She lies on her back facing up at him and lifts both legs, and he hooks them over his shoulders. He leans down over her and drives his cock deep into her pussy while her ankles stay locked behind his neck.'),
    '🔥 Butterfly — hips lifted': ('NSFW', 'Explicit sex — she is on her back with her hips lifted up onto him, facing up toward him.',
        'She lies on her back facing up and he draws her hips up onto his thighs until only her shoulders are still down. He holds her there and drives his cock down into her pussy at a steady pace.'),
    '🔥 Mating press': ('NSFW', 'Explicit sex — mating press, deep penetration from above. She is on her back facing up at him (facing the camera).',
        'She lies on her back facing up with her knees drawn back toward her shoulders and her feet in the air. He folds down over her and drives his cock straight down into her pussy, holding her legs pinned back.'),
    '🔥 Edge of the bed, he stands': ('NSFW', 'Explicit sex — she lies at the edge of the bed and he stands on the floor. She is on her back facing up at him.',
        'She lies on her back with her hips right at the edge of the mattress and her legs open. He stands on the floor between them, takes hold of her thighs, and drives his cock into her pussy at a steady pace.'),
    '🔥 Doggy': ('NSFW', 'Explicit sex — doggy from behind, penetration visible. She is on all fours turned away from him (facing the camera).',
        'She is on all fours turned away from him, her back toward his chest and her face toward the camera. He takes hold of her hips and drives his cock into her pussy from behind at a steady pace.'),
    '🔥 Prone bone': ('NSFW', 'Explicit sex — she lies flat on her stomach and he lies on top of her from behind, penetration visible.',
        'She lies face down and flat on her stomach with her legs together, turned away from him. He lowers his body onto her back and drives his cock into her pussy from behind, his weight holding her against the mattress.'),
    '🔥 Bent over a surface': ('NSFW', 'Explicit sex — bent over a surface, taken from behind. Torso down, ass up, turned away from him (toward the camera where it applies).',
        'She folds at the waist over the surface with her torso down and her ass raised, turned away from him. He takes her hips and drives his cock into her pussy from behind at a steady pace.'),
    '🔥 Standing from behind': ('NSFW', 'Explicit sex — both standing, penetration from behind. She is turned away from him and facing the camera.',
        'She stands turned away from him and facing the camera with her feet apart, and tips forward at the waist. He steps in behind her, takes her hips, and drives his cock into her pussy from behind at a steady pace.'),
    '🔥 Against the wall, standing': ('NSFW', 'Explicit sex — standing against a wall, penetration. She faces him with her back on the wall.',
        'He pins her back flat to the wall so she is turned toward him. She locks her legs around his waist and he drives his cock up into her pussy while holding her against the wall.'),
    '🔥 Carried, legs locked around him': ('NSFW', 'Explicit sex — he holds her clear of the floor and she faces him with her legs around his waist.',
        'He takes her under the thighs and lifts her off the floor. She locks her legs around his waist and her arms around his neck, facing him, and he drives his cock up into her pussy while carrying her weight.'),
    '🔥 Cowgirl': ('NSFW', 'Explicit sex — cowgirl, riding on top turned toward him (chest to chest).',
        'She straddles him facing him, takes his cock into her pussy, and rides in a rolling rhythm with her torso upright and turned to his chest, hands planted on his shoulders or chest.'),
    '🔥 Reverse cowgirl': ('NSFW', 'Explicit sex — reverse cowgirl, riding turned away from him (back to his chest, facing the camera).',
        'She straddles him turned away, takes his cock into her pussy, and rides with her back against his chest. Her torso stays pointed at the camera while her hips roll and her ass lifts and drops.'),
    '🔥 Amazon — she squats over him': ('NSFW', 'Explicit sex — she squats over him on her feet, turned toward him.',
        'He lies on his back with his knees drawn up. She squats over his hips on her feet facing him, lowers her pussy onto his cock, and drives herself up and down on it with her thighs.'),
    '🔥 Spooning': ('NSFW', 'Explicit sex — side by side, penetration from behind. She faces the same way he does (both toward the camera or both away).',
        'She lies on her side facing forward and he settles in directly behind her. He pushes his cock into her pussy from behind while they stay stacked together, his chest on her back.'),
    '🔥 Oral (giving)': ('NSFW', 'Explicit — blowjob, sucking cock. She kneels in front of him, turned toward him.',
        'She kneels facing him, takes his cock into her mouth, and works her head up and down at a steady pace with her eyes on him.'),
    '🔥 Oral (receiving)': ('NSFW', 'Explicit — eating pussy, oral on her. She is on her back facing up (toward the camera) with her legs open.',
        'She lies on her back facing up with her thighs spread wide. He lies between her legs and licks her pussy at a steady pace while she pushes her hips up into his mouth.'),
    '🔥 Face sitting': ('NSFW', 'Explicit — sitting on his face, oral. She is turned toward his feet or the camera (state which).',
        'She lowers herself down onto his face, straddling his head with her pussy right above his mouth. She faces forward, toward his feet or the camera, and grinds her hips in slow circles against his tongue.'),
    '🔥 69': ('NSFW', 'Explicit — 69, mutual oral.',
        'She settles over him head to toe, taking his cock into her mouth while he licks her pussy, the two of them rocking together.'),
    '🔥 Titfuck': ('NSFW', 'Explicit — his cock between her breasts. She is in front of him and turned toward him.',
        'She kneels in front of him facing him and presses her breasts together around his cock. He works his cock up and down between them while she holds them closed and keeps her eyes on his face.'),
    '🔥 Handjob, kneeling at his side': ('NSFW', 'Explicit — she strokes his cock with her hand, kneeling beside him.',
        'She kneels at his side and closes one hand around his cock. She strokes it up and down at a steady pace with her torso rotated toward him and her eyes on his face.'),
    '🌸 Scissoring (F/F)': ('NSFW', 'Explicit F/F — scissoring, pussies grinding.',
        'They hook their legs together and grind their pussies against each other at a steady rocking pace.'),
    '🌸 Thigh grinding (F/F)': ('NSFW', 'Explicit F/F — one woman grinds her pussy down onto the other\'s thigh.',
        "She straddles her partner's thigh, lowers her pussy onto it, and grinds forward and back along it at a building pace while her partner holds her hips."),
    '🌸 Strap-on from behind (F/F)': ('NSFW', 'Explicit F/F — one woman takes the other from behind with a strap-on. The receiving woman is turned away and facing the camera.',
        'One woman goes down onto all fours turned away from her partner and facing the camera. Her partner kneels in behind her, takes her hips, and drives the strap-on into her pussy from behind at a steady pace.'),
    '🍑 Doggy (anal)': ('NSFW', 'Explicit anal — doggy, penetration from behind. She is on all fours turned away from him (facing the camera).',
        'She is on all fours turned away from him, her back toward his chest. He takes hold of her hips and drives his cock into her ass from behind at a steady pace.'),
    '🍑 Anal, mating press': ('NSFW', 'Explicit anal — mating press, deep penetration from above. She is on her back facing up at him.',
        'She lies on her back facing up with her knees pushed back toward her shoulders. He folds down over her and drives his cock straight down into her ass, holding her legs pinned back.'),
}

SCENARIO_KEYS = list(SCENARIO_PRESETS.keys())

# Pool the seed can pick from for "RANDOM" (everything except the two sentinels).
_SCENARIO_RANDOM_POOL = [k for k, v in SCENARIO_PRESETS.items()
                         if v not in (None, "RANDOM")]

# Convenience splits (a filter toggle in the UI can use these).
SCENARIO_SFW = [k for k, v in SCENARIO_PRESETS.items()
                if isinstance(v, tuple) and v[0] == "SFW"]
SCENARIO_NSFW = [k for k, v in SCENARIO_PRESETS.items()
                 if isinstance(v, tuple) and v[0] == "NSFW"]


def scenario_tag(key):
    """Return 'SFW' / 'NSFW' / '' for a scenario key."""
    v = SCENARIO_PRESETS.get(key)
    return v[0] if isinstance(v, tuple) else ""


def scenario_is_explicit(key, seed=0):
    """True when the selected scenario is NSFW — the node uses this to FORCE the
    explicit gate ON, so picking e.g. 'Doggy' engages explicit rendering even if
    the user's typed prompt was tame. The scenario is a deliberate content signal."""
    v = resolve_scenario(key, seed=seed)
    return bool(v and v[0] == "NSFW")


def resolve_scenario(key, seed=0):
    """Return the (tag, setup, choreography) tuple for a key, resolving RANDOM
    with the seed. Returns None for the no-scenario sentinel."""
    v = SCENARIO_PRESETS.get(key) if key else None
    if v == "RANDOM":
        import random
        rng = random.Random(seed or None)
        v = SCENARIO_PRESETS.get(rng.choice(_SCENARIO_RANDOM_POOL))
    return v if isinstance(v, tuple) else None


def build_scenario_block(key, seed=0):
    """The additive activation block, laid on top of the user's prompt.
    Mirrors the environment block: an activation layer supplying ARRANGEMENT and
    MOTION while the user's own words keep priority for identity / wardrobe /
    specifics. Returns '' when no scenario is selected.

    The principle baked in: THE MODEL IS LITERAL — no write, no see.

For positioning scenarios: describe the physical ACTION performed (steps between legs, rotates torso, lowers hips to sit, and so on) in neutral spatial terms. Do not name the result of body contact ("ass against crotch", "pressing against him").

For explicit sex act scenarios: use direct anatomical language so the model actually renders the contact."""
    v = resolve_scenario(key, seed=seed)
    if not v:
        return ""
    tag, setup, choreo = v
    block = (
        "\u2501\u2501 SCENARIO \u2014 THIS IS THE ACTION OF THE CLIP (mandatory) \u2501\u2501\n"
        f"  Setup: {setup}\n"
        f"  Choreography to render: {choreo}\n"
        "This scenario is WHAT HAPPENS in the clip \u2014 the subject MUST carry out this action with "
        "precise body orientation. It is not decoration. Any environment or location given alongside it "
        "is only WHERE the action takes place. "
        "CRITICAL \u2014 BODY ORIENTATION MUST BE EXPLICIT IN EVERY BEAT:\n"
        "- Name the exact facing relative to him and to the camera: 'turned to him chest-to-chest', 'back squarely to him and facing the camera', 'hips forward, upper body rotated toward camera'.\n"
        "- Turning the head or neck alone is forbidden. Any look back or change of facing rotates TORSO + shoulders + head together at the waist as one unit.\n"
        "- Turned away from the man means her back is to him and she faces the camera, unless the prompt states otherwise.\n"
        "- Write the ACTION performed (she steps, she rotates her torso, she lowers her hips, she sits) in neutral spatial terms. Do not write the result of body contact (no 'ass against crotch', no 'pressing against his', and so on).\n"
        "- When she rotates to face him: write the full torso rotation and the weight shift that goes with it.\n"
        "Short, direct, physical sentences with finite verbs only. The model is literal.\n"
    )
    if tag == "NSFW":
        block += (
            "\u2501\u2501 EXPLICIT RENDER (mandatory for this scenario) \u2501\u2501\n"
            "This is an explicit sexual scene. The video model is LITERAL \u2014 it renders only what the "
            "words on the page name. Write the act plainly and anatomically: name the cock, the pussy, "
            "the ass, the penetration, the point of contact, the wetness \u2014 in EVERY beat. Never soften "
            "it into 'takes him in', 'joins with', 'moves together' or any other coy phrasing; those "
            "render nothing at all. Keep the explicit contact on screen across the whole clip: where the "
            "cock is, what it is doing, how deep, how fast, and the visible physical response (skin "
            "rippling, wetness, bodies impacting). Every body part and action named in the choreography "
            "above stays visible throughout.\n"
        )
    return block


# ─────────────────────────────────────────────────────────────────────────────
#  Live editing helpers (used by the UI "edit scenario" button)
# ─────────────────────────────────────────────────────────────────────────────

import re
import os
import sys
import importlib

def get_scenario_data(key):
    """Return editable data for the UI."""
    v = SCENARIO_PRESETS.get(key)
    if isinstance(v, tuple) and len(v) == 3:
        return {
            "tag": v[0],
            "setup": v[1],
            "choreography": v[2]
        }
    return None


def _python_string_literal(text: str) -> str:
    """Escape text as a double-quoted Python string."""
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
    return f'"{escaped}"'


def update_scenario_in_source(key: str, new_setup: str, new_choreography: str) -> bool:
    """
    Edit the scenario directly in this file and hot-reload.
    This lets the user refine scenarios from the UI without restarting Comfy.
    """
    filepath = os.path.abspath(__file__)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Match: 'Exact Key': ('TAG', "old setup", "old choreo"),
    # The string matcher must step over backslash escapes — saved text is
    # written with \" and \n, and a plain [^"]* would stop at the first \",
    # permanently breaking re-edits of that scenario.
    lit = r"""('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")"""
    pattern = (
        rf"('{re.escape(key)}':\s*\()"
        rf"{lit},\s*{lit},\s*{lit}"
        r"(\),)"
    )

    def replacer(m):
        tag_part = m.group(2)
        setup_lit = _python_string_literal(new_setup)
        choreo_lit = _python_string_literal(new_choreography)
        return f"{m.group(1)}{tag_part}, {setup_lit}, {choreo_lit}{m.group(5)}"

    new_content, count = re.subn(pattern, replacer, content, count=1)

    if count == 0:
        return False

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

    # Hot reload so the current process sees the change
    mod = sys.modules[__name__]
    importlib.reload(mod)

    # Make sure our local globals are updated
    global SCENARIO_PRESETS
    SCENARIO_PRESETS = mod.SCENARIO_PRESETS

    return True


if __name__ == "__main__":
    print("total scenarios:", len(SCENARIO_PRESETS) - 2, "(+2 sentinels)")
    print("SFW:", len(SCENARIO_SFW), "| NSFW:", len(SCENARIO_NSFW))
    print("random pool:", len(_SCENARIO_RANDOM_POOL))
    print()
    print("sample SFW block:")
    print(build_scenario_block("🪑 Sit down on a chair"))
    print("sample NSFW block:")
    print(build_scenario_block("🔥 Doggy"))
