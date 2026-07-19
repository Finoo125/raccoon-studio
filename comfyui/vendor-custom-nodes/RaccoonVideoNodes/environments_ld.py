"""
environments_ld.py — Environment presets for PromptEngineerLD
Loaded once by prompt_engineer_ld.py. Edit here, never need to touch the main node.
"""

# Each value is either:
#   None                       → LLM decides
#   "RANDOM"                   → picked at runtime by seed
#   (location, lighting, sound) → injected into system prompt

ENVIRONMENT_PRESETS = {
    "None — LLM decides": None,
    "🎲 Random — seed picks": "RANDOM",

    # ── NATURAL ──────────────────────────────────────────────────────────────
    "🏖 Beach — golden hour": (
        "wide open beach at golden hour, warm amber light raking low across wet sand, "
        "shallow surf foaming in irregular sheets over the flat shore, "
        "distant horizon blurred with sea haze, seaweed and shell fragments at the tide line, "
        "salt crust on every exposed surface, damp sand firm underfoot then soft further up the beach",
        "warm directional sidelight from the low sun, long soft shadows stretching inland, "
        "orange-gold palette with deep blue shadows pooling in the wet sand troughs",
        "rolling waves building and collapsing, wind-carried spray hissing across the sand, "
        "distant gulls, the hollow clap of a wave folding on itself"),

    "🏔 Mountain peak — dawn": (
        "exposed mountain summit at first light, vast sky opening below in every direction, "
        "cold thin air, bare grey-brown rock underfoot fractured into angular plates, "
        "pale blue and rose light spreading from the east across cloud layers far below, "
        "distant ranges stretching to a gently curved horizon, breath visible in the cold",
        "cold directional dawn light from the east, high contrast, no fill light, "
        "long purple shadows from every ridge and rock formation, rose-to-blue sky gradient",
        "wind building and fading in slow gusts, deep silence between them, "
        "the creak of cold rock contracting, faint echo from the valley below"),

    "🌲 Dense forest — diffused green": (
        "deep forest interior, canopy dense and fully closed 20 metres overhead, "
        "light filtering down in soft broken columns through layered leaves, "
        "moss-covered ground, ferns at knee height filling every gap between roots, "
        "standing water in root depressions reflecting green light back upward, "
        "bark textured with lichen and fungal rings, the space between trunks creating receding depth",
        "diffused green-filtered light with no hard shadows, uniform soft fill from the canopy above, "
        "every surface tinted with reflected chlorophyll green",
        "birdsong in overlapping species layers, wind audible in the canopy but absent at ground level, "
        "a dry leaf shifting somewhere unseen, distant running water"),

    "🌊 Underwater — shallow reef": (
        "shallow tropical reef underwater, clear turquoise water with 20-metre visibility, "
        "shafts of broken sunlight refracting through the rippling surface in caustic patterns, "
        "staghorn and brain coral formations in soft focus below, "
        "small fish holding station in the gentle current, everything moving in slow surge rhythm",
        "caustic light patterns dancing across every surface from above, "
        "high-key teal-blue overall, darker blue fading into depth below",
        "muffled pressure, the steady rise of bubbles, distant boat hull drone, "
        "the creak of coral in the current"),

    "🌧 Rain-soaked city street — night": (
        "rain-soaked urban street at night, wet asphalt reflecting neon signs "
        "in elongated distorted colour streaks, steam rising from iron grates in the road, "
        "pools of amber streetlight surrounded by dark, blurred traffic in background, "
        "awnings dripping, gutters running",
        "neon colour reflections in puddles — red, blue, white, amber — "
        "cool blue ambient fill, warm sodium overhead streetlamps",
        "rain on pavement in constant hiss, distant traffic, "
        "wet tyre sound on asphalt, footsteps echoing under an awning"),

    "🏜 Desert — midday heat": (
        "open desert at midday, bleached pale sand extending to a dead-flat horizon, "
        "air rippling with heat shimmer low above the ground, "
        "sky a brilliant white-blue with no cloud, no shade, no landmarks, "
        "surface cracked into geometric plates closer to the foreground",
        "brutal overhead sun, harsh vertical top-light with zero shadow relief, "
        "bleached palette — near-white sand, white-blue sky, black under anything that casts shade",
        "silence — then wind — then silence again, fine sand skittering across the crust"),

    "🌌 Night sky — open field": (
        "open field under a fully clear night sky, grass running to a dark horizon, "
        "the Milky Way arcing overhead in a dense band of blue-white stars, "
        "no artificial light source, ground-level detail barely visible in deep blue-black ambient",
        "starlight only, near-black ambient, faint blue-grey top-light from the sky itself, "
        "the Milky Way core casting a measurable soft gradient",
        "crickets in continuous layers, light wind through the grass, "
        "a frog somewhere, the profound silence beneath everything"),

    "🌁 Rooftop — city at night": (
        "high rooftop at night, city skyline spreading in every direction below, "
        "warm glow rising from the streets like a second horizon, "
        "wind at this height, ventilation stacks and water tanks breaking the flat roof surface, "
        "a parapet at the edge with the drop visible beyond it",
        "city glow from below as warm amber fill, cool blue sky above, "
        "backlit silhouette potential against the lit skyline",
        "distant city hum rising and falling, wind, "
        "an occasional siren rising from far below and fading"),

    "✈ Plane cockpit — cruising altitude": (
        "aircraft cockpit at cruising altitude, instrument panel spread in amber and green glow, "
        "black sky through the windshield, stars visible above the cloud layer, "
        "the vibration and low hum of engines constant beneath everything, "
        "oxygen mask clips and circuit breakers detailed on the overhead panel",
        "instrument panel glow from below — warm amber dials, green digital readouts — "
        "cool black from the windshield, no natural light",
        "engine hum constant and enveloping, radio static between calls, "
        "pressurised air hiss from the vents, the occasional click of switches"),

    # ── INTERIOR ─────────────────────────────────────────────────────────────
    "🏠 Bedroom — warm evening": (
        "warm bedroom interior in the evening, a single bedside lamp casting a pool of amber light, "
        "soft shadow in the far corners, bed linen slightly rumpled with the weight of use, "
        "curtains drawn against the dark outside, a glass of water on the nightstand",
        "warm tungsten point source from the bedside lamp, soft falloff, "
        "intimate amber glow, deep shadow beyond its reach",
        "rain against the window glass if it's raining, or the distant low hum of the city through double glazing, "
        "the bed shifting under weight, fabric sliding on fabric, "
        "a phone on the nightstand screen briefly lighting then going dark, "
        "breathing — the rhythm and depth of it — the only sound that belongs to the room itself"),

    "🛁 Bathroom — steam and tile": (
        "steam-filled bathroom, a hot shower running behind frosted glass, "
        "white tile walls beaded with condensation, mirror completely fogged over, "
        "damp warm air thick enough to see, a folded towel on the rail, "
        "soap residue on the tile floor",
        "diffused warm light through frosted glass — soft, hazy, no hard edges, "
        "the steam itself lit from within",
        "shower hiss steady behind glass, water hitting tile, "
        "a slow drip from the tap, muffled echo in the tiled space"),

    "🪟 Penthouse — floor-to-ceiling glass": (
        "high-floor penthouse interior with floor-to-ceiling glass on two walls, "
        "city spread far below, clean minimal interior — low furniture in dark leather and pale stone, "
        "daylight flooding in from the glass wall, the room reflected in the glass at certain angles",
        "natural daylight through glass — even, cool, diffused by height and haze — "
        "city providing a continuous ambient glow from below at night",
        "near-silence — the city thirty floors below reduced to a formless low frequency hum, "
        "the building's HVAC cycling barely audible, glass creaking faintly in wind at this height, "
        "ice settling in a glass, the sound of someone's breathing amplified by the quiet, "
        "and the occasional deep resonant vibration of the building itself moving"),

    "🎹 Jazz club — late night": (
        "intimate jazz club late at night, low ceiling with exposed brickwork, "
        "small stage lit warm at the far end, tables pressed close together, "
        "a candle stub on each table burning low, smoke visible in the stage light, "
        "a bar along one wall with backlit bottles",
        "warm tungsten stage wash, candle fill table by table, "
        "deep shadow in the corners and upper walls",
        "a jazz trio — upright bass, brushed snare, and a tenor saxophone — playing a slow blues "
        "at the far end of the room, the saxophone filling the space and bending at the end of each phrase, "
        "the bassist walking the changes in a low steady pulse, brushes on the snare barely louder than breathing, "
        "a glass set down on the bar between phrases, low conversation that stops "
        "when the sax player leans into a long held note"),

    "🚂 Train — moving through night": (
        "train carriage moving at night, window showing dark landscape "
        "with scattered lights passing in rhythm, warm interior against the cold black outside, "
        "moving reflections of the carriage interior in the glass, "
        "seats in worn fabric, the rhythmic sway of the carriage",
        "warm interior tungsten against total black window exterior, "
        "moving reflections layered over the dark passing world",
        "rhythmic track click accelerating and decelerating on curves, "
        "engine vibration through the floor, the world passing outside muffled by glass"),

    "💊 Underground club — strobes and bass": (
        "underground club at full capacity, strobes cutting the dark in sharp white intervals, "
        "bass pressure felt in the chest before it is heard, crowd pressed together in the dark, "
        "a DJ booth visible through smoke at the far end, coloured wash lights sweeping low",
        "stroboscopic white cuts, colour wash through smoke — purple, red, blue — "
        "near-black between flashes, faces caught in freeze-frame light",
        "bass at physical volume, the crowd as a breathing mass of sound, "
        "the specific compression of a room built for this volume"),

    "🏢 Office — after hours": (
        "corporate office after hours, desks empty and personal items abandoned mid-day, "
        "flat cold overhead fluorescent across an open-plan floor, "
        "city visible through floor-to-ceiling glass on one wall, "
        "the quality of silence that fills a building after everyone has left",
        "flat cold fluorescent overhead, warm city glow through the glass, "
        "clinical blue-white palette, long shadows from desk furniture",
        "air conditioning hum at low frequency, a distant elevator, "
        "the silence of an empty building with one person in it"),

    "🚗 Car — moving at night": (
        "car interior at night, moving through a lit city, streetlights sweeping "
        "through the windows in rhythmic pulses of amber and shadow, "
        "dashboard instruments glowing warm from below, city blurred and wet outside, "
        "the close interior smell of upholstery and warm electronics",
        "rhythmic streetlight sweeps through the windows, "
        "warm dashboard glow from below, moving pattern of light and shadow across interior surfaces",
        "engine, tyres on wet road, city muffled by glass, "
        "faint radio under everything"),

    # ── ICONIC ───────────────────────────────────────────────────────────────
    "🏰 Big Ben — Westminster at night": (
        "standing directly beneath the Elizabeth Tower on the Westminster Bridge approach, "
        "the illuminated clock face filling the upper frame, warm floodlit limestone glowing gold "
        "against a deep navy sky, the Thames visible beyond the stone parapet, "
        "black iron lampposts lining the bridge behind, black cabs and buses passing in soft blur",
        "warm sodium floodlighting on the tower face, cold blue ambient sky, "
        "wet stone reflecting gold below, the clock face its own light source",
        "distant Big Ben chime on the quarter, Thames wind across the bridge, "
        "traffic crossing behind, footsteps on stone"),

    "🗼 Eiffel Tower — dusk": (
        "Eiffel Tower viewed from Champ de Mars at dusk, warm iron lattice against a gradient sky "
        "shifting from rose-orange at the horizon to deep blue overhead, "
        "tourists in soft-focus mid-distance, the tower's lights not yet on, "
        "the Seine reflecting sky colour in the far distance",
        "dusk gradient — warm amber-rose at the horizon, cool indigo above, "
        "the tower lit from below by upward-facing warm floods, long shadows from the iron feet",
        "city hum from the boulevard, wind across the open park, distant traffic, "
        "the occasional tour guide, pigeons"),

    "🌃 Times Square — peak night": (
        "Times Square at full commercial night, billboards and LED displays covering every building face "
        "in overlapping colour — red Coca-Cola, blue Samsung, white theatre marquees, "
        "yellow cabs stopped in the gridlock below, tourists with phones raised, steam from a subway grate, "
        "the specific compressed energy of a crossroads that never goes dark",
        "total commercial artificial light — no natural light source at all, "
        "overlapping colour fields: billboard red bleeds into neon blue bleeds into white marquee flood, "
        "every surface reflects back at least three colours at once",
        "gridlock horns, pedestrian crowd noise, the mechanical stutter of a WALK signal, "
        "a busker somewhere, the compressed city sound that has nowhere to go"),

    # ── NIGHTLIFE / ADULT ─────────────────────────────────────────────────────
    "💃 Strip club — main floor": (
        "strip club interior at full operation, a raised centre stage with a brass pole "
        "catching coloured light, mirrored wall behind the stage doubling everything, "
        "leather booths arranged in a horseshoe around the stage, VIP rope section off to one side, "
        "a long bar with backlit shelves of bottles along the far wall, "
        "scattered tables between stage and bar, each with a small candle flickering in red glass, "
        "smoke machine haze hanging at waist height, a DJ booth tucked in the corner",
        "stage wash cycling slow between magenta, violet, and warm amber — hard spots on the pole, "
        "UV strips along the stage edge making white fabric glow, "
        "deep shadow in the booths beyond the stage light spill, "
        "the mirrored wall creating infinite depth behind the performer",
        "bass-heavy RnB or trap at medium volume, ice in glasses, "
        "low conversation from the booths, heels on the stage surface"),

    "🔒 Private booth — POV": (
        "POV from a seated position in a strip club private booth, "
        "camera locked at seated eye height looking slightly upward, "
        "black leather seat visible at the lower edge of frame, "
        "a curtain of dark velvet half-drawn behind the performer, "
        "the booth is small — the performer fills the frame at arm's length",
        "single overhead recessed downlight — warm amber, tight pool, "
        "everything outside the light pool near-black, "
        "the performer lit from above with strong shadow below the chin and cheekbones",
        "bass from the main floor muffled through the curtain, "
        "the booth speaker playing its own quieter track, breathing audible at this proximity, "
        "fabric shifting, the creak of leather seating, ice settling in the glass"),

    # ── BEACHES / OUTDOOR ─────────────────────────────────────────────────────
    "🌴 LA beach — Venice / Santa Monica": (
        "Venice Beach boardwalk spilling onto wide flat sand in late afternoon golden hour, "
        "the Pacific glinting hard silver-gold to the horizon, palm trees in a line along the boardwalk, "
        "skaters and cyclists in soft-focus background on the bike path, "
        "muscle beach gym frames visible further down, graffiti walls and vendor stalls along the walk, "
        "lifeguard tower in classic white and red, crowds scattered across the sand",
        "golden hour California sun — warm, low, directional from the west over the ocean, "
        "long shadows stretching inland, everything backlit and rim-lit, "
        "skin glowing warm, sunglasses catching flare, the specific amber-pink LA light",
        "waves on the shore in steady rhythm, crowd noise from the boardwalk, "
        "a boombox somewhere playing hip-hop, skate wheels on concrete, "
        "seagulls, distant laughter"),

    "🍹 Ibiza pool party — golden hour": (
        "infinity pool at a cliff-edge villa in Ibiza at golden hour, "
        "the Mediterranean spread below in deep blue, white-washed walls and terracotta tiles, "
        "the pool overflowing its edge into the view, DJ setup under a white canopy, "
        "people in the water and on daybeds around the pool, champagne in ice buckets, "
        "string lights not yet lit waiting for dusk, smoke from a grill drifting across",
        "direct golden hour sun from the west — hard, warm, every water droplet catching it, "
        "skin glistening, pool surface a sheet of shifting gold, "
        "white surfaces bouncing light everywhere as natural fill",
        "deep house from the DJ at medium volume, water splashing, laughter, "
        "glasses clinking, the wind off the Mediterranean"),

    "🏄 Bondi Beach — bright midday": (
        "Bondi Beach at midday from the promenade level looking down the crescent of sand, "
        "the ocean a vivid turquoise with white breakers rolling in regular sets, "
        "hundreds of people on the sand, surfers in the water, the iconic red and yellow lifeguard flags, "
        "the sandstone headland at each end of the crescent, Norfolk pines along the promenade",
        "harsh Australian midday sun — overhead, no shadow relief, high UV, "
        "bleached sand near-white, ocean almost too bright to look at, "
        "everything saturated and high-contrast",
        "surf crash in steady sets, crowd buzz, lifeguard whistle, "
        "someone's portable speaker, seagulls fighting over chips"),

    # ── MOODY / CINEMATIC ─────────────────────────────────────────────────────
    "🕯 Candlelit loft — exposed brick": (
        "open loft apartment with exposed brick walls and timber ceiling beams, "
        "the only light from clusters of pillar candles — on the floor, on shelves, on a low table, "
        "thirty or forty flames creating overlapping pools of warm amber, "
        "a large bed with dark linen visible in the back half of the space, "
        "a freestanding cast-iron bathtub near the windows, "
        "tall industrial windows showing the city at night but curtained with sheer fabric",
        "candlelight only — warm amber from multiple low sources, "
        "flames creating soft moving shadows on the brick, "
        "the candles reflected in the dark window glass, deep shadow above the beam line",
        "candle flames guttering in a draught, distant city through the glass, "
        "the creak of old timber, fabric shifting, "
        "the specific intimate quiet of a room lit only by fire"),

    "🚿 Rain shower — glass-walled bathroom": (
        "large walk-in rain shower with floor-to-ceiling glass walls on two sides, "
        "a single oversized showerhead directly overhead raining straight down, "
        "steam filling the upper half of the glass enclosure, "
        "water streaming in sheets down the glass, "
        "dark slate tile floor and walls, recessed warm LED strip at floor level, "
        "a bench built into the back wall",
        "recessed warm LED strip at floor level casting upward through the steam and water, "
        "overhead downlight diffused through the rain and mist, "
        "everything soft-edged and glowing, skin wet and catching every light source",
        "rain shower hiss from directly overhead — enveloping, constant, "
        "water hitting slate, steam, breathing amplified by the glass enclosure"),

    "🪩 Hotel rooftop bar — city night": (
        "rooftop bar on a high-end hotel, the city skyline as the backdrop on three sides, "
        "the bar itself a long backlit slab of marble or onyx, cocktails in progress, "
        "low seating clusters — velvet and brass — arranged around fire pit tables, "
        "a small pool or water feature reflecting the city lights, "
        "well-dressed people at the edges, a DJ playing from a minimal booth",
        "warm practical lighting from the bar, fire pits, and string lights, "
        "city skyline ambient glow as backdrop, "
        "the sky a deep dark blue with the city preventing true black",
        "cocktail bar sounds — shaker, ice, glass on marble, low conversation, "
        "deep house at low volume from the DJ, wind at height, "
        "the city far below as a continuous ambient hum"),

    # ── TRANSPORT ─────────────────────────────────────────────────────────────
    "🛥 Yacht deck — open ocean sunset": (
        "aft deck of a motor yacht at sunset, teak deck underfoot, "
        "the wake stretching back white and straight to the horizon, "
        "open ocean in every direction — deep blue turning to copper near the sun, "
        "the stern rail and a pair of chaise lounges, champagne in a bucket lashed to the rail, "
        "sea spray occasionally reaching the lower deck",
        "direct sunset from the stern — warm copper-gold, hard rim light on everything facing aft, "
        "deep blue shadow on the forward side, the wake itself catching the light, "
        "skin lit warm from behind, face in soft reflected ocean fill",
        "engine vibration through the deck, wind, the hull cutting water, "
        "wake turbulence behind, a halyard clinking somewhere"),

    "🏎 Supercar interior — night drive": (
        "interior of a low-slung supercar at night — Lamborghini, McLaren, or similar — "
        "the cockpit tight and low, carbon fibre dash and centre console, "
        "the instrument cluster glowing warm amber behind the flat-bottom steering wheel, "
        "city lights streaking past through the low windshield, "
        "LED ambient strips along the door sills in cool blue",
        "instrument cluster glow from below — warm amber, "
        "LED ambient strips in cool blue along the sills, "
        "city light streaking through the glass in rhythmic pulses",
        "engine note — a specific high-RPM mechanical scream behind and below the seats, "
        "tyres on asphalt, wind noise at speed, "
        "the turbo spool between shifts, city sound entering and leaving in doppler pulses"),

    # ── RAW / GRITTY ─────────────────────────────────────────────────────────
    "🏨 Cheap motel room — neon through blinds": (
        "single-room motel interior at night, a queen bed with a thin patterned bedspread, "
        "wood-veneer furniture, a CRT TV on the dresser, venetian blinds at the window "
        "casting horizontal neon stripes — red and blue — across the bed and opposite wall, "
        "the bathroom door ajar showing harsh fluorescent inside, a bag on the floor",
        "neon from outside through the blinds — alternating red and blue in horizontal bands, "
        "harsh bathroom fluorescent spilling through the cracked door as a single cold stripe, "
        "headlight sweeps across the ceiling at irregular intervals",
        "the neon sign buzzing outside the window, ice machine humming through the wall, "
        "distant traffic on the highway, a door slamming somewhere in the building"),

    "🏚 Abandoned building — daylight": (
        "derelict industrial building in daylight, roof partially collapsed letting shafts of "
        "dusty light fall through onto a rubble-covered floor, broken windows with weeds growing "
        "through the frame, peeling paint layers exposing old industrial colours — "
        "blue-grey, oxide red, institutional cream — graffiti layered over graffiti on the far wall, "
        "a collapsed ceiling section creating a mound of plaster and rebar in the centre",
        "shafts of direct natural light falling through holes in the roof and broken windows, "
        "dust suspended in every shaft, deep shadow in the corners and beneath collapsed debris, "
        "high contrast between the lit shafts and the surrounding dark",
        "wind through broken windows causing intermittent creaking of loose metal, "
        "dripping water somewhere, pigeons in the roof space, "
        "the specific silence of a large empty building with no one in it for years"),

    # ── ASIAN LOCATIONS ───────────────────────────────────────────────────────
    "🌸 Tokyo Shibuya — night rain": (
        "Shibuya crossing at night in light rain, the vast intersection empty between light changes "
        "then flooding with pedestrians from all directions at once, "
        "the Shibuya 109 building and Q-Front façade covered in LED advertising, "
        "wet crossing stripes reflecting every colour, umbrellas dotting the crowd, "
        "the pedestrian countdown clock visible on a corner post",
        "total commercial artificial light — warm amber streetlamps competing with cold LED billboard blue, "
        "every wet surface doubling each light source, the crowd creating a moving mosaic of backlit umbrellas",
        "the specific surge of pedestrian traffic at the crossing change, umbrella fabric sounds, "
        "rain on pavement, distant J-pop from a shopfront, the crossing signal"),

    "🏯 Kyoto — bamboo grove": (
        "Arashiyama bamboo grove in Kyoto, a path cutting through dense stands of bamboo "
        "rising 15 metres overhead, the canes so close together they form a continuous vertical texture, "
        "filtered green-tinted light falling in soft broken shafts, "
        "the path stone-paved and slightly damp, tourists in the far distance but this section quiet",
        "diffused green-filtered light — the bamboo canopy acting like a giant silk softbox, "
        "soft directionless fill with no hard shadows, everything tinted with reflected chlorophyll",
        "the creak and knock of bamboo canes moving in the wind above, "
        "wind itself audible as a collective rustle through thousands of leaves, "
        "footsteps on stone, distant temple bell"),

    "🌆 Seoul rooftop — dusk": (
        "rooftop of a mid-rise building in a residential Seoul neighbourhood at dusk, "
        "water tanks and ventilation boxes, a small garden of potted plants in one corner, "
        "the city below spreading to every horizon, apartment towers lit in warm evening windows, "
        "the Han River a faint dark band in the mid-distance, "
        "two folding chairs and a small table — recently used",
        "dusk: the last directional light gone, sky a gradient of deep rose to cool indigo at the zenith, "
        "the city's warm amber rising from below like a second horizon, "
        "a street lamp on the access staircase providing the only warm key light",
        "city hum from below, wind at rooftop height, "
        "a distant siren absorbed into traffic, the creak of a laundry line wire"),

    "🌸 Cherry blossom park — midday": (
        "a park with cherry blossom trees in full bloom, "
        "petals continuously falling in the light wind, "
        "a stone path through the trees, wooden benches at intervals, "
        "other people visible in soft focus at the edges — couples, families — "
        "the blossom so dense it forms a soft ceiling overhead, "
        "petals accumulating in drifts against the kerb of the path",
        "filtered overhead light through the blossom canopy — soft pink-white, directionless, "
        "everything in the scene faintly lit from above through the petals, "
        "no hard shadows, skin luminous in the diffused light",
        "wind through the blossom — a collective soft rustle — "
        "petals landing on surfaces with barely any sound, "
        "distant park sounds softened by the canopy, someone laughing"),
    # ── POV-SPECIFIC INTERIORS ────────────────────────────────────────────────
    "🛋 Living room — late night tv": (
        "domestic living room late at night, sofa and coffee table in the foreground, "
        "a large TV the primary light source casting a shifting blue-grey glow across the room, "
        "remote control and a half-empty glass on the table, curtains drawn, "
        "the rest of the room in deep shadow except where the screen catches a surface, "
        "the specific stillness of a room where only one person is awake",
        "TV screen as sole key light — cool blue-grey, flickering slightly with content, "
        "falling off sharply into darkness at room edges, "
        "the screen reflecting in the glass on the table as a doubled light point",
        "TV audio at low volume — voices and music from another world, "
        "the room's own silence underneath it, occasional settling creak of the building, "
        "rain if it happens to be raining outside"),

    "🛏 Bedroom — intimate low light": (
        "domestic bedroom at night, a bed filling most of the space, "
        "a single bedside lamp on one side casting warm amber fill, "
        "the other side of the bed in soft shadow, curtains closed, "
        "the room reduced to the essential geometry of the bed and two people, "
        "clothes on the floor, the specific intimate disorder of use",
        "single warm bedside lamp — amber, soft, directional, "
        "fill on the pillow side, shadow deepening toward the other edge of the bed, "
        "the ceiling in near-darkness",
        "room quiet — the acoustic absorption of a bedroom with curtains and soft furnishings, "
        "own breath, their breath, the bed shifting, "
        "distant city or nothing"),

    "🚗 Parked car — night": (
        "interior of a parked car at night — could be any model but the geometry is constant, "
        "front headrests visible, windscreen showing a car park or quiet street beyond, "
        "sodium streetlight entering through glass casting amber bands across seats, "
        "the rear-view mirror catching a strip of what's behind, "
        "condensation beginning to form on the inside of windows, "
        "the confined space with engine off and world outside continuing without you",
        "sodium streetlight through glass — warm amber stripes across interior surfaces, "
        "interrupted by passing headlights sweeping across the cabin, "
        "dashboard instruments unlit, everything amber and shadow",
        "the tick of the cooling engine, muffled city sounds through the glass, "
        "the sealed acoustic of a car interior, own breath, "
        "rain on the roof if weather applies"),

    "🚕 Taxi back seat — city at night": (
        "back seat of a moving taxi at night, driver visible from behind through the divider, "
        "city lights streaming past the side windows, "
        "the meter or phone mount on the dash, "
        "the slight lean of acceleration and braking through corners, "
        "the anonymous semi-privacy of the back of a cab",
        "city light through side windows in rapid sequence — "
        "amber, white, neon colour, shadow, amber again — "
        "the driver's silhouette against the windscreen glow",
        "engine and transmission, city traffic outside, "
        "the driver's radio low, the physical lean through corners, "
        "the specific suspension of a taxi at city speeds"),

    "🏨 Hotel room — quality": (
        "mid-to-high quality hotel room, king bed with pressed white linen, "
        "a large window with the curtains partially open showing a city view at night, "
        "the furniture precise and impersonal — everything in its assigned position — "
        "a minibar, a desk, the bathroom door open showing tile and chrome, "
        "the room lit to a warm neutral and ready for whatever the night requires",
        "overhead dimmed warm amber, city glow entering through the gap in the curtains "
        "as a secondary cooler source, bathroom fluorescent a white stripe through the open door, "
        "the window view providing a deep blue backdrop",
        "air conditioning hum — constant, the fundamental frequency of hotel rooms, "
        "city sounds muffled by the glass, the close silence of a soundproofed space, "
        "the quality of hotel quiet"),

    "🪩 Club private booth — VIP": (
        "private VIP booth in a nightclub, curved seating in dark leather, "
        "a table with bottle service — ice bucket, glasses, the markers of the night — "
        "the main club floor visible beyond a low partition, "
        "the booth slightly elevated from the floor, bass physical from the sound system, "
        "neon and strobe light from the floor reaching the booth in pulses, "
        "the semi-privacy of a space that is both inside and watching",
        "table candle or LED in ice bucket as close warm source, "
        "club light reaching the booth as coloured pulses — "
        "purple, cyan, amber in rotating sequence, "
        "strobe catching faces at the floor below in freeze-frames",
        "bass as physical presence — the dominant sensation, "
        "crowd noise from the floor washing into the booth, "
        "conversation at shouting distance, bottle sounds on table"),

    "💆 Massage table — face down": (
        "professional massage room, white linen on a padded table, "
        "the face cradle close — the circular view of the floor through it, "
        "ambient candle or oil lamp light warm and low, "
        "essential oil scent implied by the visual calm of the space, "
        "the specific vulnerability and relaxation of lying face down in this context",
        "candle or low lamp warm amber fill, "
        "soft and directionless — no hard shadows, "
        "the face cradle creating a circular vignette framing the floor below",
        "ambient spa music distant and soft, "
        "oil sounds, the practitioner's breath, the table adjusting, "
        "the particular silence that surrounds this kind of care"),

    # ── WTF / EXTREME ENVIRONMENTS ────────────────────────────────────────────
    "✈️ Skydive — open door at altitude": (
        "inside a small jump aircraft at altitude, the door wide open, "
        "the interior stripped to bare metal and webbing, "
        "the roar of wind at the door filling everything, "
        "other jumpers visible in silhouette ahead of the door against the blue-white sky beyond, "
        "the earth visible through the door as a patchwork impossibly far below, "
        "the frame vibrating with engine and air",
        "daylight flooding through the open door — harsh, brilliant, "
        "the aircraft interior dark by contrast, "
        "jumpers in silhouette against the blown-out exterior light",
        "the roar of the door — overwhelming, physical, everything else consumed by it, "
        "own heart in own ears, the instructor's final check shout, "
        "then: the jump"),

    "🪂 Paragliding — soaring": (
        "in harness under a paraglider wing at altitude, "
        "the wing fabric overhead in the peripheral frame — "
        "cells and lines visible above and behind, "
        "the valley below in complete unobstructed view, "
        "mountains at eye level to either side, "
        "the horizon extending to a distance that reveals the curve of the earth, "
        "no sound except wind",
        "open sky light — brilliant overhead, "
        "valley in full sun below creating a second source of diffused fill from beneath, "
        "shadow of the wing occasionally crossing own hands on the brake toggles",
        "wind in the lines — a musical tone that shifts with speed, "
        "the wing fabric talking in gusts, "
        "own breath, the sound of nothing else at all"),

    "🌊 Big wave surfing — tow-in": (
        "the face of a very large wave, water moving at speed around the board, "
        "the wave face a vertical wall of green-black water above and to the right, "
        "the bottom of the wave rushing toward the frame as the board drops, "
        "spray tearing off the lip high above, "
        "horizon tilted severely, the weight of the water evident in every surface",
        "the wave itself as light source — translucent green-black, "
        "backlit where thin, opaque and dark where thick, "
        "spray catching the sun in prismatic bursts at the lip",
        "the sustained roar of moving water — a sound like nothing else, "
        "the board vibrating through the feet, "
        "own breath fast and controlled, "
        "the lip thundering overhead as it begins to fold"),

    "🏔 Base jump — cliff edge": (
        "standing at the edge of a cliff or building with a base jump setup, "
        "the drop stretching away below and forward — pure open air, "
        "the landing zone a small rectangle far below, "
        "wind at this height moving around you, "
        "the edge of the surface underfoot visible at the bottom of frame, "
        "the last moment before the commitment",
        "open sky from the front — brilliant, expansive, "
        "the land below as a texture at extreme distance, "
        "the edge catching the light",
        "wind — constant and physical, "
        "own heartbeat audible, own breath deliberate and controlled, "
        "the silence before the step"),

    "🌋 Volcanic landscape — active": (
        "lava field on an active volcanic landscape, "
        "black basalt stretching to a glowing horizon, "
        "active lava flow visible as orange-red rivers of light in the near-to-mid distance, "
        "sulphur steam rising from vents in pale plumes, "
        "the ground hot through boot soles, "
        "the sky a permanent dusk-orange even at night from the glow",
        "the lava itself as key light — warm orange-red from below and ahead, "
        "everything lit from a direction that has no daytime equivalent, "
        "steam plumes catching the light from below, the sky stained copper",
        "the constant low roar of lava movement — like a very deep river, "
        "the crack of cooling rock contracting, "
        "sulphur in the air implied by the visual, "
        "steam hiss from vents"),

    "🏎 Racing circuit — in car": (
        "interior of a race car on track, "
        "the cockpit tight and stripped — roll cage visible overhead, "
        "the track ahead through the visor of a helmet, "
        "apex markers appearing and vanishing, "
        "the wheel turning hard as braking points arrive fast, "
        "the car moving at a speed that makes the circuit geometry read as a problem to solve",
        "track light — whatever the track has, filtered through a helmet visor, "
        "instrument LEDs on the wheel providing close ambient, "
        "tyre smoke and tarmac dust at corners catching light",
        "engine at racing revs — a constant scream pitched at effort, "
        "tyre squeal at the limit, "
        "radio crackle of a pit wall message, "
        "brake disc heat and aero noise combining"),

    "🚁 Helicopter — open door": (
        "hovering in a helicopter with the door open, "
        "the skid visible below at frame edge, the city or landscape directly below through the opening, "
        "the rotor beating overhead as a physical rhythm, "
        "the horizon stable at a precise altitude, "
        "everything below available in a single unobstructed downward view",
        "open sky light from the open door flooding in, "
        "rotor shadow sweeping across the interior at intervals, "
        "distant landscape lit in full natural light through the opening",
        "rotor noise — the defining sound, physical and rhythmic, "
        "wind through the open door, "
        "pilot voice through headset, "
        "the vibration of the airframe"),

    "🌊 Underwater — deep": (
        "deep water diving, below recreational limits, "
        "light from above attenuating to a dim blue-green column, "
        "the surface a bright disk shrinking as depth increases, "
        "nothing below but darkness graduating to black, "
        "own torch beam the only local illumination, "
        "the extreme quiet of pressure depth",
        "surface light column above — the only natural source, "
        "own torch creating a cone of warm white in the cold blue, "
        "the darkness below as an active presence rather than absence",
        "regulator breath very loud in this silence — the loudest sound in the world, "
        "bubbles rising, "
        "the absolute quiet of deep water around it, "
        "own heartbeat"),

    "🎢 Rollercoaster — first drop": (
        "front row of a rollercoaster at the top of the first drop, "
        "the track visible falling away steeply ahead and below, "
        "park visible in all directions from this height, "
        "the moment of the click-and-hold at the apex, "
        "then the release forward and down",
        "open sky behind and above — brilliant, "
        "the track ahead as a ribbon falling into the park below, "
        "the frame about to pitch forward hard",
        "the chain click and hydraulic sounds at the top, "
        "crowd noise from far below, "
        "then the release — wind and screaming including own"),

    "🏙 Abandoned skyscraper — upper floor": (
        "high floor of an abandoned or under-construction skyscraper, "
        "floor-to-ceiling openings with no glass yet — or gone — "
        "city spread in every direction at this height with nothing between, "
        "wind entering at building speed, "
        "the floor concrete and bare, the geometry of the skeleton visible, "
        "clouds at eye level or slightly below",
        "open city light in every direction — the 360-degree light of altitude, "
        "no shadows except from the structural columns, "
        "clouds providing a shifting diffuse ceiling if present",
        "wind at building height — a sustained roar varying with gusts, "
        "city sounds far below as a continuous low wash, "
        "the building itself moving — barely, physically"),

    "🚤 Speedboat — open water at speed": (
        "front of a speedboat at high speed over open water, "
        "bow lifting and slamming, spray arcing to both sides, "
        "horizon ahead clean and empty, "
        "the wake visible behind over one's shoulder, "
        "the boat's movement making standing a physical engagement with inertia",
        "open water light — brilliant overhead, "
        "spray catching the sun as prismatic curtains on both sides, "
        "the wake behind catching light as a white line across blue",
        "engine roar — constant and high, "
        "hull slap at each wave, "
        "spray sound, "
        "wind at this speed consuming everything else"),


    # ── STRIP CLUB / INTIMATE DANCE ───────────────────────────────────────────
    "💃 Strip club — main floor": (
        "main floor of an upscale strip club, multiple stages with poles, "
        "circular runway lighting casting warm amber and pink down onto the performance areas, "
        "booths in deep shadow around the perimeter, other patrons visible as silhouettes, "
        "a bar along one wall catching the stage light in glassware reflections, "
        "the floor between stages lit just enough to navigate, "
        "the whole room designed so the performer is always the brightest thing in it",
        "warm amber and deep pink stage lighting falling in hard cones from above, "
        "everything outside the stage pools in deep shadow, "
        "glassware and chrome catching light as small secondary sources, "
        "skin catching warm stage light against the dark booth surround",
        "bass-heavy music at performance volume — the floor carries it physically, "
        "the ambient murmur of the room under it, "
        "applause at moments, ice in glasses, "
        "the specific ventilated air of a room like this"),

    "🪑 Strip club — private booth": (
        "private booth off the main floor, curved dark leather seating in a U-shape, "
        "a small table, the main floor visible through a gap in the curtain or partition, "
        "bass from the main floor felt through the seating and floor, "
        "a single overhead light in the booth dimmed to near-nothing, "
        "the space defined by its enclosure — close walls, low ceiling, the world reduced to this, "
        "a bottle or drinks on the table, the markers of time passing",
        "near-darkness in the booth — only the ambient spill from the main floor "
        "entering through the partition gap as a warm stripe, "
        "the performer lit by whatever reaches her from outside the booth, "
        "everything in low contrast, the room darker than comfortable",
        "bass from the main floor — muffled but present, felt as much as heard, "
        "music barely identifiable through the booth walls, "
        "her breath close in the near-silence of the booth interior, "
        "own breath, the leather of the seating"),

    "🌙 Strip club — VIP room": (
        "dedicated VIP room away from the main floor, "
        "proper room with a door that closes, "
        "a large sofa or seating arrangement, "
        "ambient lighting controlled and intentional — warm and low, "
        "a bar setup in the corner, artwork on walls that won't be examined, "
        "the room designed to feel both luxurious and private, "
        "the sound from outside completely cut by the door",
        "controlled warm amber lighting — dimmed to intimacy level, "
        "a single brighter point source over the performance area, "
        "the room's own light rather than borrowed stage light, "
        "skin caught in warm low fill",
        "music piped in at background level — present but not dominant, "
        "the room's own quiet around it, "
        "her movement sounds now audible — fabric, footstep, breath — "
        "sounds that the main floor volume would have buried"),

    "🎪 Burlesque venue — seated table": (
        "intimate burlesque venue or cabaret, small tables with candles, "
        "a modest stage at one end raised slightly above the floor, "
        "the audience close to the performance — no back row exists here, "
        "red velvet and dark wood, chandelier light warm and theatrical, "
        "champagne and cocktails on the tables, "
        "an audience that watches attentively rather than just consuming",
        "candle on table as warm close source, "
        "stage theatrical lighting — warm amber key, "
        "slight haze in the air catching the stage beams, "
        "the chandelier providing general warm fill at low level",
        "live music if applicable — a band or pianist, the acoustic difference from recorded, "
        "applause close and present at moments, "
        "the performer's voice or performance sounds clearly audible in this intimacy, "
        "candle flame movement, ice in glass"),


    # ── NEW POV ENVIRONMENTS ──────────────────────────────────────────────────
    "🏢 Office romance — after hours": (
        "corporate open-plan office at night, desks and monitors in rows, "
        "city visible through floor-to-ceiling windows, overhead fluorescents dimmed "
        "to half, one desk lamp on as the only warm source, "
        "the particular quiet of an office that should be empty but isn't, "
        "documents and coffee cups, a jacket over a chair",
        "half-dimmed overhead cool white, single warm desk lamp, "
        "city glow entering through the windows as a secondary blue source, "
        "monitor screens casting intermittent light",
        "air conditioning hum — constant, the fundamental frequency of office buildings at night, "
        "distant city traffic through the glass, the creak of a chair, "
        "the specific silence of a building holding two people who shouldn't be there",
        "she wears office attire — fitted shirt partly undone, pencil skirt, heels. "
        "Professional wardrobe in various states of disarray as the scene progresses."
    ),

    "🚀 Space launch — cockpit POV": (
        "inside a launch vehicle cockpit or capsule, instrument panels on every surface, "
        "small porthole windows showing the gantry structure outside, "
        "launch tower visible, pale blue sky beyond, "
        "crew strapped in harnesses, mission patches on suits, "
        "countdown displays, the vibration already building through the seat",
        "functional cockpit lighting — amber instrument glow, status LEDs in green and red, "
        "harsh daylight through the portholes creating high contrast with the dim interior, "
        "warning lights casting intermittent colour",
        "pre-launch acoustic environment — systems humming, "
        "radio comms from mission control, countdown in the background, "
        "then the ignition sequence — a bass rumble that becomes a roar that becomes everything, "
        "G-force pressing through the seat",
        "full flight suit, helmet visor up or down, mission patches, "
        "harness straps across chest. All personnel in identical gear."
    ),

    "🌌 Space station — zero gravity": (
        "interior of a space station module, cylindrical corridor lined with equipment panels, "
        "handrails running the length of the module, "
        "a porthole showing the curve of Earth below and stars beyond, "
        "floating objects — a tablet, a pen, a food packet drifting slowly, "
        "the particular cramped intimacy of a pressurised vessel in orbit",
        "no natural light direction — fluorescent overhead panels, "
        "Earth glow from the porthole as a shifting blue-white source, "
        "equipment LEDs as small coloured accents",
        "the hum of life support — constant, layered, never absent, "
        "radio comms, the soft knock of floating objects against surfaces, "
        "the profound silence beyond the hull",
        "flight suit or station utility wear — fitted layers, "
        "velcro patches everywhere for attaching things, "
        "no loose clothing that would float into equipment."
    ),

    "🏥 Hospital room — night shift": (
        "private hospital room at night, a single bed, monitoring equipment, "
        "IV stand, the door slightly ajar showing a lit corridor beyond, "
        "a visitor's chair pulled close to the bed, "
        "the particular vulnerability of a room designed for recovery",
        "fluorescent overhead off — only the warm bedside lamp on, "
        "monitor screens casting a faint blue-green glow, "
        "corridor light as a stripe through the door gap",
        "monitor beeps — rhythmic and constant, "
        "distant corridor sounds, a trolley somewhere, "
        "the building's own institutional silence",
        "patient in hospital gown — open-backed, thin cotton. "
        "Visitor in whatever they wore to rush here — casual or work clothes."
    ),

    "🎓 University library — closing time": (
        "large university library late at night, almost empty, "
        "high ceilings with wooden beams, reading lamps on individual tables, "
        "rows of shelves disappearing into darkness, "
        "scattered open books and laptops, "
        "the last two people who didn't notice it was closing time",
        "reading lamp pools — warm amber isolated circles on dark tables, "
        "emergency exit signs as red accents in the darkness, "
        "the shelves beyond each lamp pool in near-darkness",
        "total silence — the specific silence of a library that has emptied, "
        "the distant sound of a door somewhere, "
        "the creak of a wooden chair, pages turning",
        "student casual — hoodies, jeans, comfortable layers for long study sessions. "
        "The kind of clothes you forget you're wearing."
    ),

    "💋 Backstage — dressing room": (
        "performer's dressing room backstage, mirrors surrounded by bulb lights, "
        "makeup covering every surface, costume rail with multiple outfits, "
        "the show audible as a muffled roar through the walls, "
        "a door with a star on it, a chair in front of the lit mirror, "
        "the particular energy of pre or post-performance",
        "mirror bulb lights — warm and numerous, filling every shadow, "
        "the most flattering light that exists, skin luminous in it, "
        "no shadows, everything warm and golden",
        "the show through the walls — music and crowd reduced to bass and feeling, "
        "own breath after the performance, the creak of the costume rail, "
        "someone knocking on the door",
        "performer in stage costume or mid-change — "
        "sequins, feathers, minimal stage wear, or in the process of removing it. "
        "Stage makeup, hair styled. The costume is part of the character."
    ),

    "🏊 Pool — late night private swim": (
        "indoor swimming pool after hours, the building dark except for the underwater lights, "
        "blue-green light rippling across the ceiling and walls, "
        "the chemical smell of chlorine, "
        "an Olympic-length pool glowing from within, "
        "the ladder at the near end, towels on a bench, "
        "complete privacy — no one else here",
        "underwater LED pool lights as sole source — cool blue-green, "
        "ripple patterns dancing across every surface including skin, "
        "no overhead lights, everything lit from below and within",
        "water sounds amplified in the echoing space — "
        "drips, laps, the filter system, "
        "own breath in the tiled acoustic, "
        "the particular silence of a large indoor space at night",
        "swimwear — or nothing. "
        "The private late-night swim has its own wardrobe rules."
    ),

    "🎪 Circus tent — after the show": (
        "big top tent after the final performance, "
        "rigging and aerial equipment visible overhead, "
        "sawdust on the ground, empty tiered seating in darkness, "
        "a single spotlight still on in the ring, "
        "the smell of canvas and sawdust, "
        "props and apparatus visible in the shadows",
        "single ring spotlight as the only source — hard white cone on the sawdust, "
        "everything outside the spotlight in near-darkness, "
        "the performers caught between the light and shadow",
        "the tent settling — canvas moving in wind, "
        "distant voices of the crew packing up outside, "
        "the particular quiet after a crowd has left",
        "circus performer wear — leotard, sequins, aerial costume, "
        "or the informal layers worn over it when not performing. "
        "Theatrical and physical."
    ),

    "🌃 Rooftop pool — hotel, midnight": (
        "rooftop infinity pool on a high-floor hotel, "
        "city skyline visible in every direction, "
        "the pool edge appearing to merge with the city below, "
        "sun loungers at the pool's edge, a bar area to one side, "
        "steam rising from the heated water into the cool night air",
        "city ambient glow lifting the sky to deep blue-purple, "
        "pool underwater lights casting blue-white upward through the water, "
        "the pool edge lit from below — a glowing line against the city",
        "city hum far below — traffic, sirens absorbed into distance, "
        "water moving, the pool filter system, "
        "the particular silence of height",
        "swimwear — upscale resort style. "
        "The hotel rooftop pool at midnight has a specific clientele and aesthetic."
    ),

    "🏋 Gym — private session after hours": (
        "commercial gym after closing, equipment in rows, "
        "mirrors covering every wall, rubber floor, "
        "fluorescent lighting on half-power, "
        "the particular intimacy of a space designed for physical effort "
        "when only two people are in it",
        "half-power fluorescents — functional and slightly harsh, "
        "mirror reflections multiplying the light sources, "
        "equipment indicator LEDs as small accents",
        "equipment hum — treadmills powering down, "
        "the ventilation system, "
        "the specific echo of a large tiled space with no crowd",
        "gym wear — fitted, functional, sweat-appropriate. "
        "Leggings, sports bra, training shorts. "
        "The practical clothes of physical effort."
    ),

    "🎸 Recording studio — late session": (
        "professional recording studio late at night, "
        "the control room with mixing desk and monitors, "
        "soft acoustic panels on every wall, "
        "the live room visible through the glass, "
        "city invisible — no windows, no outside, "
        "the particular sealed world of a studio at 2am",
        "soft studio lighting — dimmable warm sources, "
        "mixing desk LED metering as a constant glow, "
        "monitor screens, "
        "the red ON AIR light",
        "monitor speakers at low volume — the track playing back, "
        "talkback mic clicks, "
        "the extreme acoustic isolation of a professional room — "
        "the city does not exist in here",
        "studio casual — whatever you wear for a 14-hour session. "
        "Comfortable layers, headphones around the neck, "
        "the informal uniform of creative work."
    ),

    "⛪ Church — empty, afternoon light": (
        "large empty church in afternoon, "
        "long nave with wooden pews, "
        "stained glass windows casting coloured light in columns, "
        "the altar visible at the far end, "
        "candles burning at a side chapel, "
        "the particular stillness of a sacred space between services",
        "stained glass afternoon light — rich coloured columns of red, blue, gold "
        "falling across the stone floor and pews, "
        "candle flicker at the side chapel, "
        "no electric light needed",
        "profound silence — the acoustic absorption of stone and wood, "
        "distant traffic completely muffled, "
        "a pigeon in the rafters, "
        "footsteps on stone echoing",
        "visitor clothing — respectful or deliberately not. "
        "The contrast between the sacred space and what happens in it "
        "is part of the scenario."
    ),

    # ── UPDATED POV STRIP ENVIRONMENTS WITH WARDROBE ─────────────────────────
    "POV — 🔥 Backroom — she is topless": (
        "private backroom of a strip club or adult venue, "
        "darker and more intimate than the main floor, "
        "a low couch or padded bench, dim red or pink lighting, "
        "the bass from the main room felt through the walls and floor, "
        "no stage — just a small private space and two people",
        "very low red or pink ambient — intimate and near-dark, "
        "a single dim overhead or strip light, "
        "the skin catching whatever light exists",
        "bass from the main floor constant through the walls — felt more than heard, "
        "her breath close, "
        "the particular muffled sound of a private room designed for this",
        "she is topless — wearing only panties, thong, or minimal bottoms. "
        "This is already established as the starting state. "
        "Camera at seated height. She is the subject and she is close."
    ),

    "POV — 💃 Lap dance — she strips as she dances": (
        "private booth or lap dance area, "
        "a single chair or bench, confined space, "
        "club lighting reaching here as a dim warm pulse, "
        "bass from the floor physical and constant",
        "dim warm amber and occasional colour pulse from the main floor, "
        "her skin catching the light as she moves",
        "club bass as physical presence, "
        "her breath, "
        "fabric sounds as clothing is removed",
        "she begins in stage costume — bodycon dress, lingerie set, or club wear — "
        "and removes it progressively through the scene. "
        "Beat 1: dressed. Beat 2: partially undressed. Beat 3: topless or minimal. "
        "Camera seated, receiving."
    ),



    "💃 Strip club — main floor": (
        "a strip club main floor at peak hour, a raised chrome-poled stage within reach, "
        "deep button-tufted velvet seating ringing it, a long backlit bar glowing across the "
        "room, dollar bills scattered on the stage edge, haze hanging in the air",
        "magenta and deep-blue stage wash cutting through haze, a slow-sweeping moving head "
        "spotlight, UV strips under the stage lip rim-lighting legs and heels, everything "
        "else falling to darkness between the beams",
        "muffled bass-heavy club music throbbing through the floor, glasses clinking, a low "
        "crowd murmur, heels striking the stage in rhythm"),

    "🔒 Private booth — POV": (
        "a small private VIP booth behind a heavy velvet curtain, a single low leather bench "
        "at knee height in the lower view, walls padded in dark suede close on three sides, "
        "a small mirrored ceiling tile glow strip turned low, the curtain's edge leaking a "
        "thin blade of club light",
        "one dim warm downlight directly overhead pooling on skin and leather, red LED trim "
        "at floor level underlighting everything in a soft crimson wash, the curtain gap "
        "strobing faint magenta with the club lights outside",
        "the club's bass reduced to a deep muffled pulse through the walls, the curtain "
        "rings sliding once, breath and fabric suddenly loud in the small padded space"),

    # ── POV — WOW + HEAT (built for first-person: grippable foreground, light that
    #    flatters whoever faces the view, close/far sound layers, no mirrors) ────
    "🌌 POV · Infinity pool penthouse — night skyline": (
        "rooftop infinity pool at night, warm water at chest height filling the lower view, "
        "the tiled pool edge within arm's reach, water spilling over the vanishing edge into "
        "a sheer drop, a glittering city grid spread out far below, steam curling off the "
        "surface into cool night air, droplets beading on skin and stone",
        "cool blue underwater pool lights glowing up through the water, warm city sodium "
        "glow washing in from below the horizon line, wet skin catching both — cyan from "
        "beneath, amber rim from the skyline",
        "water lapping softly against tile, the muffled hum of the city far below, a slow "
        "trickle over the infinity edge, wet skin breaking the surface"),

    "🛩 POV · Private jet cabin — cruising altitude": (
        "private jet cabin at cruising altitude, cream leather seat backs and glossy walnut "
        "trim at arm's reach, a champagne flute fizzing on the fold-out table, portholes in "
        "a row down the fuselage showing a blinding white cloud deck below, seatbelt straps "
        "hanging loose, the aisle narrow enough to touch both sides",
        "hard white high-altitude sunlight knifing through the portholes in tight beams, "
        "bouncing off the cream leather as soft fill, everything above the cloud line "
        "over-bright and clean",
        "the steady muffled roar of the engines, ice shifting in a glass, leather creaking "
        "under weight, the pressurised hush underneath everything"),

    "⛈ POV · Storm balcony — lightning over black sea": (
        "a wide hotel balcony rail at hip height in the lower view, rain-slick stone "
        "underfoot, a black ocean churning below, colossal storm clouds stacked to the "
        "horizon, sheets of warm rain drifting across the balcony edge, wet glass doors "
        "standing open behind, curtains snapping in the wind",
        "near-darkness ripped open by lightning — each strike a full-frame white flash that "
        "freezes rain mid-air and silhouettes everything for a single frame, then deep blue "
        "afterglow, wet surfaces flaring with every bolt",
        "rolling thunder arriving seconds after each flash, hard rain drumming stone, wind "
        "gusting across the balcony, the sea booming against rocks far below"),

    "🕯 POV · Candlelit hammam — steam and stone": (
        "an ancient stone bath house, a hundred candles crowding every ledge and alcove, "
        "thick steam hanging in slow layers, a raised marble slab warm and wet at the "
        "centre within reach, water channels cut into the floor, carved archways receding "
        "into darkness, condensation running down domed stone overhead",
        "massed candle flames as the only source — deep amber light flickering across wet "
        "marble and skin, steam glowing gold where it crosses a flame, shadows breathing "
        "with the candle flicker",
        "water dripping from the dome in irregular echoes, the hiss of steam off hot stone, "
        "a ladle of water poured and spreading, every sound doubled by the stone acoustics"),

    "🧖 POV · Mountain onsen — snowfall at night": (
        "an outdoor hot spring pool ringed with dark volcanic rock, steaming water at chest "
        "height in the lower view, thick snowflakes falling slow and vertical out of a black "
        "sky, snow banked on every rock edge within reach, a single paper lantern on a cedar "
        "post, pine forest as a dark wall beyond the steam",
        "the lantern's warm orange pool of light against blue-black night, steam glowing "
        "where it crosses the light, snowflakes flaring orange as they pass the lantern then "
        "vanishing into the water",
        "the soft constant hush of falling snow, water trickling over rock into the pool, "
        "steam rising with a faint mineral hiss, absolute mountain silence underneath"),

    "🏰 POV · Four-poster suite — silk canopy": (
        "a vast four-poster bed filling the view, carved dark-wood posts at the corners "
        "within reach, deep crimson silk canopy directly overhead when the view tips back, "
        "heavy sheets pooling in folds, a stone fireplace throwing light from across the "
        "room, tall leaded windows showing black night beyond",
        "firelight from the side — warm orange light rippling across the silk canopy and "
        "sheets, deep soft shadows inside the bed's frame, skin lit in moving amber",
        "the fire cracking and settling, silk sliding over silk, the wooden frame creaking, "
        "wind pressing faintly at the old windows"),

    "🚗 POV · Chauffeured back seat — neon through rain": (
        "the deep back seat of a long black car at night, quilted black leather close on "
        "every side, a raised privacy divider ahead, rain crawling sideways across the "
        "windows, the city outside reduced to smeared neon ribbons sliding past, a low "
        "amber footwell glow, the seat wide enough to be a room",
        "neon signs strobing through rain-streaked glass — pink, cyan, gold washing through "
        "the cabin in moving bands, each colour sliding across leather and skin as the car "
        "moves, darkness between the lights",
        "rain drumming the roof, tyres hissing on wet asphalt, the engine a distant purr "
        "behind the divider, leather creaking close and loud"),

    "🛥 POV · Yacht aft deck — bioluminescent cove": (
        "the wide teak aft deck of an anchored yacht at night, deck rail and cushioned "
        "sunbed within reach, a sheltered cove of black glass water below, every ripple "
        "igniting electric blue bioluminescence, a spill of stars overhead, the dark shape "
        "of cliffs ringing the bay",
        "cold blue-green light blooming up from the water with every movement, faint warm "
        "deck lights at ankle height, starlight silver on the rail — skin lit from below in "
        "moving aqua",
        "water slapping the hull in a slow rhythm, the anchor chain shifting once, a warm "
        "wind in the rigging, splashes igniting with an audible fizz of surf"),

    "🔥 POV · Fire-lit cabin rug — blizzard outside": (
        "a thick sheepskin rug filling the lower view, an open stone fireplace roaring at "
        "arm's reach, rough timber walls, a single window packed white with a howling "
        "blizzard, a bottle and two glasses on the hearth stone, heat shimmering the air "
        "above the flames",
        "the fire as sole source — hard flickering orange from one side, deep black shadow "
        "on the other, sparks rising, the window a cold blue-white rectangle in the dark "
        "wall",
        "the fire roaring and popping close and loud, wind screaming past the eaves, snow "
        "hissing against the glass, wool shifting under weight"),

    "🌃 POV · Floor-to-ceiling glass — sixty floors up": (
        "a dark penthouse room with one entire wall of floor-to-ceiling glass, the pane "
        "cold and flawless within touching distance, a city of light spread sixty floors "
        "below stretching to the horizon, aircraft warning lights pulsing on distant "
        "towers, the room behind reflected as nothing but darkness — furniture bare "
        "silhouettes",
        "no interior light — the city itself lights the room, a cool blue-white upglow "
        "through the glass with warm sodium patches, anyone against the window rim-lit by "
        "a million distant windows",
        "near silence — the building's deep hum, a faint siren rising and fading far "
        "below, breath audible against the glass, a fingertip squeak on the pane"),

    "⛩ POV · Tokyo love-hotel — neon through blinds": (
        "a compact love-hotel room at night, a low wide bed filling most of the floor, "
        "venetian blinds slicing a giant pink-and-cyan neon sign outside into glowing "
        "stripes, a padded vinyl headboard within reach, a small console of glowing "
        "buttons on the wall, rain tapping the single window",
        "the neon outside as the only light — hard pink and cyan bands laddering across "
        "the bed and every surface through the blinds, colours flipping as the sign "
        "cycles, black shadow between the stripes",
        "rain on glass, the neon sign's electric buzz bleeding through the wall, a train "
        "passing somewhere below, the vinyl headboard creaking"),

    "🏜 POV · Desert blanket — Milky Way overhead": (
        "a thick woven blanket spread on still-warm desert sand, the lower view filled "
        "with its pattern and a low lantern turned down to a glow, dunes rolling away in "
        "pale moon-silver ridges, and when the view tips up — the full Milky Way in "
        "staggering detail across a jet-black sky, no light pollution to the horizon",
        "starlight and a sliver of moon — cold silver-blue on the dunes, the lantern's "
        "tiny warm amber pool on the blanket, skin half silver half amber where the two "
        "lights meet",
        "total desert silence with a faint wind moving sand grain by grain, the blanket "
        "shifting, breath enormous in the quiet, a distant single coyote call"),

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
