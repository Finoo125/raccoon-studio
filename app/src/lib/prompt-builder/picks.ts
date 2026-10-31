/**
 * The Prompt Helper's picks and the pure text functions behind them. The
 * prompt box is the only state: a pick is "lit" when its phrase is in the
 * prompt, so hand edits and picks can never disagree. No React, no I/O.
 */

/** How a model wants its prompt: plain sentences, or comma-separated Danbooru tags. */
export type PromptStyle = 'sentences' | 'tags'

export interface PromptPick {
  id: string
  label: string
  /** Words for sentence models; absent = not offered to them. */
  sentence?: string
  /** Words for tag models; absent = not offered to them. */
  tags?: string
  /** Racy (lingerie, boudoir, a large bust): offered and surprised only with the 18+ switch on. */
  adult?: true
  /** An animal, creature or machine: people rows don't apply to it. */
  nonHuman?: true
  /** Two or more people: Acts and Positions apply. */
  partners?: true
  /** Who picks: a woman / a man is in it — what the needs* flags below are checked against. */
  woman?: true
  man?: true
  /** Only makes sense with a woman / a man in Who ("cupping her breasts", "giving a blowjob"). Surprise and a Who change respect it. */
  needsWoman?: true
  needsMan?: true
}

export type PickRowId =
  | 'who' | 'body' | 'skin' | 'hair' | 'haircolor' | 'face' | 'wear' | 'pose' | 'where' | 'time' | 'light'
  | 'shot' | 'colors' | 'look' | 'nudity' | 'outfit' | 'sensual' | 'act' | 'position'
  // Video Edit's "Swap head" rows only (edit-writer.ts); not in PICK_ROWS.
  | 'age' | 'faceshape' | 'eyes'

export interface PickRow {
  id: PickRowId
  label: string
  emoji: string
  /** Needs a person in Who (hair, clothes, faces, every 18+ topic). */
  forPeople?: true
  /** 18+ topic: shown and surprised only with the 18+ switch on. */
  nsfw?: true
  /** Acts and positions: need a Who of two or more people. */
  needsPartners?: true
  /** Nudity and sexy outfits: Surprise drops the Clothes pick when it picks one of these. */
  replacesClothes?: true
  picks: PromptPick[]
}

