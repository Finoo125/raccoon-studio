"""
environments.py — Environment presets for the video prompt node.
Loaded once by the node. Edit here; the main node never needs touching.
"""

# Each value is either:
#   None                                 → LLM decides
#   "RANDOM"                             → picked at runtime by seed
#   (location, lighting, sound)          → injected into the system prompt
#   (location, lighting, sound, wardrobe) → same, plus a wardrobe note

ENVIRONMENT_PRESETS = {
    "None — LLM decides": None,
    "🎲 Random — seed picks": "RANDOM",

    # ── NATURAL ──────────────────────────────────────────────────────────────
    "🏖 Beach — golden hour": (
        "an open stretch of beach late in the day, low amber sun skimming across packed wet sand, "
        "thin surf sliding up the flat shore in uneven sheets of foam, "
        "the far horizon softened by sea haze, a tide line of shell fragments and dried weed, "
        "salt dried onto every exposed surface, the sand firm near the water and loose higher up",
        "warm sun coming in from the side, shadows drawn out long toward the dunes, "
        "an orange-gold cast overall with deep blue collecting in the wet troughs",
        "waves rising and dropping in sequence, spray driven across the sand with a hiss, "
        "gulls somewhere off, the hollow slap of a wave folding over on itself"),

    "🏔 Mountain peak — dawn": (
        "a bare summit at first light, the sky opening out below in all directions, "
        "thin cold air, grey-brown rock split into angular plates underfoot, "
        "rose and pale blue spreading from the east across a cloud layer far beneath, "
        "range after range receding to a faintly curved horizon, every breath visible",
        "hard dawn light from the east with nothing filling the shadows, "
        "purple shadow trailing from each ridge and outcrop, sky graded rose into blue",
        "wind arriving and dying in long gusts, deep quiet in the gaps, "
        "cold rock ticking as it contracts, a thin echo returning from the valley"),

    "🌲 Dense forest — diffused green": (
        "deep inside a forest, the canopy closed solid twenty metres up, "
        "light coming down in soft broken columns through stacked leaves, "
        "moss over everything at ground level, ferns knee-high filling the gaps between roots, "
        "standing water caught in root hollows throwing green light back upward, "
        "bark crusted with lichen and bracket fungus, the trunks stepping back into depth",
        "green-filtered light with no hard edge anywhere, an even fill dropping from the canopy, "
        "every surface carrying a reflected chlorophyll tint",
        "birdsong layered across several species, wind clearly moving the canopy but dead still at "
        "ground level, a dry leaf shifting out of sight, water running somewhere further off"),

    "🌊 Underwater — shallow reef": (
        "a shallow tropical reef, turquoise water clear for twenty metres, "
        "sunlight breaking through the moving surface into shifting caustic patterns, "
        "staghorn and brain coral massed below and slightly soft, "
        "small fish holding position against the current, everything moving on a slow surge",
        "caustics sliding over every surface from above, "
        "an overall high-key teal, the blue darkening as it drops away below",
        "muffled pressure, a steady column of bubbles, the distant drone of a boat hull, "
        "coral creaking as the current pushes through it"),

    "🌧 Rain-soaked city street — night": (
        "a city street soaked with rain at night, neon dragged across the wet asphalt "
        "in long distorted colour streaks, steam lifting out of the iron grates, "
        "islands of amber streetlight with darkness between them, traffic blurred behind, "
        "awnings shedding water, gutters running full",
        "neon bouncing back out of the puddles — red, blue, white, amber — "
        "a cool blue ambient underneath, warm sodium falling from overhead",
        "rain hissing steadily on pavement, traffic somewhere behind, "
        "wet tyres peeling off the road, footsteps ringing under an awning"),

    "🏜 Desert — midday heat": (
        "open desert at noon, bleached sand running out to a horizon with no relief in it, "
        "the air rippling with heat just above the ground, "
        "the sky a hard white-blue, no cloud, no shade, nothing to fix a distance against, "
        "the crust broken into geometric plates closer in",
        "sun straight overhead, harsh top-light with no shadow to soften it, "
        "a bleached palette — sand near white, sky white-blue, black under anything that blocks the sun",
        "silence, then wind, then silence again, fine grit skating across the crust"),

    "🌌 Night sky — open field": (
        "an open field under a completely clear night sky, grass running out to a dark horizon, "
        "the Milky Way laid overhead as a dense band of blue-white stars, "
        "no artificial light anywhere, the ground barely readable in deep blue-black",
        "starlight only, close to black at ground level, a faint blue-grey wash from the sky itself, "
        "the galactic core throwing a soft gradient you can actually measure",
        "crickets running in continuous layers, light wind through the grass, "
        "a frog somewhere out there, and the very large silence under all of it"),

    "🌁 Rooftop — city at night": (
        "a high rooftop at night, the skyline running away in every direction below, "
        "warm light rising off the streets like a second horizon, "
        "wind that only exists at this height, vent stacks and water tanks breaking up the flat roof, "
        "a parapet at the edge with the drop waiting past it",
        "city glow arriving from below as warm amber fill, cool blue overhead, "
        "anyone at the edge silhouetted against the lit towers",
        "the city's hum swelling and fading, wind, "
        "a siren climbing from far down and thinning out again"),

    "✈ Plane cockpit — cruising altitude": (
        "a cockpit at cruising altitude, the instrument panel laid out in amber and green, "
        "black sky past the windshield, stars sitting above the cloud deck, "
        "engine vibration and a low hum running under everything, "
        "oxygen mask clips and breaker rows picked out on the overhead panel",
        "panel glow coming up from below — amber dials, green readouts — "
        "the windshield contributing nothing but cold black, no natural light at all",
        "engine hum constant and all around, radio static between transmissions, "
        "pressurised air hissing from the vents, an occasional switch clicking over"),

    # ── INTERIOR ─────────────────────────────────────────────────────────────
    "🏠 Bedroom — warm evening": (
        "a warm bedroom in the evening, one bedside lamp throwing a pool of amber, "
        "the far corners left soft, bed linen creased where weight has been on it, "
        "curtains pulled against the dark outside, a glass of water on the nightstand",
        "warm tungsten from a single point at the bedside, falling off gently, "
        "an intimate amber close in and deep shadow past its reach",
        "rain on the window if it is raining, otherwise the city reduced to a low hum through the glazing, "
        "the bed taking weight, fabric sliding over fabric, "
        "a phone on the nightstand lighting once and going dark again, "
        "and breathing — its rhythm and depth — the only sound the room can claim as its own"),

    "🛁 Bathroom — steam and tile": (
        "a bathroom full of steam, a hot shower running behind frosted glass, "
        "white tile beaded with condensation, the mirror gone completely opaque, "
        "warm damp air thick enough to read in the light, a towel folded over the rail, "
        "soap residue tracked across the tile floor",
        "warm light diffused through frosted glass — soft, hazy, no hard edge anywhere, "
        "the steam itself carrying light from the inside",
        "shower hissing steadily behind the glass, water striking tile, "
        "a tap dripping slowly, everything echoing slightly in the tiled space"),

    "🪟 Penthouse — floor-to-ceiling glass": (
        "a high-floor penthouse with glass from floor to ceiling on two walls, "
        "the city laid out far below, the interior spare — low furniture in dark leather and pale stone, "
        "daylight pouring in off the glass wall, the room doubling back in the panes at certain angles",
        "daylight through glass — flat, cool, thinned by height and haze — "
        "and after dark the city supplying a continuous glow from underneath",
        "close to silence — thirty floors of distance flattening the city into a formless low frequency, "
        "the HVAC cycling just at the edge of hearing, glass creaking faintly when the wind loads it, "
        "ice settling in a glass, someone's breathing made loud by the quiet, "
        "and now and then the deep resonance of the building itself shifting"),

    "🎹 Jazz club — late night": (
        "a small jazz club late at night, low ceiling, exposed brick, "
        "a compact stage lit warm at the far end, tables packed tight against each other, "
        "a candle stub burning down on each one, smoke standing visible in the stage light, "
        "a bar down one wall with the bottles backlit",
        "warm tungsten washing the stage, candlelight filling in table by table, "
        "the corners and the upper walls left in deep shadow",
        "a trio at the far end — upright bass, brushed snare, tenor saxophone — working through a slow blues, "
        "the sax filling the room and bending off the end of every phrase, "
        "the bass walking the changes in a low steady pulse, brushes on the snare barely above breathing, "
        "a glass set down on the bar between phrases, conversation dropping away "
        "when the sax leans into a long held note"),

    "🚂 Train — moving through night": (
        "a train carriage running at night, the window showing dark country "
        "with scattered lights passing in rhythm, warm interior against the cold black outside, "
        "the carriage reflected and sliding across the glass, "
        "worn fabric on the seats, the whole thing swaying on a cycle",
        "warm interior tungsten set against a window that is pure black, "
        "the reflections layering over the dark country going past",
        "track clicking faster and slower through the curves, "
        "engine vibration coming up through the floor, the world outside dulled by glass"),

    "💊 Underground club — strobes and bass": (
        "an underground club at capacity, strobes cutting the dark in hard white intervals, "
        "bass arriving in the chest before the ear registers it, the crowd packed together in darkness, "
        "a DJ booth visible through smoke at the far end, colour wash sweeping low over everyone",
        "white strobe cuts, colour dragged through smoke — purple, red, blue — "
        "near black in between, faces caught and held for single frames",
        "bass at physical volume, the crowd functioning as one breathing mass of sound, "
        "and the particular compression of a room built to be this loud"),

    "🏢 Office — after hours": (
        "a corporate floor after hours, desks abandoned with personal effects still out, "
        "flat cold fluorescent laid evenly across the open plan, "
        "the city showing through floor-to-ceiling glass along one wall, "
        "and the specific quality of quiet a building takes on once everyone has gone",
        "flat cold fluorescent overhead, warm city glow through the glass, "
        "a clinical blue-white cast, long shadows thrown off the desk furniture",
        "air conditioning at a low frequency, an elevator moving somewhere, "
        "the silence of an empty building with exactly one person left in it"),

    "🚗 Car — moving at night": (
        "a car interior at night moving through a lit city, streetlights sweeping "
        "through the windows in a rhythm of amber and shadow, "
        "the dash instruments glowing warm from below, the city wet and smeared outside, "
        "the close interior smell of upholstery and warm electronics",
        "streetlights sweeping through the glass on a beat, "
        "warm dash glow from underneath, light and shadow travelling across every interior surface",
        "engine, tyres on a wet road, the city dulled by glass, "
        "a radio faint under all of it"),

    # ── ICONIC ───────────────────────────────────────────────────────────────
    "🏰 Big Ben — Westminster at night": (
        "standing right under the Elizabeth Tower on the Westminster Bridge approach, "
        "the lit clock face filling the top of the frame, floodlit limestone glowing gold "
        "against deep navy, the Thames past the stone parapet, "
        "black iron lampposts running away down the bridge, cabs and buses passing in soft blur",
        "warm sodium flood on the tower face, cold blue ambient above, "
        "wet stone throwing gold back up, the clock face acting as its own source",
        "Big Ben striking the quarter somewhere above, wind coming across the bridge, "
        "traffic crossing behind, footsteps on stone"),

    "🗼 Eiffel Tower — dusk": (
        "the Eiffel Tower seen from the Champ de Mars at dusk, warm iron lattice against a sky "
        "grading from rose-orange at the horizon to deep blue overhead, "
        "tourists soft in the middle distance, the tower's own lights not yet running, "
        "the Seine picking up sky colour far off",
        "a dusk gradient — warm amber-rose low down, cool indigo above — "
        "the tower lit from beneath by upward floods, long shadows off the iron feet",
        "the boulevard humming, wind crossing the open park, traffic at a distance, "
        "a tour guide somewhere, pigeons"),

    "🌃 Times Square — peak night": (
        "Times Square at full commercial night, LED and billboard covering every building face "
        "in overlapping colour — red, blue, the white of theatre marquees — "
        "yellow cabs stalled in gridlock below, phones up all through the crowd, steam off a subway grate, "
        "the compressed energy of a crossroads that never once goes dark",
        "artificial light only — not a single natural source in the frame, "
        "colour fields laid over each other: billboard red bleeding into neon blue bleeding into marquee white, "
        "every surface returning at least three colours at once",
        "horns locked in gridlock, crowd noise, the mechanical stutter of a WALK signal, "
        "a busker somewhere in it, and the compressed city sound that has nowhere left to go"),

    # ── NIGHTLIFE / ADULT ─────────────────────────────────────────────────────
    "💃 Strip club — main floor": (
        "a strip club main floor at peak hour, a raised chrome-poled stage close enough to touch, "
        "deep button-tufted velvet seating ringed around it, a long backlit bar glowing across the "
        "room, notes scattered along the stage edge, haze standing in the air",
        "magenta and deep blue stage wash pushing through the haze, a moving head sweeping slowly, "
        "UV strips under the stage lip catching legs and heels, everything outside the beams "
        "dropping away to nothing",
        "bass-heavy club music coming up through the floor, glasses ringing, a low "
        "crowd murmur, heels striking the stage in time"),

    "🔒 Private booth — POV": (
        "a small private VIP booth behind a heavy velvet curtain, a low leather bench at knee "
        "height in the lower view, dark suede padding close on three sides, "
        "a mirrored ceiling tile with its glow strip turned right down, a thin blade of club "
        "light leaking in at the curtain's edge",
        "one dim warm downlight straight overhead pooling on skin and leather, red LED trim "
        "at floor level washing everything crimson from below, the curtain gap flickering faint "
        "magenta with the lights outside",
        "the club's bass reduced to a deep muffled pulse through the walls, the curtain "
        "rings sliding once, breath and fabric suddenly very loud in the small padded space"),

    # ── BEACHES / OUTDOOR ─────────────────────────────────────────────────────
    "🌴 LA beach — Venice / Santa Monica": (
        "the Venice boardwalk spilling out onto wide flat sand late in the afternoon, "
        "the Pacific throwing hard silver-gold all the way to the horizon, palms lined up along the walk, "
        "skaters and cyclists soft on the bike path behind, "
        "the muscle beach frames further down, graffiti walls and vendor stalls the length of the boardwalk, "
        "a lifeguard tower in white and red, people scattered across the sand",
        "California sun late and low, coming in warm from the west over the water, "
        "shadows pulled long toward the buildings, everything backlit and rimmed, "
        "skin glowing, sunglasses catching flare, that specific amber-pink LA cast",
        "surf breaking on a regular beat, boardwalk crowd noise, "
        "a speaker somewhere playing hip-hop, skate wheels over concrete, "
        "gulls, laughter from a distance"),

    "🍹 Ibiza pool party — golden hour": (
        "an infinity pool at a cliff-edge villa in Ibiza late in the day, "
        "the Mediterranean deep blue below, whitewashed walls and terracotta underfoot, "
        "the pool running over its own edge into the view, a DJ set up under a white canopy, "
        "people in the water and stretched out on daybeds, champagne buried in ice, "
        "string lights strung up and still waiting on dusk, grill smoke drifting through",
        "low golden sun straight in from the west — hard, warm, every droplet catching it, "
        "skin lit and wet, the pool surface a moving sheet of gold, "
        "the white surfaces kicking light back as fill from every direction",
        "deep house from the DJ at conversation volume, water breaking, laughter, "
        "glasses meeting, wind coming in off the Mediterranean"),

    "🏄 Bondi Beach — bright midday": (
        "Bondi at midday from the promenade, looking down the whole crescent of sand, "
        "the water a hard turquoise with white breakers arriving in regular sets, "
        "hundreds of people on the sand, surfers out past them, the red and yellow flags planted, "
        "sandstone headlands closing each end, Norfolk pines down the promenade",
        "Australian midday sun straight overhead with nothing softening it, high UV, "
        "sand bleached close to white, the water almost too bright to hold in the eye, "
        "everything saturated and hard-edged",
        "surf landing in steady sets, crowd noise, a lifeguard whistle, "
        "someone's portable speaker, gulls fighting over chips"),

    # ── MOODY / CINEMATIC ─────────────────────────────────────────────────────
    "🕯 Candlelit loft — exposed brick": (
        "an open loft with brick walls and timber beams overhead, "
        "the only light coming from pillar candles massed on the floor, on shelves, on a low table, "
        "thirty or forty flames overlapping into pools of warm amber, "
        "a large bed with dark linen at the back of the space, "
        "a cast-iron tub standing free near the windows, "
        "tall industrial windows showing the city but hung with sheer fabric",
        "candlelight and nothing else — warm amber from many low sources, "
        "the flames working shadows slowly across the brick, "
        "the candles doubled in the dark window glass, deep shadow above the beam line",
        "flames guttering whenever a draught crosses them, the city faint through the glass, "
        "old timber creaking, fabric moving, "
        "and the particular quiet of a room lit only by fire"),

    "🚿 Rain shower — glass-walled bathroom": (
        "a large walk-in shower with glass on two full sides, "
        "one oversized head directly overhead dropping water straight down, "
        "steam filling the upper half of the enclosure, "
        "water running down the glass in unbroken sheets, "
        "dark slate on floor and walls, a warm LED strip recessed at floor level, "
        "a bench built into the back wall",
        "the floor-level LED strip throwing light upward through steam and falling water, "
        "the overhead diffused by the rain and mist, "
        "every edge softened, skin wet and picking up every source in the room",
        "the shower hissing straight down from overhead, enveloping and unbroken, "
        "water landing on slate, steam, breathing amplified by the glass"),

    "🪩 Hotel rooftop bar — city night": (
        "a rooftop bar on a good hotel, skyline standing behind it on three sides, "
        "the bar itself a long backlit slab of marble or onyx, cocktails part-built along it, "
        "low seating in velvet and brass grouped around fire pit tables, "
        "a small pool or water feature returning the city lights, "
        "well-dressed people around the edges, a DJ working from a minimal booth",
        "warm practicals from the bar, the fire pits and the string lights, "
        "the skyline supplying ambient behind all of it, "
        "the sky deep blue and never quite reaching black",
        "cocktail-bar sounds — shaker, ice, glass on marble, low conversation — "
        "deep house at low volume from the booth, wind at this height, "
        "the city underneath as one continuous hum"),

    # ── TRANSPORT ─────────────────────────────────────────────────────────────
    "🛥 Yacht deck — open ocean sunset": (
        "the aft deck of a motor yacht at sunset, teak underfoot, "
        "the wake running back white and straight to the horizon, "
        "open water in every direction — deep blue turning copper near the sun, "
        "the stern rail and a pair of loungers, champagne in a bucket lashed to the rail, "
        "spray reaching the lower deck now and then",
        "sun straight in over the stern — copper-gold, hard rim on everything facing aft, "
        "deep blue shadow on the forward side, the wake itself lighting up, "
        "skin lit warm from behind, faces filled in by reflected ocean",
        "engine vibration through the deck, wind, the hull opening the water, "
        "turbulence trailing behind, a halyard knocking somewhere"),

    "🏎 Supercar interior — night drive": (
        "the inside of a low supercar at night — Lamborghini, McLaren, that class — "
        "the cockpit tight and low, carbon on the dash and centre console, "
        "the cluster glowing amber behind a flat-bottomed wheel, "
        "city lights drawing out into streaks through the shallow windshield, "
        "ambient LED running cool blue along the door sills",
        "cluster glow up from below in warm amber, "
        "cool blue LED along the sills, "
        "city light pulsing through the glass on a rhythm set by speed",
        "the engine note — a high mechanical scream sitting behind and below the seats, "
        "tyres on asphalt, wind noise loading up with speed, "
        "the turbo spooling between shifts, the city dopplering in and back out"),

    # ── RAW / GRITTY ─────────────────────────────────────────────────────────
    "🏨 Cheap motel room — neon through blinds": (
        "a single motel room at night, a queen bed under a thin patterned spread, "
        "wood-veneer furniture, a CRT on the dresser, venetian blinds at the window "
        "laying horizontal neon stripes — red and blue — across the bed and the far wall, "
        "the bathroom door ajar on hard fluorescent, a bag dropped on the floor",
        "neon coming through the blinds in alternating red and blue bands, "
        "bathroom fluorescent escaping through the gap as one cold stripe, "
        "headlights crossing the ceiling at irregular intervals",
        "the sign buzzing outside the window, the ice machine humming through the wall, "
        "highway traffic at a distance, a door closing hard somewhere in the building"),

    "🏚 Abandoned building — daylight": (
        "a derelict industrial building in daylight, the roof partly down and dropping shafts of "
        "dusty light onto rubble, broken window frames with weeds growing through them, "
        "paint peeling back through old industrial layers — "
        "blue-grey, oxide red, institutional cream — graffiti stacked over graffiti on the far wall, "
        "a collapsed ceiling section heaped in plaster and rebar across the middle of the floor",
        "direct light falling through the holes in the roof and the broken windows, "
        "dust suspended in every shaft, the corners and everything under the debris left dark, "
        "hard contrast between the lit shafts and the space around them",
        "wind coming through the broken windows and working loose metal into intermittent creaks, "
        "water dripping somewhere, pigeons up in the roof space, "
        "and the specific silence of a large building nobody has entered in years"),

    # ── ASIAN LOCATIONS ───────────────────────────────────────────────────────
    "🌸 Tokyo Shibuya — night rain": (
        "the Shibuya crossing at night in light rain, the intersection standing empty between changes "
        "then filling from every direction at once, "
        "the 109 building and the Q-Front façade solid with LED advertising, "
        "the wet crossing stripes returning every colour, umbrellas scattered through the crowd, "
        "the pedestrian countdown running on a corner post",
        "artificial light only — warm streetlamps set against cold LED billboard blue, "
        "every wet surface doubling every source, the crowd reading as a moving mosaic of backlit umbrellas",
        "the surge of foot traffic the moment the crossing changes, umbrella fabric, "
        "rain on pavement, J-pop leaking out of a shopfront, the crossing signal"),

    "🏯 Kyoto — bamboo grove": (
        "the Arashiyama bamboo grove, a path cut through stands so dense "
        "the canes read as one continuous vertical texture fifteen metres up, "
        "green-filtered light dropping in soft broken shafts, "
        "the path stone-paved and slightly wet, tourists far off but this stretch quiet",
        "green-filtered light with the canopy behaving like an enormous silk softbox, "
        "a soft fill with no direction and no hard shadow, everything carrying reflected green",
        "bamboo knocking and creaking against itself in the wind above, "
        "the wind itself audible as one collective rustle through thousands of leaves, "
        "footsteps on stone, a temple bell somewhere off"),

    "🌆 Seoul rooftop — dusk": (
        "the roof of a mid-rise in a residential Seoul neighbourhood at dusk, "
        "water tanks and vent boxes, a few potted plants gathered in one corner, "
        "the city running out to every horizon below, apartment towers lighting up window by window, "
        "the Han a faint dark band in the middle distance, "
        "two folding chairs and a small table that were being used a moment ago",
        "dusk with the last directional light gone, the sky graded deep rose into cool indigo overhead, "
        "warm amber lifting off the city below like a second horizon, "
        "a stair-access lamp supplying the only warm key",
        "the city humming from underneath, wind at roof height, "
        "a siren absorbed into traffic, a laundry line creaking on its wire"),

    "🌸 Cherry blossom park — midday": (
        "a park with the cherry trees fully out, "
        "petals coming down continuously in the light wind, "
        "a stone path running through, wooden benches set along it, "
        "other people soft at the edges — couples, families — "
        "the blossom dense enough overhead to read as a ceiling, "
        "petals piling into drifts against the kerb",
        "light filtered down through the blossom — soft pink-white with no direction to it, "
        "everything in frame lit from above through petals, "
        "no hard shadow anywhere, skin luminous in it",
        "wind through the blossom as one soft collective rustle, "
        "petals landing with almost no sound at all, "
        "park noise softened by the canopy, someone laughing"),

    # ── POV-SPECIFIC INTERIORS ────────────────────────────────────────────────
    "🛋 Living room — late night tv": (
        "a living room late at night, sofa and coffee table in the foreground, "
        "a large TV working as the only light source and throwing a shifting blue-grey across the room, "
        "the remote and a half-empty glass on the table, curtains drawn, "
        "the rest of the room dark except where the screen happens to catch a surface, "
        "the particular stillness of a house where one person is still awake",
        "the screen as sole key — cool blue-grey, flickering with whatever is playing, "
        "falling off hard into darkness at the edges of the room, "
        "and doubled as a bright point in the glass on the table",
        "TV audio low — voices and music from somewhere else entirely, "
        "the room's own silence sitting underneath it, the building settling now and then, "
        "rain if it happens to be raining"),

    "🛏 Bedroom — intimate low light": (
        "a bedroom at night with the bed taking up most of the room, "
        "one bedside lamp on one side filling the space with warm amber, "
        "the other side of the bed left in soft shadow, curtains shut, "
        "the room reduced to its essential geometry — the bed, and two people on it, "
        "clothes on the floor, the specific disorder of a room in use",
        "one warm bedside lamp — amber, soft, coming from one side, "
        "filling the pillow side and letting the shadow deepen toward the far edge, "
        "the ceiling almost entirely dark",
        "the room quiet in the way a bedroom is quiet, curtains and soft furnishing absorbing everything, "
        "own breath, their breath, the bed taking weight, "
        "the city faint or nothing at all"),

    "🚗 Parked car — night": (
        "the inside of a parked car at night — any model, the geometry is the same — "
        "front headrests in frame, the windscreen showing a car park or a quiet street beyond, "
        "sodium light coming through the glass in amber bands across the seats, "
        "the rear-view catching a strip of whatever is behind, "
        "condensation starting on the inside of the windows, "
        "the confinement of an engine-off cabin while the world keeps going outside it",
        "sodium through glass in warm amber stripes over every interior surface, "
        "cut across by passing headlights sweeping the cabin, "
        "the dash unlit, everything amber or shadow",
        "the engine ticking as it cools, city noise dulled by the glass, "
        "the sealed acoustic of a car interior, own breath, "
        "rain on the roof if the weather calls for it"),

    "🚕 Taxi back seat — city at night": (
        "the back seat of a moving cab at night, the driver visible past the divider, "
        "city lights running past the side windows, "
        "the meter or a phone mount up on the dash, "
        "the body leaning slightly with acceleration and through the corners, "
        "the anonymous half-privacy of the back of a cab",
        "city light through the side windows in fast sequence — "
        "amber, white, neon, shadow, amber again — "
        "the driver's silhouette cut out against the windscreen glow",
        "engine and transmission, traffic outside, "
        "the driver's radio kept low, the physical lean through each corner, "
        "the particular suspension of a cab at city speed"),

    "🏨 Hotel room — quality": (
        "a decent hotel room, king bed under pressed white linen, "
        "a large window with the curtains part open on a city view at night, "
        "the furniture precise and impersonal — every object exactly where it was assigned — "
        "a minibar, a desk, the bathroom door standing open on tile and chrome, "
        "the room lit to a warm neutral and ready for whatever the night turns out to be",
        "overhead dimmed to warm amber, city glow coming through the curtain gap "
        "as a cooler second source, bathroom fluorescent laying a white stripe through the open door, "
        "the window supplying a deep blue backdrop",
        "air conditioning humming — constant, the fundamental frequency of hotel rooms, "
        "the city dulled by the glazing, the close silence of a soundproofed space, "
        "the particular quality of hotel quiet"),

    "🪩 Club private booth — VIP": (
        "a private VIP booth in a nightclub, curved seating in dark leather, "
        "a table with bottle service on it — ice bucket, glasses, the markers of the night — "
        "the main floor visible over a low partition, "
        "the booth raised slightly above it, bass physical off the system, "
        "neon and strobe arriving from the floor in pulses, "
        "the half-privacy of a space that is inside the room and watching it at the same time",
        "a table candle or an LED in the ice bucket as the close warm source, "
        "club light reaching the booth as coloured pulses — "
        "purple, cyan, amber cycling round — "
        "strobe catching faces on the floor below in freeze-frames",
        "bass as a physical presence and the dominant sensation in the room, "
        "crowd noise washing in from the floor, "
        "conversation conducted at shouting distance, bottles on the table"),

    "💆 Massage table — face down": (
        "a professional treatment room, white linen over a padded table, "
        "the face cradle right there — the circular view of the floor through it, "
        "candle or oil-lamp light warm and low, "
        "essential oil implied by the visual calm of the place, "
        "and the specific vulnerability of lying face down in this particular context",
        "candle or low lamp filling the room warm amber, "
        "soft and without direction — nothing casting a hard shadow — "
        "the face cradle vignetting the floor below into a circle",
        "spa music distant and soft, "
        "oil sounds, the practitioner's breath, the table adjusting under weight, "
        "and the particular silence that gathers around this kind of care"),

    # ── WTF / EXTREME ENVIRONMENTS ────────────────────────────────────────────
    "✈️ Skydive — open door at altitude": (
        "inside a small jump aircraft at altitude with the door standing wide open, "
        "the interior stripped back to bare metal and webbing, "
        "the roar at the door consuming everything else, "
        "other jumpers in silhouette ahead of it against blue-white sky, "
        "the ground visible through the opening as a patchwork impossibly far down, "
        "the airframe shaking with engine and airflow",
        "daylight flooding in through the open door — hard and brilliant, "
        "the interior reading dark against it, "
        "the jumpers silhouetted on a blown-out exterior",
        "the door's roar — overwhelming, physical, everything else swallowed by it, "
        "own heartbeat in own ears, the instructor shouting a final check, "
        "and then the jump"),

    "🪂 Paragliding — soaring": (
        "hanging in harness under a paraglider wing at altitude, "
        "the fabric overhead at the edge of the frame — "
        "cells and lines visible above and behind, "
        "the valley completely open below, "
        "mountains sitting at eye level to either side, "
        "the horizon running far enough to show the curve of the earth, "
        "and no sound but wind",
        "open sky light, brilliant from above, "
        "the sunlit valley below acting as a second diffused source coming up from underneath, "
        "the wing's shadow crossing own hands on the brake toggles now and then",
        "wind in the lines as a tone that shifts with airspeed, "
        "the fabric talking whenever a gust loads it, "
        "own breath, and nothing else whatsoever"),

    "🌊 Big wave surfing — tow-in": (
        "the face of a very large wave, water moving fast around the board, "
        "the face standing up as a vertical wall of green-black above and to the right, "
        "the bottom of the wave rushing up as the board drops into it, "
        "spray tearing off the lip high overhead, "
        "the horizon tilted hard over, the weight of the water obvious in every surface",
        "the wave itself supplying the light — translucent green-black, "
        "backlit where it thins, opaque and dark where it stacks, "
        "spray catching the sun in prismatic bursts along the lip",
        "the sustained roar of moving water, a sound with no equivalent, "
        "the board humming up through the feet, "
        "own breath fast and held under control, "
        "the lip beginning to fold and thundering over the top"),

    "🏔 Base jump — cliff edge": (
        "standing on the edge of a cliff or a building with a base rig on, "
        "the drop opening out below and ahead as pure air, "
        "the landing zone a small rectangle a long way down, "
        "wind moving around the body at this height, "
        "the lip of the surface underfoot at the bottom of frame, "
        "the last moment before it becomes irreversible",
        "open sky straight ahead — brilliant and enormous, "
        "the ground below reduced to texture by distance, "
        "the edge itself picking up the light",
        "wind, constant and physical, "
        "own heartbeat audible, own breath deliberate and measured, "
        "and the silence before the step"),

    "🌋 Volcanic landscape — active": (
        "a lava field on an active volcano, "
        "black basalt running out to a glowing horizon, "
        "live flow visible as orange-red rivers of light close and mid-distance, "
        "sulphur steam lifting out of vents in pale plumes, "
        "the ground hot through the soles, "
        "the sky held at a permanent dusk-orange even at night by the glow",
        "the lava as the key light — warm orange-red arriving from below and ahead, "
        "everything lit from an angle daylight never produces, "
        "steam plumes lit from underneath, the sky stained copper",
        "the low constant roar of moving lava, like a very deep river, "
        "rock cracking as it cools and contracts, "
        "sulphur implied by everything you can see, "
        "steam hissing out of the vents"),

    "🏎 Racing circuit — in car": (
        "inside a race car on track, "
        "the cockpit tight and stripped, roll cage overhead, "
        "the circuit arriving through a helmet visor, "
        "apex markers appearing and gone, "
        "the wheel loading up hard as the braking points come at you, "
        "the car moving fast enough that the track geometry reads as a problem to be solved",
        "whatever light the track has, filtered through a visor, "
        "the wheel's LEDs supplying close ambient, "
        "tyre smoke and tarmac dust catching light through the corners",
        "the engine at racing revs, a scream pitched to effort, "
        "tyres squealing right at the limit, "
        "the pit wall crackling through on the radio, "
        "brake heat and aero noise stacking together"),

    "🚁 Helicopter — open door": (
        "hovering in a helicopter with the door slid open, "
        "the skid at the bottom edge of frame, the city or the landscape directly below through the gap, "
        "the rotor beating overhead as a physical rhythm, "
        "the horizon held at a fixed altitude, "
        "everything below available in one unobstructed downward look",
        "open sky pouring in through the door, "
        "rotor shadow sweeping the interior on a beat, "
        "the landscape below in full natural light through the opening",
        "rotor noise as the defining sound, physical and rhythmic, "
        "wind through the open door, "
        "the pilot's voice arriving over headset, "
        "the airframe vibrating underneath all of it"),

    "🌊 Underwater — deep": (
        "diving deep, past recreational limits, "
        "the light from above thinning to a dim blue-green column, "
        "the surface a bright disk shrinking with every metre, "
        "nothing below but darkness grading into black, "
        "own torch the only local light, "
        "and the extreme quiet that comes with pressure",
        "the surface column above as the only natural source, "
        "own torch cutting a cone of warm white through cold blue, "
        "the dark below behaving like a presence rather than an absence",
        "the regulator enormous in this silence — the loudest thing in the world, "
        "bubbles going up, "
        "the absolute quiet of deep water pressing in around it, "
        "own heartbeat"),

    "🎢 Rollercoaster — first drop": (
        "front row of a coaster at the top of the first drop, "
        "the track falling away steeply ahead and below, "
        "the park visible in every direction from up here, "
        "the click-and-hold at the apex, "
        "and then the release forward and down",
        "open sky behind and above, brilliant, "
        "the track ahead running down into the park as a ribbon, "
        "the frame about to pitch hard forward",
        "chain click and hydraulics at the top, "
        "crowd noise coming up from a long way below, "
        "then the release — wind, and screaming including one's own"),

    "🏙 Abandoned skyscraper — upper floor": (
        "a high floor of an abandoned or unfinished tower, "
        "floor-to-ceiling openings with no glass in them yet, or none left, "
        "the city spread in every direction with nothing at all in between, "
        "wind entering at building speed, "
        "bare concrete underfoot, the skeleton's geometry fully exposed, "
        "cloud sitting at eye level or slightly under it",
        "open city light arriving from all sides — the 360-degree light of altitude, "
        "no shadows except off the structural columns, "
        "cloud supplying a shifting diffuse ceiling when there is any",
        "wind at this height as a sustained roar that changes with the gusts, "
        "the city far below reduced to a continuous low wash, "
        "and the building itself moving — barely, but physically"),

    "🚤 Speedboat — open water at speed": (
        "the bow of a speedboat running fast over open water, "
        "the nose lifting and slamming, spray thrown out both sides, "
        "the horizon ahead clean and empty, "
        "the wake visible back over one shoulder, "
        "the boat's motion turning standing up into an argument with inertia",
        "open water light, brilliant overhead, "
        "spray catching the sun as prismatic curtains on both sides, "
        "the wake behind lighting up as a white line laid across blue",
        "engine roar, constant and high, "
        "the hull slapping down on every wave, "
        "spray, "
        "and wind at this speed consuming everything else"),

    # ── STRIP CLUB / INTIMATE DANCE ───────────────────────────────────────────
    "🪑 Strip club — private booth": (
        "a private booth off the main floor, curved dark leather seating in a U, "
        "a small table, the main floor visible through a gap in the curtain or the partition, "
        "bass from outside carried through the seating and the floor, "
        "a single overhead in the booth dimmed almost to nothing, "
        "the space defined entirely by its enclosure — close walls, low ceiling, the world cut down to this, "
        "a bottle and glasses on the table marking how long it has been",
        "close to darkness in the booth, only ambient spill from the main floor "
        "coming through the partition gap as a warm stripe, "
        "the performer lit by whatever manages to reach her from outside, "
        "everything low-contrast, the room darker than is comfortable",
        "bass from the main floor, muffled but present, felt as much as heard, "
        "the music barely identifiable through the booth walls, "
        "her breath close in the near-silence inside, "
        "own breath, and the leather of the seating"),

    "🌙 Strip club — VIP room": (
        "a dedicated VIP room away from the main floor, "
        "an actual room with a door that shuts, "
        "a large sofa or a seating arrangement, "
        "the lighting controlled and deliberate — warm and low, "
        "a bar setup in the corner, art on the walls that nobody will look at, "
        "the room built to feel expensive and private at the same time, "
        "the sound from outside cut dead by the door",
        "controlled warm amber dimmed to intimacy, "
        "one brighter source over the performance area, "
        "the room's own light rather than borrowed stage wash, "
        "skin held in a warm low fill",
        "music piped in at background level — present without taking over, "
        "the room's own quiet around it, "
        "and her movement now audible — fabric, footstep, breath — "
        "everything the main floor volume would have buried"),

    "🎪 Burlesque venue — seated table": (
        "an intimate burlesque room or cabaret, small tables each with a candle, "
        "a modest stage at one end raised slightly off the floor, "
        "the audience close enough that there is no back row, "
        "red velvet and dark wood, chandelier light warm and theatrical, "
        "champagne and cocktails on the tables, "
        "an audience actually watching rather than just consuming",
        "the table candle as the close warm source, "
        "theatrical stage lighting with a warm amber key, "
        "a slight haze in the air picking up the stage beams, "
        "the chandelier filling in warm at a low level",
        "live music where it applies — a band or a pianist, and the audible difference from a recording, "
        "applause close and immediate at moments, "
        "the performer's voice and performance sounds clearly readable at this range, "
        "candle flame moving, ice in a glass"),

    # ── POV ENVIRONMENTS WITH WARDROBE ────────────────────────────────────────
    "🏢 Office romance — after hours": (
        "an open-plan office at night, desks and monitors in rows, "
        "the city through floor-to-ceiling glass, the overhead fluorescents down "
        "to half, one desk lamp on as the only warm source, "
        "the particular quiet of an office that ought to be empty and is not, "
        "paperwork and coffee cups, a jacket left over a chair",
        "half-dimmed cool white overhead, one warm desk lamp, "
        "city glow through the glass as a second blue source, "
        "monitors throwing intermittent light",
        "air conditioning humming, constant, the fundamental frequency of an office building at night, "
        "traffic distant through the glass, a chair creaking, "
        "and the specific silence of a building holding two people who should not be in it",
        "she is in office clothing — fitted shirt part undone, pencil skirt, heels. "
        "Professional wardrobe in progressively worse order as the scene runs."
    ),

    "🚀 Space launch — cockpit POV": (
        "inside a launch vehicle cockpit or capsule, instrument panels covering every surface, "
        "small portholes showing the gantry outside, "
        "the tower still attached, pale blue sky past it, "
        "crew strapped into harnesses, mission patches on the suits, "
        "countdown displays running, vibration already building through the seat",
        "functional cockpit lighting — amber instruments, status LEDs in green and red, "
        "hard daylight through the portholes standing in sharp contrast against the dim interior, "
        "warning lights throwing intermittent colour",
        "the pre-launch soundscape — systems humming, "
        "mission control on the loop, the count running underneath, "
        "then ignition — a bass rumble that becomes a roar that becomes the only thing there is, "
        "G-force loading up through the seat",
        "full flight suit, visor up or down, mission patches, "
        "harness webbing across the chest. Everyone is in identical gear."
    ),

    "🌌 Space station — zero gravity": (
        "the inside of a station module, a cylindrical corridor lined with equipment panels, "
        "handrails running its full length, "
        "a porthole showing the curve of Earth below and stars past it, "
        "loose objects adrift — a tablet, a pen, a food packet moving slowly through the air, "
        "the particular cramped intimacy of a pressurised vessel in orbit",
        "no light direction at all — fluorescent panels overhead, "
        "Earth arriving through the porthole as a shifting blue-white source, "
        "equipment LEDs as small coloured accents",
        "life support humming — constant, layered, never once absent, "
        "comms traffic, the soft knock of drifting objects finding a surface, "
        "and the enormous silence sitting past the hull",
        "flight suit or station utility wear — close-fitting layers, "
        "velcro patches everywhere for attaching things, "
        "nothing loose enough to drift into equipment."
    ),

    "🏥 Hospital room — night shift": (
        "a private hospital room at night, one bed, monitoring equipment, "
        "an IV stand, the door open just enough to show a lit corridor, "
        "a visitor's chair pulled up close to the bed, "
        "the particular vulnerability of a room designed around recovery",
        "the overhead fluorescent off and only the warm bedside lamp on, "
        "monitors casting a faint blue-green, "
        "corridor light coming through the door gap as a stripe",
        "monitors beeping on a rhythm that never varies, "
        "corridor sounds at a distance, a trolley somewhere, "
        "the building's own institutional silence underneath",
        "patient in a hospital gown — open-backed, thin cotton. "
        "Visitor in whatever they were wearing when they rushed here — casual or work clothes."
    ),

    "🎓 University library — closing time": (
        "a large university library late at night, nearly empty, "
        "high ceilings on wooden beams, reading lamps on individual tables, "
        "rows of shelving running back into darkness, "
        "open books and laptops left scattered, "
        "and the last two people who did not notice it was closing",
        "reading lamps as isolated warm pools on dark tables, "
        "exit signs supplying red accents in the dark, "
        "the shelving past each lamp pool dropping to almost nothing",
        "total silence — the specific silence of a library that has emptied out, "
        "a door somewhere far off, "
        "a wooden chair creaking, pages turning",
        "student casual — hoodies, jeans, comfortable layers for a long session. "
        "The kind of clothes you stop noticing you have on."
    ),

    "💋 Backstage — dressing room": (
        "a performer's dressing room backstage, mirrors ringed with bulbs, "
        "makeup across every surface, a costume rail hung several deep, "
        "the show audible through the walls as a muffled roar, "
        "a door with a star on it, a chair pulled up to the lit mirror, "
        "the particular charge of the minutes either side of a performance",
        "mirror bulbs — warm and numerous, filling in every shadow there is, "
        "the most flattering light that exists, skin luminous under it, "
        "no shadows at all, everything warm and gold",
        "the show coming through the walls as bass and sensation rather than music, "
        "own breath afterward, the costume rail creaking, "
        "somebody knocking at the door",
        "performer in stage costume or mid-change — "
        "sequins, feathers, minimal stage wear, or partway out of it. "
        "Stage makeup on, hair set. The costume is part of the character."
    ),

    "🏊 Pool — late night private swim": (
        "an indoor pool after hours, the building dark apart from the underwater lights, "
        "blue-green rippling across the ceiling and the walls, "
        "the chemical smell of chlorine implied by everything you can see, "
        "an Olympic-length pool lit from inside itself, "
        "the ladder at the near end, towels dropped on a bench, "
        "complete privacy — nobody else is here",
        "underwater LEDs as the only source — cool blue-green, "
        "ripple patterns moving across every surface, skin included, "
        "nothing overhead at all, everything lit from below and within",
        "water sounds amplified by the echoing space — "
        "drips, laps, the filter running, "
        "own breath in the tiled acoustic, "
        "and the particular silence of a large indoor space at night",
        "swimwear — or nothing at all. "
        "A private late-night swim runs on its own wardrobe rules."
    ),

    "🎪 Circus tent — after the show": (
        "a big top after the last performance, "
        "rigging and aerial equipment still hanging overhead, "
        "sawdust underfoot, the tiered seating empty and dark, "
        "one spotlight still burning in the ring, "
        "canvas and sawdust in the air, "
        "props and apparatus standing about in the shadows",
        "the ring spot as the only source — a hard white cone on the sawdust, "
        "everything outside it dropping to almost nothing, "
        "performers caught on the line between the light and the dark",
        "the tent settling, canvas moving with the wind, "
        "crew voices outside as they pack up, "
        "and the particular quiet that follows a crowd out",
        "circus performer wear — leotard, sequins, aerial costume, "
        "or the informal layers thrown over it once the show is done. "
        "Theatrical and physical."
    ),

    "🌃 Rooftop pool — hotel, midnight": (
        "a rooftop infinity pool on a high hotel floor, "
        "the skyline standing in every direction, "
        "the pool's edge appearing to run straight into the city below, "
        "loungers along its rim, a bar off to one side, "
        "steam lifting off the heated water into cold night air",
        "city glow lifting the sky to a deep blue-purple, "
        "underwater lights pushing blue-white up through the water, "
        "the pool edge lit from beneath as a glowing line against the city",
        "the city humming far below — traffic and sirens flattened by distance, "
        "water moving, the filter system running, "
        "and the particular silence that comes with height",
        "swimwear — upscale resort. "
        "A hotel rooftop pool at midnight has a specific clientele and a specific look."
    ),

    "🏋 Gym — private session after hours": (
        "a commercial gym after closing, equipment standing in rows, "
        "mirrors on every wall, rubber underfoot, "
        "the fluorescents running at half power, "
        "and the particular intimacy a space built for physical effort takes on "
        "when there are only two people in it",
        "half-power fluorescent — functional and a little harsh, "
        "the mirrors multiplying every source in the room, "
        "equipment LEDs as small accents",
        "equipment humming — treadmills winding down, "
        "the ventilation running, "
        "and the specific echo of a large tiled space with no crowd in it",
        "gym wear — fitted, functional, built for sweat. "
        "Leggings, sports bra, training shorts. "
        "The practical clothing of physical work."
    ),

    "🎸 Recording studio — late session": (
        "a professional studio late at night, "
        "the control room with its desk and monitors, "
        "acoustic treatment covering every wall, "
        "the live room visible through the glass, "
        "no city and no windows — no outside at all, "
        "the particular sealed world of a studio at two in the morning",
        "soft studio lighting on dimmers, "
        "desk metering glowing constantly, "
        "monitor screens, "
        "and the red ON AIR light",
        "monitors playing the track back at low volume, "
        "the talkback clicking in and out, "
        "and the extreme isolation of a professional room — "
        "the city does not exist in here",
        "studio casual — whatever you wear into hour fourteen. "
        "Comfortable layers, headphones round the neck, "
        "the informal uniform of creative work."
    ),

    "⛪ Church — empty, afternoon light": (
        "a large empty church in the afternoon, "
        "a long nave lined with wooden pews, "
        "stained glass dropping coloured light in columns, "
        "the altar at the far end, "
        "candles burning at a side chapel, "
        "and the particular stillness of a sacred space between services",
        "afternoon light through stained glass — deep columns of red, blue and gold "
        "falling across stone floor and pews, "
        "candles flickering at the side chapel, "
        "no electric light required at all",
        "profound silence, stone and wood absorbing everything, "
        "traffic outside completely gone, "
        "a pigeon up in the rafters, "
        "footsteps on stone coming back off the walls",
        "visitor clothing — respectful, or pointedly not. "
        "The contrast between the space and what happens in it "
        "is part of the scenario."
    ),

    "POV — 🔥 Backroom — she is topless": (
        "a private backroom off a strip club or adult venue, "
        "darker and closer than the main floor, "
        "a low couch or padded bench, dim red or pink light, "
        "bass from the main room arriving through the walls and the floor, "
        "no stage — just a small private space and two people in it",
        "very low red or pink ambient, intimate and close to dark, "
        "one dim overhead or a strip light, "
        "skin picking up whatever light there is",
        "bass from the main floor constant through the walls, felt more than heard, "
        "her breath close, "
        "and the particular muffled acoustic of a private room built for this",
        "she is topless — wearing only panties, a thong, or minimal bottoms. "
        "That is already the established starting state. "
        "Camera at seated height. She is the subject and she is close."
    ),

    "POV — 💃 Lap dance — she strips as she dances": (
        "a private booth or lap dance area, "
        "one chair or bench, the space confined, "
        "club lighting reaching it as a dim warm pulse, "
        "bass off the floor physical and constant",
        "dim warm amber with occasional colour pulsing in from the main floor, "
        "her skin catching it as she moves",
        "club bass as a physical presence, "
        "her breath, "
        "fabric as each piece of clothing comes off",
        "she starts in stage costume — bodycon dress, lingerie set, or club wear — "
        "and works out of it across the scene. "
        "Beat 1: dressed. Beat 2: partly undressed. Beat 3: topless or minimal. "
        "Camera seated, receiving."
    ),

    # ── POV — WOW + HEAT (built for first-person: grippable foreground, light that
    #    flatters whoever faces the view, close/far sound layers, no mirrors) ────
    "🌌 POV · Infinity pool penthouse — night skyline": (
        "a rooftop infinity pool at night, warm water at chest height filling the lower view, "
        "the tiled edge inside arm's reach, water running over the vanishing edge into "
        "a sheer drop, the city grid glittering far below, steam curling off the "
        "surface into cold air, droplets standing on skin and stone",
        "cool underwater lights glowing up through the water, warm sodium "
        "washing in from below the horizon line, wet skin taking both — cyan from "
        "beneath, amber rim off the skyline",
        "water lapping at tile, the city muffled far underneath, a steady "
        "trickle over the infinity edge, wet skin breaking the surface"),

    "🛩 POV · Private jet cabin — cruising altitude": (
        "a private jet cabin at altitude, cream leather seat backs and gloss walnut "
        "within arm's reach, a champagne flute fizzing on the fold-out table, portholes running "
        "down the fuselage onto a blinding white cloud deck, seatbelt straps "
        "hanging loose, the aisle narrow enough to touch both sides at once",
        "hard high-altitude sun knifing through the portholes in tight beams and "
        "bouncing off the cream leather as fill, everything above the cloud line "
        "over-bright and clean",
        "the engines a steady muffled roar, ice shifting in a glass, leather creaking "
        "under weight, and the pressurised hush sitting under all of it"),

    "⛈ POV · Storm balcony — lightning over black sea": (
        "a wide hotel balcony rail at hip height in the lower view, rain-slick stone "
        "underfoot, a black ocean working below, storm cloud stacked to the "
        "horizon, sheets of warm rain crossing the balcony edge, wet glass doors "
        "standing open behind, curtains snapping in the wind",
        "near darkness torn open by lightning — each strike a full-frame white flash freezing "
        "the rain mid-air and silhouetting everything for one frame, then deep blue "
        "afterglow, every wet surface flaring on the next bolt",
        "thunder arriving seconds behind each flash, hard rain drumming on stone, wind "
        "gusting across the balcony, the sea booming into rocks far below"),

    "🕯 POV · Candlelit hammam — steam and stone": (
        "an old stone bath house, a hundred candles crowded onto every ledge and alcove, "
        "steam hanging in slow layers, a raised marble slab warm and wet at the "
        "centre and within reach, water channels cut into the floor, carved arches receding "
        "into dark, condensation running down the dome overhead",
        "massed candle flame as the only source — deep amber moving across wet "
        "marble and skin, steam going gold where it crosses a flame, shadows breathing "
        "with the flicker",
        "water dripping off the dome in irregular echoes, steam hissing off hot stone, "
        "a ladle poured out and spreading, every sound doubled by the stone"),

    "🧖 POV · Mountain onsen — snowfall at night": (
        "an outdoor hot spring ringed with dark volcanic rock, steaming water at chest "
        "height in the lower view, heavy snow falling slow and vertical out of a black "
        "sky, snow banked on every rock edge within reach, one paper lantern on a cedar "
        "post, pine forest standing as a dark wall past the steam",
        "the lantern's warm orange pool against blue-black night, steam lighting up "
        "where it crosses the beam, flakes flaring orange as they pass it and then "
        "gone into the water",
        "the soft constant hush of falling snow, water running over rock into the pool, "
        "steam rising with a faint mineral hiss, absolute mountain silence underneath it"),

    "🏰 POV · Four-poster suite — silk canopy": (
        "an enormous four-poster filling the view, carved dark-wood posts at the corners "
        "within reach, deep crimson silk overhead the moment the view tips back, "
        "heavy sheets pooled in folds, a stone fireplace throwing light across the "
        "room, tall leaded windows holding black night beyond",
        "firelight from the side — warm orange rippling over the silk and the "
        "sheets, deep soft shadow inside the bed frame, skin lit in moving amber",
        "the fire cracking and settling, silk sliding over silk, the frame creaking, "
        "wind pressing faintly at the old glass"),

    "🚗 POV · Chauffeured back seat — neon through rain": (
        "the deep back seat of a long black car at night, quilted leather close on "
        "every side, the privacy divider raised ahead, rain crawling sideways across the "
        "windows, the city outside reduced to smeared neon ribbons going past, a low "
        "amber footwell glow, the seat wide enough to count as a room",
        "neon strobing through rain-streaked glass — pink, cyan, gold moving through "
        "the cabin in bands, each colour crossing leather and skin as the car "
        "runs, darkness in the gaps between",
        "rain drumming on the roof, tyres hissing over wet asphalt, the engine a distant purr "
        "past the divider, leather creaking close and loud"),

    "🛥 POV · Yacht aft deck — bioluminescent cove": (
        "the wide teak aft deck of an anchored yacht at night, deck rail and cushioned "
        "sunbed within reach, a sheltered cove of black glass water below, every ripple "
        "firing electric blue, stars spilled overhead, the dark shape "
        "of cliffs closing the bay",
        "cold blue-green blooming up out of the water with every movement, faint warm "
        "deck lights at ankle height, starlight silver along the rail — skin lit from below in "
        "moving aqua",
        "water slapping the hull on a slow beat, the anchor chain shifting once, a warm "
        "wind in the rigging, splashes igniting with an audible fizz"),

    "🔥 POV · Fire-lit cabin rug — blizzard outside": (
        "a thick sheepskin rug filling the lower view, an open stone fireplace going hard at "
        "arm's reach, rough timber walls, one window packed solid white with a howling "
        "blizzard, a bottle and two glasses on the hearth stone, the air shimmering "
        "above the flames",
        "the fire as sole source — hard flickering orange from one side, black shadow "
        "on the other, sparks climbing, the window a cold blue-white rectangle in a dark "
        "wall",
        "the fire roaring and popping close and loud, wind screaming past the eaves, snow "
        "hissing against the glass, wool shifting under weight"),

    "🌃 POV · Floor-to-ceiling glass — sixty floors up": (
        "a dark penthouse room with one entire wall of glass, the pane "
        "cold and flawless within touching distance, a city of light spread sixty floors "
        "down and running to the horizon, aircraft warning lights pulsing on distant "
        "towers, the room behind returning nothing but darkness — furniture reduced to bare "
        "silhouette",
        "no interior light at all — the city lights the room, a cool blue-white upglow "
        "through the glass with warm sodium patches, anyone against the window rimmed by "
        "a million distant windows",
        "close to silence — the building's deep hum, a siren rising and thinning far "
        "below, breath audible against the glass, a fingertip squeaking on the pane"),

    "⛩ POV · Tokyo love-hotel — neon through blinds": (
        "a compact love-hotel room at night, a low wide bed taking most of the floor, "
        "venetian blinds slicing a huge pink-and-cyan sign outside into glowing "
        "stripes, a padded vinyl headboard within reach, a small console of lit "
        "buttons on the wall, rain tapping the single window",
        "the neon outside as the only light — hard pink and cyan laddering across "
        "the bed and every surface through the blinds, the colours flipping as the sign "
        "cycles, black between the stripes",
        "rain on glass, the sign's electric buzz coming through the wall, a train "
        "passing somewhere below, the vinyl headboard creaking"),

    "🏜 POV · Desert blanket — Milky Way overhead": (
        "a thick woven blanket spread over sand still holding the day's heat, the lower view filled "
        "with its pattern and a lantern turned down to a glow, dunes running off in "
        "pale silver ridges, and when the view tips up — the Milky Way in "
        "full detail across a jet-black sky with no light pollution anywhere in it",
        "starlight and a sliver of moon — cold silver-blue over the dunes, the lantern's "
        "small warm pool on the blanket, skin half silver and half amber where the two "
        "meet",
        "total desert silence with a faint wind moving sand a grain at a time, the blanket "
        "shifting, breath enormous in the quiet, one coyote a long way off"),

}

