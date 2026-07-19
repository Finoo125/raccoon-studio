"""
scenarios_ld.py — Scenario / position presets for the previous pack (Smart Encoder LD)
=====================================================================================
Works exactly like environments_ld.py and the camera_angle dropdown: a BACKGROUND
ACTIVATION LAYER. The user picks a scenario, and its choreography hint is injected
ON TOP of whatever they typed in the prompt box — even if they described roughly the
same thing, the scenario "activates" the position so the LLM renders that specific
choreography reliably instead of hoping to infer it.

Mental model:  environment + scenario + user input + sliders = prompt

Each scenario is a tuple:
    (tag, setup, choreography)
      tag          — "SFW" or "NSFW" (drives nothing on its own here; the scene-content
                     detector still resolves explicit/clean. The tag is a label + an
                     optional signal the node can read.)
      setup        — one plain sentence establishing the position/starting arrangement
      choreography — the movement grammar that makes the position render: continuous,
                     finite verbs, one action per clause, physical order. 
                     MUST be explicit about facing direction relative to the man and camera.
                     When turning/looking back: ALWAYS rotates torso + head together (never head/neck only).
                     If facing away: back/hips to him, front to camera. Never assume the model will infer torso movement.

Sentinels:
    None      → no scenario (LLM / user's prompt decides)
    "RANDOM"  → seed picks one at runtime

The hint is injected as an additive block; the user's own words always take priority
for identity, wardrobe, and specifics. The scenario only supplies the ARRANGEMENT and
the MOTION so a blank or vague box still yields a well-choreographed clip.
"""