// Adults only — picks.test.ts scans every label and phrase for minors, non-consent, incest and violence.
export const PICK_ROWS: PickRow[] = [
  { id: 'who', label: 'Who', emoji: '👤', picks: [
    { id: 'woman', label: 'Woman', sentence: 'a woman', tags: '1girl, solo, adult', woman: true },
    { id: 'man', label: 'Man', sentence: 'a man', tags: '1boy, solo, adult', man: true },
    { id: 'couple', label: 'Couple', sentence: 'a couple', tags: '1boy, 1girl, couple, mature_female, mature_male', partners: true, woman: true, man: true },
    { id: 'two-women', label: 'Two women', sentence: 'two women', tags: '2girls, yuri, mature_female', partners: true, woman: true },
    { id: 'two-men', label: 'Two men', sentence: 'two men', tags: '2boys, yaoi, mature_male', partners: true, man: true },
    { id: 'mmf', label: 'Woman + 2 men', sentence: 'a threesome with one woman and two guys', tags: 'threesome, 2boys, 1girl, mature_female, mature_male', partners: true, woman: true, man: true },
    { id: 'ffm', label: '2 women + man', sentence: 'a threesome with two ladies and one guy', tags: 'threesome, 1boy, 2girls, mature_female, mature_male', partners: true, woman: true, man: true },
    { id: 'older-woman', label: 'Older woman', sentence: 'an elegant older woman', tags: 'mature_female, old_woman', woman: true },
    { id: 'older-man', label: 'Older man', sentence: 'an older man with a grey beard', tags: 'old_man, grey_hair', man: true },
    { id: 'vampire', label: 'Vampire', sentence: 'a seductive vampire woman', tags: 'vampire, fangs, mature_female', woman: true },
    { id: 'cat', label: 'Cat', sentence: 'a fluffy cat', tags: 'cat, no_humans', nonHuman: true },
    { id: 'dog', label: 'Dog', sentence: 'a friendly dog', tags: 'dog, no_humans', nonHuman: true },
    { id: 'dragon', label: 'Dragon', sentence: 'a majestic dragon', tags: 'dragon, no_humans', nonHuman: true },
    { id: 'robot', label: 'Robot', sentence: 'a humanoid robot', tags: 'robot, mecha', nonHuman: true },
  ]},
  { id: 'body', label: 'Body', emoji: '🏋️', forPeople: true, picks: [
    { id: 'slim', label: 'Slim', sentence: 'with a slim figure', tags: 'slender' },
    { id: 'curvy', label: 'Curvy', sentence: 'with a curvy hourglass figure', tags: 'curvy, wide_hips', needsWoman: true },
    { id: 'athletic', label: 'Athletic', sentence: 'with an athletic, toned body', tags: 'toned' },
    { id: 'fitness', label: 'Fitness', sentence: 'with a fitness model physique and defined abs', tags: 'abs, fit' },
    { id: 'muscular', label: 'Muscular', sentence: 'with a muscular body', tags: 'muscular' },
    { id: 'muscle-woman', label: 'Muscle woman', sentence: 'with a strong muscular female physique', tags: 'muscular_female', needsWoman: true },
    { id: 'bodybuilder', label: 'Bodybuilder', sentence: 'with a huge bodybuilder physique', tags: 'bodybuilder, huge_muscles' },
    { id: 'thick', label: 'Thick', sentence: 'with a thick, voluptuous body', tags: 'thick_thighs, wide_hips' },
    { id: 'plus', label: 'Plus-size', sentence: 'with a plus-size figure', tags: 'plump' },
    { id: 'tall', label: 'Tall', sentence: 'tall and long-legged', tags: 'tall, long_legs' },
    { id: 'busty', label: 'Busty', sentence: 'with a large bust', tags: 'large_breasts', adult: true, needsWoman: true },
  ]},
  { id: 'skin', label: 'Skin', emoji: '🧴', forPeople: true, picks: [
    { id: 'pale', label: 'Pale', sentence: 'with pale porcelain skin', tags: 'pale_skin' },
    { id: 'fair', label: 'Fair', sentence: 'with fair skin', tags: 'fair_skin' },
    { id: 'olive', label: 'Olive', sentence: 'with olive skin', tags: 'olive_skin' },
    { id: 'tanned', label: 'Tanned', sentence: 'with sun-tanned skin', tags: 'tan' },
    { id: 'dark', label: 'Dark', sentence: 'with dark ebony skin', tags: 'dark_skin' },
    { id: 'freckles', label: 'Freckles', sentence: 'with freckles', tags: 'freckles' },
    { id: 'tanlines', label: 'Tan lines', sentence: 'with tan lines', tags: 'tanlines' },
  ]},
  { id: 'hair', label: 'Hair', emoji: '💇', forPeople: true, picks: [
    { id: 'long', label: 'Long', sentence: 'with long flowing hair', tags: 'long_hair' },
    { id: 'short', label: 'Short', sentence: 'with short hair', tags: 'short_hair' },
    { id: 'bob', label: 'Bob', sentence: 'with a sleek bob cut', tags: 'bob_cut' },
    { id: 'wavy', label: 'Wavy', sentence: 'with wavy shoulder-length hair', tags: 'wavy_hair, medium_hair' },
    { id: 'curly', label: 'Curly', sentence: 'with curly hair', tags: 'curly_hair' },
    { id: 'ponytail', label: 'Ponytail', sentence: 'with a ponytail', tags: 'ponytail' },
    { id: 'braids', label: 'Braids', sentence: 'with braided hair', tags: 'braid' },
    { id: 'bun', label: 'Bun', sentence: 'with hair tied in a bun', tags: 'hair_bun' },
    { id: 'updo', label: 'Updo', sentence: 'with an elegant updo', tags: 'updo' },
    { id: 'messy', label: 'Messy', sentence: 'with messy bed hair', tags: 'messy_hair' },
    { id: 'wet', label: 'Wet', sentence: 'with wet slicked-back hair', tags: 'wet_hair' },
    { id: 'side-swept', label: 'Side-swept', sentence: 'with long side-swept hair', tags: 'swept_bangs' },
    { id: 'afro', label: 'Afro', sentence: 'with a voluminous afro', tags: 'afro' },
    { id: 'shaved', label: 'Shaved', sentence: 'with a shaved head', tags: 'bald' },
  ]},
  { id: 'haircolor', label: 'Hair color', emoji: '🎨', forPeople: true, picks: [
    { id: 'blonde', label: 'Blonde', sentence: 'with blonde hair', tags: 'blonde_hair' },
    { id: 'platinum', label: 'Platinum', sentence: 'with platinum blonde hair', tags: 'platinum_blonde_hair' },
    { id: 'brown', label: 'Brown', sentence: 'with brown hair', tags: 'brown_hair' },
    { id: 'black', label: 'Black', sentence: 'with black hair', tags: 'black_hair' },
    { id: 'red', label: 'Red', sentence: 'with red hair', tags: 'red_hair' },
    { id: 'ginger', label: 'Ginger', sentence: 'with copper ginger hair', tags: 'orange_hair' },
    { id: 'silver', label: 'Silver', sentence: 'with silver hair', tags: 'silver_hair' },
    { id: 'pink', label: 'Pink', sentence: 'with pastel pink hair', tags: 'pink_hair' },
    { id: 'blue', label: 'Blue', sentence: 'with blue hair', tags: 'blue_hair' },
    { id: 'purple', label: 'Purple', sentence: 'with purple hair', tags: 'purple_hair' },
    { id: 'green', label: 'Green', sentence: 'with emerald green hair', tags: 'green_hair' },
    { id: 'ombre', label: 'Ombre', sentence: 'with ombre hair', tags: 'gradient_hair' },
  ]},
  { id: 'face', label: 'Expression', emoji: '🙂', forPeople: true, picks: [
    { id: 'smiling', label: 'Smiling', sentence: 'smiling warmly', tags: 'smile' },
    { id: 'laughing', label: 'Laughing', sentence: 'laughing happily', tags: 'laughing' },
    { id: 'serious', label: 'Serious', sentence: 'with a serious expression', tags: 'serious' },
    { id: 'calm', label: 'Calm', sentence: 'with a calm, relaxed expression', tags: 'relaxed, closed_mouth' },
    { id: 'surprised', label: 'Surprised', sentence: 'looking surprised', tags: 'surprised' },
    { id: 'confident', label: 'Confident', sentence: 'with a confident smirk', tags: 'smirk' },
    { id: 'dreamy', label: 'Dreamy', sentence: 'with a dreamy, faraway look', tags: 'half-closed_eyes' },
    { id: 'shy', label: 'Shy', sentence: 'blushing shyly', tags: 'blush, shy' },
    { id: 'seductive', label: 'Seductive', sentence: 'with a seductive look', tags: 'seductive_smile' },
    { id: 'wink', label: 'Wink', sentence: 'winking playfully', tags: 'one_eye_closed' },
    { id: 'pout', label: 'Pout', sentence: 'pouting', tags: 'pout' },
    { id: 'fierce', label: 'Fierce', sentence: 'with a fierce, intense look', tags: 'glaring' },
    { id: 'lip-bite', label: 'Lip bite', sentence: 'biting the lower lip', tags: 'lip_biting' },
  ]},
  { id: 'wear', label: 'Clothes', emoji: '👗', forPeople: true, picks: [
    { id: 'casual', label: 'Casual', sentence: 'in jeans and a t-shirt', tags: 'casual, jeans, t-shirt' },
    { id: 'dress', label: 'Elegant dress', sentence: 'in an elegant evening dress', tags: 'evening_gown', needsWoman: true },
    { id: 'little-black', label: 'Little black dress', sentence: 'in a little black dress', tags: 'black_dress', needsWoman: true },
    { id: 'sundress', label: 'Sundress', sentence: 'in a flowy summer dress', tags: 'sundress', needsWoman: true },
    { id: 'gown', label: 'Ball gown', sentence: 'in a red ball gown', tags: 'ball_gown', needsWoman: true },
    { id: 'suit', label: 'Suit', sentence: 'in a tailored suit', tags: 'formal, suit' },
    { id: 'business', label: 'Business', sentence: 'in a fitted business outfit', tags: 'office_lady' },
    { id: 'leather', label: 'Leather', sentence: 'in a leather jacket and jeans', tags: 'leather_jacket' },
    { id: 'crop', label: 'Crop top', sentence: 'in a crop top and shorts', tags: 'crop_top, short_shorts' },
    { id: 'sportswear', label: 'Sportswear', sentence: 'in sportswear', tags: 'sportswear' },
    { id: 'yoga', label: 'Yoga', sentence: 'in yoga pants and a sports bra', tags: 'yoga_pants, sports_bra', needsWoman: true },
    { id: 'swimwear', label: 'Swimwear', sentence: 'in swimwear', tags: 'swimsuit' },
    { id: 'bikini', label: 'Bikini', sentence: 'in a bikini', tags: 'bikini', needsWoman: true },
    { id: 'lingerie', label: 'Lingerie', sentence: 'in lace lingerie', tags: 'lingerie, lace', adult: true, needsWoman: true },
    { id: 'armor', label: 'Armor', sentence: 'in fantasy armor', tags: 'armor' },
    { id: 'winter', label: 'Winter coat', sentence: 'in a warm winter coat and scarf', tags: 'winter_clothes, coat, scarf' },
    { id: 'kimono', label: 'Kimono', sentence: 'in a traditional kimono', tags: 'kimono' },
  ]},
  { id: 'pose', label: 'Pose', emoji: '🧍', forPeople: true, picks: [
    { id: 'standing', label: 'Standing', sentence: 'standing confidently', tags: 'standing' },
    { id: 'sitting', label: 'Sitting', sentence: 'sitting on a chair', tags: 'sitting' },
    { id: 'walking', label: 'Walking', sentence: 'walking towards the camera', tags: 'walking' },
    { id: 'lying', label: 'Lying', sentence: 'lying on one side', tags: 'lying, on_side' },
    { id: 'leaning', label: 'Leaning', sentence: 'leaning against a wall', tags: 'against_wall' },
    { id: 'hips', label: 'Hands on hips', sentence: 'with hands on hips', tags: 'hands_on_hips' },
    { id: 'crossed', label: 'Arms crossed', sentence: 'with arms crossed', tags: 'crossed_arms' },
    { id: 'looking-back', label: 'Looking back', sentence: 'looking back over the shoulder', tags: 'looking_back' },
    { id: 'dancing', label: 'Dancing', sentence: 'dancing', tags: 'dancing' },
    { id: 'running', label: 'Running', sentence: 'running at full speed', tags: 'running' },
    { id: 'flexing', label: 'Flexing', sentence: 'flexing strong muscles', tags: 'flexing' },
    { id: 'hair-touch', label: 'Hand in hair', sentence: 'running a hand through the hair', tags: 'hand_in_own_hair' },
    { id: 'stretching', label: 'Stretching', sentence: 'stretching', tags: 'stretching' },
    { id: 'jumping', label: 'Jumping', sentence: 'jumping in the air', tags: 'jumping' },
  ]},
  { id: 'where', label: 'Place', emoji: '📍', picks: [
    { id: 'city', label: 'City', sentence: 'on a busy city street', tags: 'city, street, outdoors' },
    { id: 'beach', label: 'Beach', sentence: 'on a sunny beach', tags: 'beach, ocean' },
    { id: 'forest', label: 'Forest', sentence: 'in a misty forest', tags: 'forest, nature' },
    { id: 'room', label: 'Cozy room', sentence: 'in a cozy living room', tags: 'indoors, living_room' },
    { id: 'cafe', label: 'Café', sentence: 'in a small café', tags: 'cafe, indoors' },
    { id: 'mountains', label: 'Mountains', sentence: 'in the mountains', tags: 'mountain, landscape' },
    { id: 'studio', label: 'Studio', sentence: 'in front of a plain studio backdrop', tags: 'simple_background' },
    { id: 'castle', label: 'Castle', sentence: 'in a fantasy castle hall', tags: 'castle, fantasy' },
    { id: 'scifi', label: 'Sci-fi city', sentence: 'in a futuristic neon city', tags: 'cyberpunk, futuristic_city' },
    { id: 'gym', label: 'Gym', sentence: 'in a gym', tags: 'gym, indoors' },
    { id: 'bedroom', label: 'Bedroom', sentence: 'in a luxurious bedroom', tags: 'bedroom' },
    { id: 'bathroom', label: 'Bathroom', sentence: 'in a marble bathroom', tags: 'bathroom' },
    { id: 'pool', label: 'Pool', sentence: 'by a swimming pool', tags: 'pool' },
    { id: 'hotel', label: 'Hotel', sentence: 'in a hotel suite', tags: 'hotel_room' },
    { id: 'rooftop', label: 'Rooftop', sentence: 'on a city rooftop', tags: 'rooftop' },
    { id: 'desert', label: 'Desert', sentence: 'in a sunny desert', tags: 'desert' },
    { id: 'waterfall', label: 'Waterfall', sentence: 'by a jungle waterfall', tags: 'waterfall, jungle' },
    { id: 'nightclub', label: 'Nightclub', sentence: 'in a nightclub', tags: 'nightclub' },
  ]},
  { id: 'time', label: 'Time & weather', emoji: '🌦', picks: [
    { id: 'sunrise', label: 'Sunrise', sentence: 'at sunrise', tags: 'sunrise' },
    { id: 'sunny', label: 'Sunny', sentence: 'on a bright sunny day', tags: 'sunny, blue_sky' },
    { id: 'sunset', label: 'Sunset', sentence: 'at sunset', tags: 'sunset' },
    { id: 'dusk', label: 'Dusk', sentence: 'at dusk', tags: 'twilight' },
    { id: 'night', label: 'Night', sentence: 'at night under a starry sky', tags: 'night, starry_sky' },
    { id: 'rain', label: 'Rain', sentence: 'in the pouring rain', tags: 'rain, wet' },
    { id: 'storm', label: 'Storm', sentence: 'during a thunderstorm', tags: 'storm, lightning' },
    { id: 'snow', label: 'Snow', sentence: 'in gently falling snow', tags: 'snowing, snow' },
    { id: 'fog', label: 'Fog', sentence: 'in thick morning fog', tags: 'fog' },
    { id: 'spring', label: 'Spring', sentence: 'on a fresh spring morning', tags: 'spring_(season)' },
    { id: 'summer', label: 'Summer', sentence: 'on a hot summer day', tags: 'summer' },
    { id: 'autumn', label: 'Autumn', sentence: 'among golden autumn leaves', tags: 'autumn_leaves' },
    { id: 'blossoms', label: 'Blossoms', sentence: 'under cherry blossoms', tags: 'cherry_blossoms' },
  ]},
  { id: 'light', label: 'Light', emoji: '💡', picks: [
    { id: 'golden', label: 'Golden hour', sentence: 'in warm golden hour light', tags: 'golden_hour, sunlight' },
    { id: 'daylight', label: 'Soft daylight', sentence: 'in soft natural daylight', tags: 'day, soft_lighting' },
    { id: 'neon', label: 'Neon', sentence: 'lit by colorful neon lights', tags: 'neon_lights' },
    { id: 'candle', label: 'Candlelight', sentence: 'by warm candlelight', tags: 'candlelight' },
    { id: 'studio-light', label: 'Studio light', sentence: 'with bright studio lighting', tags: 'studio_lighting' },
    { id: 'moody', label: 'Moody', sentence: 'with dark, moody shadows', tags: 'dark, dramatic_lighting' },
    { id: 'backlight', label: 'Backlight', sentence: 'with a glowing backlight', tags: 'backlighting' },
    { id: 'window', label: 'Window light', sentence: 'in soft window light', tags: 'window_light' },
    { id: 'rim', label: 'Rim light', sentence: 'with dramatic rim light', tags: 'rim_lighting' },
    { id: 'spotlight', label: 'Spotlight', sentence: 'under a single spotlight', tags: 'spotlight' },
    { id: 'fire', label: 'Firelight', sentence: 'by the glow of a fireplace', tags: 'fireplace' },
    { id: 'blue-hour', label: 'Blue hour', sentence: 'in cool blue-hour light', tags: 'blue_hour' },
    { id: 'glow', label: 'Dreamy glow', sentence: 'in a soft dreamy glow', tags: 'soft_glow' },
  ]},
  { id: 'shot', label: 'Camera', emoji: '📷', picks: [
    { id: 'closeup', label: 'Close-up', sentence: 'close-up portrait', tags: 'portrait, close-up' },
    { id: 'face', label: 'Face close-up', sentence: 'extreme close-up of the face', tags: 'face_focus' },
    { id: 'half', label: 'Half body', sentence: 'half-body shot', tags: 'upper_body' },
    { id: 'full', label: 'Full body', sentence: 'full-body shot', tags: 'full_body' },
    { id: 'wide', label: 'Wide', sentence: 'wide shot showing the whole scene', tags: 'wide_shot, scenery' },
    { id: 'above', label: 'From above', sentence: 'seen from above', tags: 'from_above' },
    { id: 'below', label: 'From below', sentence: 'seen from below', tags: 'from_below' },
    { id: 'behind', label: 'From behind', sentence: 'seen from behind', tags: 'from_behind' },
    { id: 'profile', label: 'Profile', sentence: 'in profile', tags: 'profile' },
    { id: 'eyes', label: 'Eye contact', sentence: 'looking at the camera', tags: 'looking_at_viewer' },
    { id: 'selfie', label: 'Selfie', sentence: 'taking a selfie', tags: 'selfie' },
    { id: 'pov', label: 'POV', sentence: 'from a first-person point of view', tags: 'pov' },
    { id: 'dutch', label: 'Dutch angle', sentence: 'with a tilted dutch angle', tags: 'dutch_angle' },
  ]},
  { id: 'colors', label: 'Colors', emoji: '🖍', picks: [
    { id: 'warm', label: 'Warm', sentence: 'in warm, golden colors', tags: 'warm_colors' },
    { id: 'cool', label: 'Cool', sentence: 'in cool blue tones', tags: 'blue_theme' },
    { id: 'pastel', label: 'Pastel', sentence: 'in soft pastel colors', tags: 'pastel_colors' },
    { id: 'vibrant', label: 'Vibrant', sentence: 'in bold, vibrant colors', tags: 'vibrant_colors' },
    { id: 'muted', label: 'Muted', sentence: 'in muted, faded colors', tags: 'muted_color' },
    { id: 'bw', label: 'Black & white', sentence: 'in black and white', tags: 'greyscale' },
    { id: 'earthy', label: 'Earthy', sentence: 'in earthy natural tones', tags: 'brown_theme' },
    { id: 'neon-colors', label: 'Neon colors', sentence: 'in glowing neon colors', tags: 'neon_palette' },
    { id: 'red-black', label: 'Red & black', sentence: 'in red and black tones', tags: 'red_theme' },
    { id: 'gold', label: 'Gold', sentence: 'in rich gold tones', tags: 'gold_theme' },
  ]},
  { id: 'look', label: 'Style', emoji: '✨', picks: [
    { id: 'photo', label: 'Photo', sentence: 'a natural, realistic photo' },
    { id: 'glamour', label: 'Glamour', sentence: 'glamour photography with a soft glow' },
    { id: 'cinematic', label: 'Cinematic', sentence: 'cinematic film still, shallow depth of field' },
    { id: 'film', label: 'Analog film', sentence: '35mm analog film photo with soft grain' },
    { id: 'fashion', label: 'Fashion', sentence: 'high-end fashion photography' },
    { id: 'boudoir', label: 'Boudoir', sentence: 'boudoir photography', adult: true },
    { id: 'vintage', label: 'Vintage', sentence: 'vintage 1970s photo, faded colors' },
    { id: 'painting', label: 'Painting', sentence: 'oil painting', tags: 'painting_(medium)' },
    { id: 'watercolor', label: 'Watercolor', sentence: 'soft watercolor painting', tags: 'watercolor_(medium)' },
    { id: 'anime', label: 'Anime', sentence: 'anime illustration', tags: 'anime_coloring' },
    { id: 'sketch', label: 'Sketch', sentence: 'pencil sketch', tags: 'sketch, monochrome' },
    { id: '3d', label: '3D render', sentence: 'a 3D render', tags: '3d' },
    { id: 'comic', label: 'Comic', sentence: 'comic book art', tags: 'comic' },
    { id: 'pin-up', label: 'Pin-up', sentence: 'retro pin-up art', tags: 'pin-up' },
    { id: 'retro-anime', label: 'Retro anime', tags: '1990s_(style), retro_artstyle' },
    { id: 'flat', label: 'Flat colors', tags: 'flat_color' },
  ]},
  { id: 'nudity', label: 'Nudity', emoji: '🔞', forPeople: true, nsfw: true, replacesClothes: true, picks: [
    { id: 'implied', label: 'Implied', sentence: 'implied nudity, strategically covered', tags: 'convenient_censoring' },
    { id: 'topless', label: 'Topless', sentence: 'topless', tags: 'topless' },
    { id: 'bottomless', label: 'Bottomless', sentence: 'bottomless', tags: 'bottomless' },
    { id: 'nude', label: 'Nude', sentence: 'fully nude', tags: 'completely_nude' },
    { id: 'undressing', label: 'Undressing', sentence: 'undressing', tags: 'undressing' },
    { id: 'see-through', label: 'See-through', sentence: 'in see-through clothes', tags: 'see-through' },
    { id: 'wet-skin', label: 'Wet skin', sentence: 'with wet, glistening skin', tags: 'wet_skin' },
  ]},
  { id: 'outfit', label: 'Sexy outfits', emoji: '💋', forPeople: true, nsfw: true, replacesClothes: true, picks: [
    { id: 'bodysuit', label: 'Lace bodysuit', sentence: 'in a sheer lace bodysuit', tags: 'bodysuit, lace', needsWoman: true },
    { id: 'latex', label: 'Latex', sentence: 'in a shiny latex catsuit', tags: 'latex, catsuit' },
    { id: 'fishnets', label: 'Fishnets', sentence: 'in fishnet stockings', tags: 'fishnet_thighhighs', needsWoman: true },
    { id: 'garter', label: 'Garter', sentence: 'in stockings and a garter belt', tags: 'garter_belt, thighhighs', needsWoman: true },
    { id: 'corset', label: 'Corset', sentence: 'in a tight corset', tags: 'corset', needsWoman: true },
    { id: 'robe', label: 'Silk robe', sentence: 'in an open silk robe', tags: 'open_robe' },
    { id: 'micro', label: 'Micro bikini', sentence: 'in a micro bikini', tags: 'micro_bikini', needsWoman: true },
    { id: 'thong', label: 'Thong', sentence: 'in a thong', tags: 'thong' },
    { id: 'harness', label: 'Harness', sentence: 'in a leather harness', tags: 'harness' },
    { id: 'shirt-only', label: 'Shirt only', sentence: 'wearing only an oversized shirt', tags: 'naked_shirt' },
    { id: 'towel', label: 'Towel', sentence: 'wrapped in a towel', tags: 'naked_towel' },
    { id: 'heels', label: 'Heels only', sentence: 'wearing only high heels', tags: 'high_heels, nude', needsWoman: true },
  ]},
  { id: 'sensual', label: 'Sensual poses', emoji: '🔥', forPeople: true, nsfw: true, picks: [
    { id: 'on-bed', label: 'On the bed', sentence: 'lying seductively on a bed', tags: 'lying, on_bed' },
    { id: 'arched', label: 'Arched back', sentence: 'with an arched back', tags: 'arched_back' },
    { id: 'over-shoulder', label: 'Over the shoulder', sentence: 'glancing seductively over the shoulder', tags: 'looking_over_shoulder' },
    { id: 'kneeling', label: 'Kneeling', sentence: 'kneeling on the bed', tags: 'kneeling, on_bed' },
    { id: 'all-fours', label: 'All fours', sentence: 'on all fours', tags: 'all_fours' },
    { id: 'spread', label: 'Legs spread', sentence: 'with legs spread', tags: 'spread_legs' },
    { id: 'bent-over', label: 'Bent over', sentence: 'bent over', tags: 'bent_over' },
    { id: 'touching', label: 'Touching herself', sentence: 'touching herself', tags: 'masturbation', needsWoman: true },
    { id: 'chest', label: 'Hands on chest', sentence: 'cupping her breasts', tags: 'grabbing_own_breast', needsWoman: true },
    { id: 'shower', label: 'Shower', sentence: 'posing in the shower', tags: 'showering' },
    { id: 'straddling', label: 'Straddling', sentence: 'straddling a chair', tags: 'straddling, chair' },
    { id: 'legs-up', label: 'Legs up', sentence: 'lying back with legs raised', tags: 'legs_up' },
  ]},
  { id: 'act', label: 'Acts', emoji: '❤️‍🔥', forPeople: true, nsfw: true, needsPartners: true, picks: [
    { id: 'kissing', label: 'Kissing', sentence: 'kissing passionately', tags: 'kissing' },
    { id: 'making-out', label: 'Making out', sentence: 'making out, hands all over each other', tags: 'french_kiss' },
    { id: 'undressing-each', label: 'Undressing each other', sentence: "stripping each other's clothes off", tags: 'undressing_another' },
    { id: 'blowjob', label: 'Blowjob', sentence: 'giving a blowjob', tags: 'fellatio', needsMan: true },
    { id: 'cunnilingus', label: 'Cunnilingus', sentence: 'receiving cunnilingus', tags: 'cunnilingus', needsWoman: true },
    { id: 'handjob', label: 'Handjob', sentence: 'giving a handjob', tags: 'handjob', needsMan: true },
    { id: 'titjob', label: 'Titjob', sentence: 'giving a titjob', tags: 'paizuri', needsWoman: true, needsMan: true },
    { id: 'fingering', label: 'Fingering', sentence: 'fingering her', tags: 'fingering', needsWoman: true },
    { id: 'sex', label: 'Sex', sentence: 'having sex', tags: 'sex' },
    { id: 'anal', label: 'Anal', sentence: 'having anal sex', tags: 'anal' },
    { id: 'cum-body', label: 'Cum on body', sentence: 'with a cumshot on her body', tags: 'cum_on_body', needsWoman: true, needsMan: true },
    { id: 'creampie', label: 'Creampie', sentence: 'with a creampie', tags: 'cum_in_pussy', needsWoman: true, needsMan: true },
  ]},
  { id: 'position', label: 'Positions', emoji: '🛏', forPeople: true, nsfw: true, needsPartners: true, picks: [
    { id: 'missionary', label: 'Missionary', sentence: 'in missionary position', tags: 'missionary' },
    { id: 'cowgirl', label: 'Cowgirl', sentence: 'in cowgirl position', tags: 'cowgirl_position', needsWoman: true },
    { id: 'reverse-cowgirl', label: 'Reverse cowgirl', sentence: 'in reverse cowgirl position', tags: 'reverse_cowgirl_position', needsWoman: true },
    { id: 'doggy', label: 'Doggy style', sentence: 'doggy style', tags: 'doggystyle' },
    { id: 'spooning', label: 'Spooning', sentence: 'spooning', tags: 'spooning' },
    { id: 'standing', label: 'Standing', sentence: 'standing sex against a wall', tags: 'standing_sex' },
    { id: 'prone', label: 'Prone bone', sentence: 'prone bone', tags: 'prone_bone' },
    { id: 'lotus', label: 'Lotus', sentence: 'in lotus position facing each other', tags: 'lotus_position' },
    { id: '69', label: '69', sentence: 'in a 69 position', tags: '69' },
    { id: 'lifted', label: 'Lifted', sentence: 'carried and lifted during sex', tags: 'suspended_congress' },
  ]},
]

