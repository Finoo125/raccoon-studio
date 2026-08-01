"""
music.py — Music / Soundtrack presets for Raccoon Video Prompt

Each entry is a dense, LTX-friendly description of what the track sounds like,
how hard it drives the performance, what tempo the body moves against, how any
singing is delivered, and how the room carries the low end. Injected as its own
block so the model can lock motion and vocals to the music instead of guessing.

Shape matches scenarios/environments for consistency.
"""

MUSIC_PRESETS = {
    "None — LLM decides": None,

    "Classic Rock — driving guitars & pounding drums": (
        "Classic rock carries the room — wide electric guitars, drums hit square and hard, "
        "120-135 BPM locked into an anthemic stride. The pulse is heavy and forward-leaning; "
        "the downbeat arrives with mass, and the body answers it — footfalls, hip rolls and "
        "reaches all land on the beat. Any singing comes out rough-edged and wide open, the "
        "chorus half-shouted. Any garment that comes off is timed to drop on a downbeat. "
        "The sound is live and oversized, distortion and reverb smeared through the air."
    ),

    "Hip-Hop / Rap — heavy 808s & crisp hi-hats": (
        "Contemporary hip-hop and trap — 808s sitting low and long, hi-hats stuttering fast "
        "and bright, 130-145 BPM with a swing that bounces and still threatens. The sub is "
        "something the body feels first; movement comes back slow and weighted, the chest "
        "popping on each kick. Vocals, if any, are melodic and unhurried — half-sung hooks "
        "delivered with total confidence. The mix is tidy up top and enormous underneath."
    ),

    "Classical / Orchestral — sweeping strings & dramatic builds": (
        "An orchestra fills the scene — layered strings, brass with real weight, dynamics "
        "that drop to nothing and climb back, 60-90 BPM phrased in long unhurried arcs. "
        "The music trades tension for release; motion turns stately and theatrical, the "
        "large gestures timed to the swells and the body going still in the quiet bars. "
        "Singing, where it happens, is trained and unornamented — sustained notes, vibrato "
        "carrying the emotion. The sound is wide and reverberant, a hall rather than a room."
    ),

    "Electronic / EDM — pulsing synths & four-on-the-floor": (
        "EDM drives the space — a 128 BPM kick on every quarter, supersaws stacked wide, "
        "pads ducking under the kick, builds that stretch and drops that land. The beat is "
        "hypnotic and refuses to let up; movement is metric and exact, hips and body waves "
        "hitting each kick, everything freezing in the silence before the drop. Vocals are "
        "breathy processed toplines cutting over the top. The bass is loud enough to rattle glass."
    ),

    "Mainstream Pop — catchy hooks & bright production": (
        "Bright commercial pop — glossy synths, drums that snap, hooks engineered to stick, "
        "110-125 BPM, radio-clean. The groove plays light and flirtatious; motion turns "
        "performative, timing held back until the chorus, the gaze returning to the view "
        "again and again. Singing is bright, forward and certain — someone putting on a show. "
        "The whole thing feels like a warm night with every window down."
    ),

    "R&B / Soul — smooth grooves & sensual bass": (
        "Slow R&B — Rhodes piano warm and blurred, bass round and low, drums sitting far "
        "behind the beat at 80-95 BPM, close and unhurried. The pocket is deep and drags "
        "everything into it; the body sinks into the groove with long rolls and slow weight "
        "shifts. Singing is breath-heavy and decorated — runs, ad-libs, phrases trailing off. "
        "The sound is intimate and near, filling the space with low warm light."
    ),

    "Heavy Metal — aggressive riffs & double-kick drums": (
        "Metal tears through the scene — palm-muted guitars chugging, double-kick running "
        "flat out, 140-170 BPM, unrelenting. The energy is physical and unpolished; motion "
        "turns sharp and committed — hair thrown, movements snapping to the riff. Vocals "
        "come out screamed or growled with no restraint. The sound is saturated and loud "
        "enough to press against the chest."
    ),

    "Country — twangy guitars & storytelling swing": (
        "Country — acoustic and electric guitars with bite, drums riding a steady train "
        "beat, 100-120 BPM, warm and built around a story. The feel sits somewhere between "
        "front porch and outlaw; motion carries an easy swagger that rides the swing. "
        "Singing is warm and drawled, phrased like someone telling you something. "
        "The sound is plain-spoken and roadhouse loud."
    ),

    "Funk / Disco — groovy basslines & funky drums": (
        "Funk and disco — slap bass welded to tight drums, wah guitar stabbing on the "
        "offbeats, 105-120 BPM, a pocket that is impossible to sit still in. The groove "
        "pulls movement out of the body — hips, shoulders and footwork all landing inside "
        "it, loose and playful. Vocals are soulful with falsetto flying off the top. "
        "The sound is warm, punchy and completely alive."
    ),

    "Reggae / Dancehall — offbeat skank & deep bass": (
        "Reggae and dancehall — guitar skanking on the upbeat, bass rolling deep and long, "
        "70-100 BPM or the double-time dancehall bounce, relaxed but never letting go. "
        "Motion is loose through the hips and in no hurry, winding with the riddim. "
        "Vocals are melodic toasting with a patois lilt, or smooth singjay over the top. "
        "The bass is deep enough to travel up through the floor."
    ),
}

MUSIC_KEYS = list(MUSIC_PRESETS.keys())


def music_block(key: str) -> str:
    """Return the rich descriptive block for the selected music preset."""
    if not key or key not in MUSIC_PRESETS or MUSIC_PRESETS[key] is None:
        return ""
    return MUSIC_PRESETS[key]