SCENARIO_PRESETS = {
    "None — user's prompt decides": None,
    '🎲 Random — seed picks': "RANDOM",
    '🚶 Walk in and stop': ('SFW', 'A person walks into the space and comes to a stop.',
        'She walks forward into the room at a steady pace, then stops in the center and stands still, her weight settling on both feet.'),
    '🪑 Sit down on a chair': ('SFW', 'A person crosses to a chair and sits.',
        'She steps to the chair, turns to face out, and lowers herself down into the seat in one smooth motion.'),
    '🧍 Stand up from a chair': ('SFW', 'A person rises from a seated position.',
        'She pushes down on the armrests and rises smoothly to her feet, straightening as she stands.'),
    '🚪 Enter through a door': ('SFW', 'A person opens a door and comes through it.',
        'She pushes the door open and steps through into the room in one smooth motion.'),
    '🤚 Reach for something on a shelf': ('SFW', 'A person reaches up for an object on a high shelf.',
        'She reaches one arm up toward the high shelf and closes her hand around the object.'),
    '🧎 Kneel to pick something up': ('SFW', 'A person kneels to retrieve something from the floor.',
        'She bends her knees and lowers straight down into a kneel, reaching one hand to the floor.'),
    '🌆 Lean on a railing, looking out': ('SFW', 'A person leans on a railing and gazes out.',
        'She rests both forearms on the railing and leans her weight forward, gazing out ahead.'),
    '🪜 Climb stairs': ('SFW', 'A person climbs a flight of stairs.',
        'She climbs the stairs at a steady pace, one hand trailing along the banister.'),
    '🔄 Turn around to look behind': ('SFW', 'A person turns to look over their shoulder.',
        'She pivots her upper body at the waist, rotating her torso and head together as one unit to look back over her shoulder while her hips stay facing forward.'),
    '🛏 Lie down to rest': ('SFW', 'A person lies down on a bed to rest.',
        'She sits on the edge of the bed, then lies back and settles onto the mattress.'),
    '🧥 Put on a jacket': ('SFW', 'A person puts on a jacket.',
        'She slides one arm then the other into the jacket sleeves and pulls it up onto her shoulders.'),
    '☕ Sip a drink by a window': ('SFW', 'A person stands by a window with a drink.',
        'She raises the cup to her lips and takes a slow sip, then lowers it, gazing out the window.'),
    '💃 Dance slowly on the spot': ('SFW', 'A person sways in a slow solo dance.',
        'She sways her hips slowly from side to side, letting her arms drift up with the motion.'),
    '🤗 Walk up and hug': ('SFW', 'One person walks up to another and hugs them.',
        'She walks up to him, wraps both arms around him, and presses into a close hug.'),
    '🪞 Fix hair in a mirror': ('SFW', 'A person adjusts their hair in front of a mirror.',
        'She lifts both hands to her hair and smooths it back, watching herself in the mirror.'),
    '🛋 Flop onto a couch': ('SFW', 'A person drops down onto a couch.',
        'She turns and lets herself fall back onto the couch, settling into the cushions.'),
    '🚗 Lean against a car': ('SFW', 'A person leans back against the side of a car.',
        'She leans back against the side of the car and rests her weight against it, folding her arms.'),
    '📖 Read, curled up': ('SFW', 'A person is curled up reading.',
        'She sits curled in the chair holding a book, turning a page slowly.'),
    '😏 Bite lip and look over shoulder': ('SFW', 'A person glances back with a suggestive look.',
        'She rotates her torso and head together at the waist to look back over her shoulder toward the camera, catching her lower lip between her teeth while her hips remain facing away.'),
    '👗 Slow twirl in a dress': ('SFW', 'A person turns slowly to show a dress, pivoting on the spot.',
        'She stands facing the camera and turns slowly in a full 360-degree circle on the spot. Her torso leads the rotation, followed by her shoulders and head, the dress flaring out. She completes the turn and faces the camera again.'),
    '💋 Blow a kiss to camera': ('SFW', 'A person blows a kiss.',
        'She lifts her fingertips to her lips, then sweeps her hand out toward the camera in a slow blown kiss.'),
    '🛏 Stretch on a bed': ('SFW', 'A person stretches languidly on a bed.',
        'She reaches both arms up above her head and arches her back off the mattress in a slow stretch.'),
    '🍑 Walk away, glance back': ('SFW', 'A person walks away and glances back over the shoulder.',
        'She walks slowly away from the camera with her back fully to it. She then stops, rotates her torso and head together at the waist to look back over her shoulder at the camera while her feet and hips stay pointed away.'),
    '🧎 Kneel up and arch': ('SFW', 'A person kneels up and arches slightly.',
        'She rises up onto her knees and arches gently back, her hands sliding up her thighs.'),
    '💦 Lean back under water': ('SFW', 'A person leans back into water, hair slicking back.',
        'She tips her head back into the water, then lifts back up, water sheeting down her face and shoulders.'),
    '🫂 Bent-over hug over his lap': ('NSFW', 'A woman leans over a seated man to hug him, bending at the waist (torso down, facing away from him).',
        'She bends forward at the waist over his lap, lowering her upper body toward his legs while keeping her back straight. She wraps her arms around his neck or shoulders and holds the bent-over position.'),
    '💺 Sitting between his legs': ('NSFW', "A woman lowers herself to sit between a seated man's legs, Facing away from him, towards the camera.", "She steps between his spread legs, She turns away from him to look at the camera, and lowers her body to sit between his legs, with her back resting against his chest. she moves her hips in rhythmic circles as she sits on him."),
    '🪑 Lap sitting, facing him': ('NSFW', "A woman settles onto a seated man's lap, facing him directly (chest to chest).",
        'She steps over his thighs, turns to face him, and lowers her body to sit on his lap with her knees on either side of his hips and her arms resting over his shoulders.'),
    '🔃 Grinding on his lap': ('NSFW', "A woman grinds slowly while seated on a man's lap, facing him.", "Seated on his lap  both of her legs between his legs.  facing him, she keeps her upper body upright and moves her hips forward and back in a slow, steady motion."),
    '🧍 Pressed against a wall': ('NSFW', 'Two people pressed together against a wall.',
        'He moves her back against the wall and leans his body into hers as she lifts one leg to wrap around his hip.'),
    '🛏 Lying together, one behind': ('NSFW', 'Two people lie together, one curled behind the other.',
        'She lies on her side facing forward. He moves directly behind her and aligns his body with hers, chest to her back.'),
    '🔥 Missionary': ('NSFW', 'Explicit sex — missionary, penetration visible. She is on her back facing up toward him (facing the camera).',
        'She lies on her back facing up toward him, knees bent and open. He positions between her legs and drives his cock into her pussy in a steady rhythm.'),
    '🔥 Doggy': ('NSFW', 'Explicit sex — doggy from behind, penetration visible. She is on all fours facing away from him (facing the camera).',
        'She is on all fours facing away from him, her back to his chest and her face toward the camera. He grips her hips and drives his cock into her pussy from behind in a steady rhythm.'),
    '🔥 Cowgirl': ('NSFW', 'Explicit sex — cowgirl, her riding on top facing him (chest to chest).',
        'She straddles him facing him, lowers her pussy onto his cock, and rides in a rolling rhythm with her torso upright and facing his chest, her hands on his shoulders or chest.'),
    '🔥 Reverse cowgirl': ('NSFW', 'Explicit sex — reverse cowgirl, her riding facing away from him (back to his chest, facing the camera).',
        'She straddles him facing away from him, lowers her pussy onto his cock, and rides with her back to his chest. Her torso faces forward toward the camera while her hips roll and her ass rises and drops.'),
    '🔥 Spooning': ('NSFW', 'Explicit sex — side-lying, penetration from behind. She is facing the same direction as him (both facing camera or away together).',
        'She lies on her side facing forward, and he settles directly behind her. He pushes his cock into her pussy from behind while they stay spooned, his chest against her back.'),
    '🔥 Against the wall, standing': ('NSFW', 'Explicit sex — standing against a wall, penetration. She is facing him, back pressed to the wall.',
        'He presses her back flat against the wall so she is facing him directly. She wraps her legs around his waist and he drives his cock up into her pussy while holding her pinned to the wall.'),
    '🔥 Bent over a surface': ('NSFW', 'Explicit sex — bent over a surface, taken from behind. Her torso is down, ass up, facing away from him (toward the camera if applicable).',
        'She bends at the waist over the surface, torso lowered and ass raised, facing away from him. He grips her hips and drives his cock into her pussy from behind in a steady rhythm.'),
    '🔥 Mating press': ('NSFW', 'Explicit sex — mating press, deep penetration from above. She is on her back facing up toward him (facing the camera).',
        'She lies on her back facing up, knees pulled back toward her shoulders and feet in the air. He folds over her and drives his cock straight down into her pussy from above, pinning her legs back.'),
    '🔥 Oral (giving)': ('NSFW', 'Explicit — blowjob, sucking cock. She is kneeling in front of him, facing him.',
        'She kneels facing him, lowers her mouth over his cock, and bobs her head up and down in a steady rhythm while looking up at him.'),
    '🔥 Oral (receiving)': ('NSFW', 'Explicit — eating pussy, oral on her. She is on her back facing up (toward the camera), legs open.',
        'She lies on her back facing upward, thighs spread wide. He lies between her legs and licks her pussy in a steady rhythm while she presses her hips up toward his mouth.'),
    '🔥 Face sitting': ('NSFW', 'Explicit — sitting on his face, oral. She is facing his feet or the camera (specify facing).',
        'She lowers herself onto his face, straddling his head with her pussy directly over his mouth. She faces forward (toward his feet or camera) and grinds her hips in a slow circle against his tongue.'),
    '🔥 Standing oral': ('NSFW', 'Explicit — kneeling blowjob.',
        'She kneels in front of him and takes his cock into her mouth, sucking in a steady bobbing rhythm.'),
    '🔥 69': ('NSFW', 'Explicit — 69, mutual oral.',
        'She settles over him head to toe, taking his cock into her mouth while he licks her pussy, both rocking together.'),
    '🌸 Tribbing (F/F)': ('NSFW', 'Explicit F/F — tribbing, pussies grinding.',
        "One woman grinds her pussy down against the other's, the two rocking together in a building rhythm."),
    '🌸 Scissoring (F/F)': ('NSFW', 'Explicit F/F — scissoring, pussies grinding.',
        'They interlock their legs and grind their pussies together in a steady rocking rhythm.'),
    '🌸 Mutual oral (F/F)': ('NSFW', 'Explicit F/F — 69, mutual oral.',
        "They settle head to toe and each licks the other's pussy, both grinding down and rocking together."),
    '🌸 Fingering (F/F)': ('NSFW', 'Explicit F/F — fingering.',
        "She slides her fingers into her partner's pussy and works them in a steady rhythm as her partner's hips press up."),
    '🍑 Spooning (anal)': ('NSFW', 'Explicit anal — side-lying, penetration from behind. She is facing the same direction as him.',
        'She lies on her side facing forward, and he settles directly behind her. He pushes his cock into her ass from behind while they stay spooned, his chest against her back.'),
    '🍑 Doggy (anal)': ('NSFW', 'Explicit anal — doggy, penetration from behind. She is on all fours facing away from him (facing the camera).',
        'She is on all fours facing away from him, back to his chest. He grips her hips and drives his cock into her ass from behind in a steady rhythm.'),
    '🍑 Reverse cowgirl (anal)': ('NSFW', 'Explicit anal — reverse cowgirl, riding facing away from him (back to his chest, facing the camera).',
        'She straddles him facing away from him, lowers her ass onto his cock, and rides with her back to his chest. Her torso faces forward toward the camera while her hips move.'),
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
    """The additive activation block, injected on top of the user's prompt.
    Mirrors the environment block: an activation layer that supplies ARRANGEMENT
    and MOTION while the user's own words keep priority for identity/wardrobe/
    specifics. Returns '' when no scenario is selected.

    Key principle baked in: THE MODEL IS LITERAL — no write, no see. 

For positioning scenarios: describe the physical ACTION the person performs (steps between legs, turns torso, lowers hips to sit, etc.) using neutral spatial terms. Do not name the result of body contact ("ass against crotch", "pressing against him").

For explicit sex act scenarios: use direct anatomical language so the model actually renders the contact."""
    v = resolve_scenario(key, seed=seed)
    if not v:
        return ""
    tag, setup, choreo = v
    block = (
        "\u2501\u2501 SCENARIO \u2014 THIS IS THE ACTION OF THE CLIP (mandatory) \u2501\u2501\n"
        f"  Setup: {setup}\n"
        f"  Choreography to render: {choreo}\n"
        "This scenario is WHAT HAPPENS in the clip \u2014 the subject MUST perform this action with precise body orientation. "
        "It is not optional flavour. If an environment/location is also given, that is only WHERE this action takes place. "
        "CRITICAL — BODY ORIENTATION MUST BE EXPLICIT IN EVERY BEAT:\n"
        "- State exact facing relative to him and camera: 'facing him chest-to-chest', 'back fully to him and facing the camera', 'hips forward, upper body turned toward camera'.\n"
        "- Head/neck turn ONLY is forbidden. If she looks back or turns: she rotates her TORSO + shoulders + head together at the waist as one unit.\n"
        "- When facing away from the man: her back faces him; she faces the camera (unless the prompt says otherwise).\n"
        "- Describe the ACTION the person performs (she steps, she turns her torso, she lowers her hips, she sits) using neutral spatial terms. Do not describe the result of body contact (avoid 'ass against crotch', 'pressing against his', etc.).\n"
        "- When she turns to face him: describe the full torso rotation + weight shift.\n"
        "Use only short, direct, physical sentences with finite verbs. The model is literal.\n"
    )
    if tag == "NSFW":
        block += (
            "\u2501\u2501 EXPLICIT RENDER (mandatory for this scenario) \u2501\u2501\n"
            "This is an explicit sexual scene. The video model is LITERAL \u2014 it only renders what the "
            "words on the page name. Write the act plainly and anatomically: name the cock, pussy, ass, "
            "the penetration, the point of contact, the wetness \u2014 in EVERY beat. Do NOT soften it into "
            "'takes him in', 'joins with', 'moves together' or other coy phrasing; those render nothing. "
            "Show the explicit contact continuously across the whole clip: where the cock is, what it is "
            "doing, how deep, how fast, and the visible physical response (skin rippling, wetness, bodies "
            "impacting). Keep every named body part and action from the choreography above present on screen.\n"
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
    print(build_scenario_block("🫂 Bent-over hug over his lap"))