export const promptStyleOf = (w: { promptStyle?: 'tags' }): PromptStyle => w.promptStyle ?? 'sentences'

export const phraseOf = (pick: PromptPick, style: PromptStyle): string | undefined =>
  style === 'tags' ? pick.tags : pick.sentence

/** A row's picks for a style; `nsfw` false also hides the adult ones. */
export const picksFor = (row: PickRow, style: PromptStyle, nsfw = true): PromptPick[] =>
  row.picks.filter((p) => phraseOf(p, style) && (nsfw || !p.adult))

/** The topics to show: 18+ ones only with the switch on. */
export const visibleRows = (nsfw: boolean): PickRow[] => PICK_ROWS.filter((r) => nsfw || !r.nsfw)

const WORD = '[\\p{L}\\p{N}_]'
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Whole phrase only: "a man" must not light inside "a manta ray", nor "sunset" inside "sunset_glow".
const phraseRe = (phrase: string) => new RegExp(`(?<!${WORD})${escape(phrase)}(?!${WORD})`, 'iu')

export const hasPhrase = (prompt: string, phrase: string): boolean => phraseRe(phrase).test(prompt)

export function litPick(prompt: string, row: PickRow, style: PromptStyle): PromptPick | undefined {
  return picksFor(row, style).find((p) => hasPhrase(prompt, phraseOf(p, style)!))
}

