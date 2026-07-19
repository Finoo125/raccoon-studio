"""LTX-safe camera moves — prose only, never plan notation."""

NONE = "None"

MOVES = {
    NONE: "",
    "Push in": "the view pushes in slowly toward the subject",
    "Pull back": "the view pulls back slowly away from the subject",
    "Pan left": "the view pans smoothly left across the scene",
    "Pan right": "the view pans smoothly right across the scene",
    "Tilt up": "the view tilts up",
    "Tilt down": "the view tilts down",
    "Truck left": "the view trucks left alongside the scene",
    "Truck right": "the view trucks right alongside the scene",
    "Static hold": "the view stays locked off with no drift",
    "Handheld sway": "the view holds with subtle handheld sway",
}

KEYS = list(MOVES.keys())


def bolt(move_key, pov=False):
    phrase = MOVES.get(move_key or NONE, "")
    if not phrase:
        return ""
    if pov:
        return (
            f"\nVIEW MOTION: {phrase}. ONE continuous move for the whole clip. "
            "Describe as view motion — never 'the camera'. Restate the ongoing move each beat.\n"
        )
    return (
        f"\nCAMERA MOVE: {phrase}. ONE continuous move for the whole clip. "
        "After the action line, a short camera clause in plain prose — never label notation "
        "(no 'PUSH IN · close-up'). Say what the frame shows after the move lands.\n"
    )