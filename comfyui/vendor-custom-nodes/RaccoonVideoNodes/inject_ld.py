"""
inject_ld.py — turns the scenario/environment picklists into SHORT nudge blocks.

Deliberately light. The old node's env/scenario injection barked "beat 1 MUST /
every beat / RULES:" — that heaviness is exactly what over-cluttered the box.
Here the data is the same (ported from v2brain), but the injected prose is a
nudge, not a command. The user's own words still lead; these just bias setting
and arrangement so a vague box still renders well.
"""

try:
    from .scenarios_ld import resolve_scenario, scenario_is_explicit
    from .environments_ld import ENVIRONMENT_PRESETS, _ENV_RANDOM_POOL
except ImportError:
    from scenarios_ld import resolve_scenario, scenario_is_explicit
    from environments_ld import ENVIRONMENT_PRESETS, _ENV_RANDOM_POOL


def _resolve_env(env_key, seed=0):
    val = ENVIRONMENT_PRESETS.get(env_key) if env_key else None
    if val == "RANDOM":
        import random
        rng = random.Random(seed or None)
        val = ENVIRONMENT_PRESETS.get(rng.choice(_ENV_RANDOM_POOL))
    return val if isinstance(val, tuple) else None


def env_block(env_key, mode="t2v", seed=0):
    val = _resolve_env(env_key, seed)
    if not val:
        return ""
    loc = val[0] if len(val) > 0 else ""
    light = val[1] if len(val) > 1 else ""
    sound = val[2] if len(val) > 2 else ""
    if (mode or "").lower() == "i2v":
        # frame is truth — env is a gentle nudge, must not contradict pixels
        return ("━━ ENVIRONMENT (I2V — nudge only) ━━\n"
                f"If it fits the frame, lean the light and mood toward: {loc}. "
                "Never contradict what the image already shows.\n")
    return ("━━ ENVIRONMENT ━━\n"
            f"Setting: {loc}\n"
            f"Light: {light}\n"
            f"Sound bed: {sound}\n"
            "Place the action inside this location and let one visible detail of it show through the "
            "sections — the named light on skin, or a feature behind the subject. Don't let the setting "
            "replace the action.\n")


def scenario_block(scn_key, seed=0):
    v = resolve_scenario(scn_key, seed)
    if not v:
        return ""
    tag, setup, choreo = v
    block = ("━━ SCENARIO — the action of the clip ━━\n"
             f"Setup: {setup}\n"
             f"Choreography: {choreo}\n"
             "This is WHAT HAPPENS — the subject performs this. If an environment is also set, that's just "
             "WHERE it happens. The user's words still govern identity, wardrobe and look. Keep the motion "
             "continuous — one action per clause, in physical order, never teleporting.\n")
    if tag == "NSFW":
        block += ("Explicit: name the anatomy and the contact plainly (cock, pussy, ass, penetration) where "
                  "the choreography calls for it — coy phrasing renders nothing.\n")
    return block


def scenario_forces_explicit(scn_key, seed=0):
    """Picking an NSFW scenario turns the explicit gate on even if the typed prompt was tame."""
    try:
        return bool(scenario_is_explicit(scn_key, seed=seed))
    except Exception:
        return False