/** Who the draft is about, from EVERY lit Who phrase ("a man and a woman" is two people, not the first card). */
export interface WhoInfo {
  /** A person is in it (not only animals or machines). */
  human: boolean
  /** Two or more people. */
  partners: boolean
  woman: boolean
  man: boolean
}

export function whoOf(prompt: string, style: PromptStyle): WhoInfo | null {
  const lit = picksFor(PICK_ROWS[0], style).filter((p) => hasPhrase(prompt, phraseOf(p, style)!))
  if (!lit.length) return null // the user's own words: nothing is blocked
  const people = lit.filter((p) => !p.nonHuman)
  return {
    human: people.length > 0,
    partners: people.some((p) => p.partners) || people.length >= 2,
    woman: people.some((p) => p.woman),
    man: people.some((p) => p.man),
  }
}

/** A pick the Who can do: no woman-only pick without a woman, no man-only pick without a man, nothing adult for animals. */
export const fits = (pick: PromptPick, who: WhoInfo | null): boolean =>
  !who || ((!pick.needsWoman || who.woman) && (!pick.needsMan || who.man) && (!pick.adult || who.human))

export type RowBlock = null | 'person' | 'partners'

/** Why a row cannot apply to the current Who — null when it can, or when Who is the user's own words. */
export function rowBlock(prompt: string, row: PickRow, style: PromptStyle): RowBlock {
  const who = whoOf(prompt, style)
  if (!who) return null
  if (row.forPeople && !who.human) return 'person'
  if (row.needsPartners && !who.partners) return 'partners'
  return null
}

