"""LTX-safe camera moves — plain prose only, never shot-list notation."""

NONE = "None"

MOVES = {
    NONE: "",
    "Push in": "the framing creeps closer to the subject in one slow approach",
    "Pull back": "the framing eases away from the subject and opens the scene out",
    "Pan left": "the framing sweeps left across the scene from a fixed pivot",
    "Pan right": "the framing sweeps right across the scene from a fixed pivot",
    "Tilt up": "the framing angles upward",
    "Tilt down": "the framing angles downward",
    "Truck left": "the framing travels left, running parallel to the scene",
    "Truck right": "the framing travels right, running parallel to the scene",
    "Static hold": "the framing is nailed down and never drifts",
    "Handheld sway": "the framing breathes with a light handheld drift",
}

KEYS = list(MOVES.keys())


def bolt(move_key, pov=False):
    phrase = MOVES.get(move_key or NONE, "")
    if not phrase:
        return ""
    if pov:
        return (
            f"\nVIEW MOTION: {phrase}. A single unbroken move that runs the length of the "
            "clip. Word it as the view moving — the word 'camera' is banned. Carry the move "
            "forward in every beat.\n"
        )
    return (
        f"\nCAMERA MOVE: {phrase}. A single unbroken move that runs the length of the clip. "
        "Put a short camera clause in plain prose after the action line — no label notation "
        "(never 'PUSH IN · close-up'). State what the frame holds once the move settles.\n"
    )