# Keys exported for the JS dropdown
_RAW_ENV_KEYS = list(ENVIRONMENT_PRESETS.keys())

# POV and WTF tagged display labels
_POV_ENVS = {
    "🛋 Living room — late night tv",
    "🛏 Bedroom — intimate low light",
    "🚗 Parked car — night",
    "🚕 Taxi back seat — city at night",
    "🏨 Hotel room — quality",
    "🪩 Club private booth — VIP",
    "💆 Massage table — face down",
    "🔒 Private booth — POV",
    "🪑 Strip club — private booth",
    "🌙 Strip club — VIP room",
    "🎪 Burlesque venue — seated table",
    "💃 Strip club — main floor",
}
_WTF_ENVS = {
    "✈️ Skydive — open door at altitude",
    "🪂 Paragliding — soaring",
    "🌊 Big wave surfing — tow-in",
    "🏔 Base jump — cliff edge",
    "🌋 Volcanic landscape — active",
    "🏎 Racing circuit — in car",
    "🚁 Helicopter — open door",
    "🌊 Underwater — deep",
    "🎢 Rollercoaster — first drop",
    "🏙 Abandoned skyscraper — upper floor",
    "🚤 Speedboat — open water at speed",
}

def _env_label(k):
    if k in ("None — LLM decides", "🎲 Random — seed picks"):
        return k
    if k in _POV_ENVS:
        return f"POV — {k}"
    if k in _WTF_ENVS:
        return f"WTF — {k}"
    return k

# ENV_KEYS uses labeled versions for the dropdown display
ENV_KEYS = [_env_label(k) for k in _RAW_ENV_KEYS]

# Lookup map: labeled key → original key → preset
_ENV_LABEL_TO_RAW = {_env_label(k): k for k in _RAW_ENV_KEYS}

# Extended presets dict that accepts both raw and labeled keys
# Patch ENVIRONMENT_PRESETS.get to handle labeled keys
_orig_env_presets = ENVIRONMENT_PRESETS
class _EnvPresetsProxy(dict):
    def get(self, key, default=None):
        if super().__contains__(key):
            return super().get(key, default)
        raw = _ENV_LABEL_TO_RAW.get(key)
        if raw is not None and super().__contains__(raw):
            return super().get(raw, default)
        return default

ENVIRONMENT_PRESETS = _EnvPresetsProxy(_orig_env_presets)

_ENV_RANDOM_POOL = [k for k in ENV_KEYS if k not in ("None — LLM decides", "🎲 Random — seed picks")]