// ponytail: a trailing full stop is folded into the separator ("A cat." + pick → "A cat, …");
// keeping it would need sentence-casing every phrase.
function appendPhrase(prompt: string, phrase: string): string {
  const head = prompt.replace(/[\s,.;]+$/, '')
  return head ? `${head}, ${phrase}` : phrase
}

/** Remove one phrase and exactly one neighbouring separator; every other character stays. */
function removePhrase(prompt: string, phrase: string): string {
  const m = phraseRe(phrase).exec(prompt)
  if (!m) return prompt
  let start = m.index
  let end = m.index + m[0].length
  const sepBefore = /\s*,\s*$/.exec(prompt.slice(0, start))
  const sepAfter = /^\s*,\s*/.exec(prompt.slice(end))
  if (sepBefore) start -= sepBefore[0].length
  else if (sepAfter) end += sepAfter[0].length
  else if (/\s$/.test(prompt.slice(0, start))) start -= 1
  else if (/^\s/.test(prompt.slice(end))) end += 1
  return prompt.slice(0, start) + prompt.slice(end)
}

/** Click on a pick: remove it if lit, swap it in for the row's lit pick, else append it. */
export function togglePick(prompt: string, row: PickRow, pick: PromptPick, style: PromptStyle): string {
  const phrase = phraseOf(pick, style)
  if (!phrase) return prompt
  const lit = litPick(prompt, row, style)
  if (lit?.id === pick.id) return removePhrase(prompt, phrase)
  if (lit) {
    const m = phraseRe(phraseOf(lit, style)!).exec(prompt)!
    return prompt.slice(0, m.index) + phrase + prompt.slice(m.index + m[0].length)
  }
  return appendPhrase(prompt, phrase)
}

/** Where a pick's example picture is served from: the photo set, or the anime set for tag models. */
export const thumbPath = (row: PickRow, pick: PromptPick, style: PromptStyle = 'sentences'): string =>
  `/prompt-helper/${style === 'tags' ? 'anime' : 'photo'}/${row.id}/${pick.id}.webp`

/** 🎲 for one row: any other pick of it (never an adult one without 18+), swapped in place or appended. */
export function rerollRow(prompt: string, row: PickRow, style: PromptStyle,
  { rng = Math.random, nsfw = false }: { rng?: () => number; nsfw?: boolean } = {}): string {
  const lit = litPick(prompt, row, style)
  const who = row.id === 'who' ? null : whoOf(prompt, style)
  const pool = picksFor(row, style, nsfw).filter((p) => p.id !== lit?.id && fits(p, who))
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  return pick ? togglePick(prompt, row, pick, style) : prompt
}

/**
 * After Who changes: drop every pick the new Who cannot do — a dress on a cat, a
 * position for one woman, a blowjob for two women. "a friendly dog, having sex"
 * came out of three clicks before this existed.
 */
export function dropBlocked(prompt: string, style: PromptStyle): string {
  const who = whoOf(prompt, style)
  if (!who) return prompt
  let out = prompt
  for (const row of PICK_ROWS.slice(1)) {
    const lit = litPick(out, row, style)
    if (lit && (rowBlock(out, row, style) || !fits(lit, who))) out = togglePick(out, row, lit, style)
  }
  return out
}

export interface SurpriseOptions {
  /** The preset's quality prefix: a description holding only it counts as empty. */
  prefix?: string
  /** Rows 🔒 kept by the user. */
  keep?: ReadonlySet<PickRowId>
  /** 18+ switch: 18+ topics and adult picks only when true. */
  nsfw?: boolean
  rng?: () => number
}

/** The user's own words: the description minus the prefix and every lit pick. */
function ownWords(prompt: string, style: PromptStyle, prefix: string): string {
  // Trimmed: removing the last pick also takes the prefix's trailing ", " with it.
  const head = prefix.replace(/[\s,]+$/, '')
  let rest = head && prompt.startsWith(head) ? prompt.slice(head.length) : prompt
  for (const row of PICK_ROWS) {
    const lit = litPick(rest, row, style)
    if (lit) rest = removePhrase(rest, phraseOf(lit, style)!)
  }
  return rest.replace(/[\s,.;]+/g, '')
}

/**
 * Surprise me: re-roll every row not kept — every click. Who only while the
 * description holds nothing of the user's own; rows the Who cannot do (a dress
 * on a cat, a position for one woman) are cleared; with 18+ on, ONE 18+ topic per
 * click (five at once contradict each other) and no clothes under nudity or a
 * sexy outfit.
 */
export function surprise(prompt: string, style: PromptStyle,
  { prefix = '', keep, nsfw = false, rng = Math.random }: SurpriseOptions = {}): string {
  const kept = (r: PickRow) => keep?.has(r.id) ?? false
  const [whoRow, ...rest] = PICK_ROWS
  let out = prompt
  if (!kept(whoRow) && ownWords(out, style, prefix) === '') out = rerollRow(out, whoRow, style, { rng, nsfw })
  const who = whoOf(out, style)
  const open = nsfw && who ? rest.filter((r) => r.nsfw && !kept(r) && !rowBlock(out, r, style)
    && picksFor(r, style, nsfw).some((p) => fits(p, who))) : []
  const chosen = open.length ? open[Math.min(open.length - 1, Math.floor(rng() * open.length))] : undefined
  for (const row of rest) {
    if (kept(row)) continue
    const lit = litPick(out, row, style)
    const clear = () => { if (lit) out = togglePick(out, row, lit, style) }
    if (row.forPeople || row.needsPartners) {
      if (!who) continue // the user's own subject — leave its rows alone
      // Cleared whatever the 18+ switch says: "a dragon, fully nude" must never come out of Surprise.
      if (rowBlock(out, row, style) || (lit && !fits(lit, who))) { clear(); continue }
    }
    if (row.nsfw && !nsfw) continue // the user's own 18+ picks stay while the switch is off
    if (row.nsfw && row !== chosen) { clear(); continue }
    if (row.id === 'wear' && chosen?.replacesClothes) { clear(); continue }
    // No adult pick (boudoir, lingerie) for an animal Who, whatever the switch says.
    out = rerollRow(out, row, style, { rng, nsfw: nsfw && (!who || who.human) })
  }
  return out
}

/**
 * A tag answer, tidied: no duplicates, no `no_*` tags the writer invented (a
 * tag model draws what a tag names, so `no_clouds` brings clouds — `no_humans`
 * is a real tag and stays), at most `max` tags. A 4B writer can run away into
 * hundreds of them. Tags from `input` (the user's prompt) are never dropped,
 * and the cap is never smaller than their number.
 */
export function tidyTags(text: string, input = '', max = 40): string {
  const theirs = new Set(input.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
  const cap = Math.max(max, theirs.size)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(',')) {
    const tag = raw.trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key) || (key.startsWith('no_') && key !== 'no_humans' && !theirs.has(key))) continue
    seen.add(key)
    out.push(tag)
    if (out.length === cap) break
  }
  return out.join(', ')
}

/** Cut AI output back under a model's character limit, at the last comma or full stop. */
export function fitToLimit(text: string, limit?: number): string {
  if (!limit || text.length <= limit) return text
  const cut = text.slice(0, limit)
  const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf('.'))
  const kept = at > 0 ? cut.slice(0, cut[at] === '.' ? at + 1 : at) : cut.replace(/\s+\S*$/, '')
  return kept.replace(/[\s,]+$/, '')
}
