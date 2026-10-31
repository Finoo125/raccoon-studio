/**
 * Renders the video Prompt Helper's card pictures (Krea2 Turbo):
 *   app/public/prompt-helper/video/where/<slug>.webp    (one per environment)
 *   app/public/prompt-helper/video/happens/<slug>.webp  (one per scenario)
 *
 *   cd app
 *   VIDEO_HELPER_THUMBS=1 node_modules/.bin/vitest run src/lib/prompt-builder/video-helper-thumbs.live.test.ts
 *
 * `=1` renders the missing pictures, `=all` re-renders every one. The rules of
 * prompt-helper-thumbs.live.test.ts hold here too: adults only, glamour look, and an
 * NSFW scenario's prompt is hand-written in HAPPENS_COVERED — it shows the idea covered
 * (sheets, silhouettes, backs) and never carries the scenario's own words. The 18+ switch
 * only hides the card; the file ships to everyone in the public repo. Every picture is
 * looked at on a contact sheet afterwards.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { freshSeed, liveEnv, meanLuma, renderGraph, rgb, structure } from '@/lib/workflows/live-render'
import { krea2TurboWorkflow } from '@/lib/workflows/krea2'
import type { GenerationParams } from '@/types/workflow'
import presets from './video-presets.json'
import { presetLabel, presetThumb } from './video-picks'

const MODE = process.env.VIDEO_HELPER_THUMBS
const GLAM = 'glamour photography, magazine editorial, flattering light, high quality photograph'

type Env = (typeof presets.environments)[number]
type Scenario = (typeof presets.scenarios)[number]

// ---------- where ----------
// One shared "a beautiful adult woman in a stylish outfit" gave ~75 of 83 cards the same woman in the same blouse
// and blazer (2026-10-22 sheet). Outfit and hair now come from a stable hash of the key, so a re-render keeps a
// card's look and neighbouring cards differ.
const OUTFITS = [
  'in an elegant black evening dress',
  'in a flowing floral sundress',
  'in a black leather jacket and fitted jeans',
  'in a silk blouse and a high-waisted midi skirt',
  'in a red cocktail dress',
  'in a belted camel trench coat',
  'in a fitted cream knit dress',
  'in a matching pastel summer co-ord',
  'in a white tailored pantsuit',
  'in an emerald satin midi dress',
]
const HAIR = ['long blonde hair', 'long brunette hair', 'wavy red hair', 'sleek black hair']
const keyHash = (key: string) => [...key].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7)

/** Places where a hashed outfit would be wrong: water, towels, sport, weather. These win over OUTFITS. */
const WHERE_WEAR: Record<string, string> = {
  '🏋 Gym — private session after hours': 'in a fitted black athletic top and leggings',
  '🏥 Hospital room — night shift': 'in a cream cashmere sweater and tailored trousers',
  '🌲 Dense forest — diffused green': 'in a fitted hiking jacket and leggings',
  '🏔 Mountain peak — dawn': 'in a fitted down jacket and leggings',
  '🏖 Beach — golden hour': 'in a white linen sundress',
  '🏄 Bondi Beach — bright midday': 'in a red one-piece swimsuit and a sarong',
  '🌴 LA beach — Venice / Santa Monica': 'in a crop top and denim shorts',
  '🏜 Desert — midday heat': 'in a loose white linen shirt and trousers',
  '🌊 Underwater — shallow reef': 'in a turquoise one-piece swimsuit',
  '🍹 Ibiza pool party — golden hour': 'in a white one-piece swimsuit and a sarong',
  '🔥 POV · Fire-lit cabin rug — blizzard outside': 'in a cosy oversized knit sweater dress',
  'WTF — ✈️ Skydive — open door at altitude': 'in a fitted skydiving jumpsuit and harness',
  'WTF — 🪂 Paragliding — soaring': 'in a fitted windbreaker and harness',
  'WTF — 🌊 Big wave surfing — tow-in': 'in a long-sleeved black wetsuit',
  'WTF — 🏔 Base jump — cliff edge': 'in a fitted wingsuit with a base rig',
  'WTF — 🏎 Racing circuit — in car': 'in a fitted racing suit',
  'WTF — 🌋 Volcanic landscape — active': 'in a fitted hiking jacket and cargo trousers',
  'WTF — 🚤 Speedboat — open water at speed': 'in a white one-piece swimsuit and a sarong',
  '🛁 Bathroom — steam and tile': 'wrapped in a white bath towel',
  '🚿 Rain shower — glass-walled bathroom': 'wrapped in a white bath towel',
  '🏊 Pool — late night private swim': 'in a sleek black one-piece swimsuit',
  '🌃 Rooftop pool — hotel, midnight': 'in an elegant white one-piece swimsuit',
  '🌌 POV · Infinity pool penthouse — night skyline': 'in an elegant black one-piece swimsuit',
  '🕯 POV · Candlelit hammam — steam and stone': 'wrapped in a white linen towel',
  '🧖 POV · Mountain onsen — snowfall at night': 'wrapped in a white towel, hair pinned up',
  // In a blouse she read as a fashion shoot that happened to be underwater (2026-10-22 sheet).
  'WTF — 🌊 Underwater — deep': 'in a black wetsuit and diving mask, an air tank on her back',
}

/** Added after the location. An unnamed neon sign came back as made-up words every time (EUFRK, FOLLCK, LONE AOTY). */
const WHERE_EXTRA: Record<string, string> = {
  '⛩ POV · Tokyo love-hotel — neon through blinds': 'the neon sign spells HOTEL',
}

const wherePrompt = (e: Env) => {
  const h = keyHash(e.key)
  const wear = WHERE_WEAR[e.key] ?? OUTFITS[h % OUTFITS.length]
  const hair = HAIR[Math.floor(h / OUTFITS.length) % HAIR.length]
  const place = [e.location, WHERE_EXTRA[e.key]].filter(Boolean).join(', ')
  // "wide shot": the place is the card's subject, she stays mid-size in it.
  return `a glamorous adult woman in her late twenties with ${hair}, ${wear}, ${place}, ${e.lighting}, wide shot, ${GLAM}`
}

// ---------- what happens ----------
// The setups were written for a video writer ("Someone walks in and halts."): she does it here.
const action = (setup: string) => setup.replace(/^Someone /, 'she ').replace(/\.$/, '')

/**
 * What she wears in each SFW action. Krea2 reads "glamour photo of a woman" with no clothes named as nude or
 * lingerie: 13 of the 21 template actions came back undressed on the 2026-10-22 sheet. Varied on purpose, so
 * the cards don't all look alike.
 */
const HAPPENS_WEAR: Record<string, string> = {
  '🚶 Walk in and stop': 'in a belted camel trench coat and heels',
  '🪟 Draw the curtains open': 'in a cream knit sweater dress',
  '🖐 Press a palm to the glass': 'in a red evening gown',
  '🌆 Lean on a railing, looking out': 'in a flowing floral summer dress',
  '🪜 Climb onto a ledge and sit': 'in a black leather jacket and jeans',
  '👠 Step into a pair of heels': 'in a navy satin cocktail dress',
  '🌊 Wade out into the water': 'in a red one-piece swimsuit',
  '💨 Turn into the wind': 'in a long flowing chiffon dress',
  '🕯 Lean in and blow out a candle': 'in an emerald satin evening dress',
  '🍷 Pour a drink and raise the glass': 'in a gold sequined cocktail dress',
  // An open jacket came back with nothing under it: name a top that cannot open.
  '🎧 Roll her shoulders into the beat': 'in a black sequined top and leather trousers, headphones on, in a nightclub',
  '💃 Dance slowly on the spot': 'in a long slinky silver gown, in a dim ballroom',
  '👗 Slow twirl in a dress': 'in a full-skirted red dress',
  '🛋 Flop onto a couch': 'in an oversized sweater and leggings',
  '🧎 Slide down the wall to the floor': 'in a black turtleneck and jeans',
  '😏 Bite lip and look over shoulder': 'in a fitted black evening gown',
  '🍑 Walk away, glance back': 'in a fitted white dress',
  '💋 Blow a kiss to camera': 'in a pink blazer dress',
}

/** SFW scenarios whose setup does not read as the action at 84 px, or would undress her. */
const HAPPENS_PICK: Record<string, string> = {
  '🚿 Step under the water': `full-body glamour photo of a beautiful adult woman in a classic red one-piece swimsuit, she stands under an outdoor rain shower beside a pool, water pouring over her head and shoulders, eyes closed, ${GLAM}`,
  '🪑 Sit down on a chair': `full-body glamour photo of a beautiful adult woman in a black cocktail dress, seated on an antique wooden chair, legs crossed, one hand on her knee, ${GLAM}`,
  '🪑 Straddle a chair backwards': `full-body glamour photo of a beautiful adult woman in high-waisted jeans and a white shirt, she sits backwards astride a wooden chair, arms folded on top of the backrest, chin resting on her arms, ${GLAM}`,
  '🤲 Reach out and pull him in': `glamour photo of a beautiful adult woman in a silk blouse and pencil skirt, she reaches out and pulls a man in a dark suit close by his tie, smiling, ${GLAM}`,
  '💦 Lean back under water': `glamour photo of a beautiful adult woman in a swimsuit in a turquoise pool, she tips her head back out of the water, wet hair slicked back, water streaming off her face, ${GLAM}`,
  '🛏 Stretch on a bed': `full-body glamour photo of a beautiful adult woman in silk pajamas, she stretches out lazily on a bed, arms over her head, morning light, ${GLAM}`,
  '🧎 Kneel up and arch': `full-body glamour photo of a beautiful adult woman in a satin slip dress, kneeling upright on a bed and arching her back, head tilted back, ${GLAM}`,
}

const COUPLE = 'sensual photo of an attractive adult couple, tasteful, fully covered, soft warm light'
const WOMEN = 'sensual photo of two attractive adult women, tasteful, fully covered, soft warm light'

/** Every NSFW scenario, covered. Never the scenario's own words. */
const HAPPENS_COVERED: Record<string, string> = {
  '🔥 Missionary': `${COUPLE}, lying in bed under white sheets, him above her, faces close, her arms around his neck`,
  '🔥 Legs over his shoulders': `${COUPLE}, in bed under a white sheet that covers them both, her bare calves resting on his shoulders, seen from the side, faces close`,
  '🔥 Butterfly — hips lifted': `${COUPLE}, on a bed draped in crimson satin, she lies back on the pillows in a satin slip dress, he leans over her in an open white shirt, a sheet drawn over their legs, faces close`,
  '🔥 Mating press': `${COUPLE}, under a heavy grey duvet in a hotel room, only heads and shoulders showing, him above her, her knees drawn up under the covers`,
  '🔥 Edge of the bed, he stands': `${COUPLE}, he stands beside a bed in a white shirt and dark trousers, she lies back across the edge of the bed wrapped in a white sheet, reaching up to take his hand`,
  '🔥 Doggy': `${COUPLE}, backlit silhouettes on a bed behind a sheer white curtain, him kneeling behind her`,
  '🔥 Prone bone': `${COUPLE}, lying under cream linen sheets, she lies on her stomach hugging a pillow, him above her kissing her shoulder, morning light`,
  '🔥 Bent over a surface': `${COUPLE}, in a dim kitchen at night, she leans forward on the marble counter in a silk robe, he holds her waist from behind, both clothed`,
  '🔥 Standing from behind': `${COUPLE}, at a floor-to-ceiling window at night, he holds her close from behind, she wears a silk dress, seen from behind as silhouettes against the city lights`,
  '🔥 Against the wall, standing': `${COUPLE}, kissing against a wall in a dim hotel corridor, clothed, his hands on her waist, her hands in his hair`,
  '🔥 Carried, legs locked around him': `${COUPLE}, he carries her in his arms with her legs around his waist, kissing, clothed, candlelit loft`,
  '🔥 Cowgirl': `${COUPLE}, she sits astride him in bed with a white sheet around her waist, her bare back to the camera, long hair down, he lies back on the pillows`,
  '🔥 Reverse cowgirl': `${COUPLE}, she sits upright on a bed facing the camera in a silk nightgown, eyes closed, a white sheet around her hips, he lies on the pillows behind her with his hands on her waist, sunset window behind`,
  '🔥 Amazon — she squats over him': `${COUPLE}, a woman crouched playfully on a bed above a man lying back, both wrapped in a crimson sheet, laughing`,
  '🔥 Spooning': `${COUPLE}, cuddling side by side under white sheets, him behind her, his arm around her, eyes closed, morning light`,
  '🔥 Oral (giving)': `${COUPLE}, in bed under white sheets, she kisses his chest, his hand in her hair, dim bedside lamp`,
  '🔥 Oral (receiving)': `${COUPLE}, in bed under white sheets, she lies back on the pillow with her eyes closed and lips parted, gripping the sheet, he is hidden under the covers`,
  '🔥 Face sitting': `sensual boudoir photo of a beautiful adult woman, tasteful, fully covered, she kneels upright on a bed in a silk camisole, head tilted back, gripping the headboard, sheets tangled around her knees`,
  '🔥 69': `${COUPLE}, lying head to toe under a striped duvet, playful, laughing`,
  '🔥 Titfuck': `${COUPLE}, she leans over him in bed in a black lace bra, her long hair falling over his chest, sheets around them`,
  '🔥 Handjob, kneeling at his side': `${COUPLE}, she kneels beside him on the bed in a silk camisole, her hand resting on his stomach, he lies back under the sheet, smiling`,
  '🌸 Scissoring (F/F)': `${WOMEN}, lying together under white sheets in bed, legs intertwined, smiling at each other`,
  '🌸 Thigh grinding (F/F)': `${WOMEN}, one sits astride the other's lap on a velvet sofa, both in silk slips, foreheads touching`,
  '🌸 Strap-on from behind (F/F)': `${WOMEN}, both in silk slips, one kneels behind the other on a bed and wraps her arms around her waist, cheek to cheek, backlit by a sheer curtain`,
  '🍑 Doggy (anal)': `${COUPLE}, their shadows cast on a bedroom wall by a single lamp, him behind her on the bed`,
  '🍑 Anal, mating press': `${COUPLE}, tangled under a black satin duvet, him above her, her hands gripping the pillow, faces close, candlelight`,
}

const happensPrompt = (s: Scenario): string | undefined =>
  s.tag === 'NSFW'
    ? HAPPENS_COVERED[s.key]
    : (HAPPENS_PICK[s.key] ??
      // "alone in the frame": a setup that moves ("crosses to a chair and takes a seat") came back as two copies of her.
      `full-body glamour photo of one beautiful adult woman ${HAPPENS_WEAR[s.key] ?? 'in an elegant cocktail dress'}, alone in the frame, ${action(s.setup)}, ${GLAM}`)

// Words no picture prompt may carry — the scenario's own label and setup are checked on top of these.
const EXPLICIT = /\b(sex|sexual|explicit|nude|naked|penetrat\w*|cock|pussy|blowjob|oral|anal|strap-on|cum|fuck\w*|tits?|titfuck|breasts?|nipples?|grind\w*|suck\w*|topless)\b/i

const jobs = (): { row: 'where' | 'happens'; key: string; prompt: string | undefined }[] => [
  ...presets.environments.map((e) => ({ row: 'where' as const, key: e.key, prompt: wherePrompt(e) })),
  ...presets.scenarios.map((s) => ({ row: 'happens' as const, key: s.key, prompt: happensPrompt(s) })),
]

describe.skipIf(!MODE)('Video Prompt Helper — card pictures', () => {
  const env = liveEnv()
  const pub = path.resolve(__dirname, '../../../public')
  const nsfw = presets.scenarios.filter((s) => s.tag === 'NSFW')

  it('has a covered prompt for every NSFW scenario, and none for a key the JSON lacks', () => {
    expect(Object.keys(HAPPENS_COVERED).sort()).toEqual(nsfw.map((s) => s.key).sort())
    const known = new Set([...presets.environments.map((e) => e.key), ...presets.scenarios.map((s) => s.key)])
    const overrides = [WHERE_WEAR, WHERE_EXTRA, HAPPENS_WEAR, HAPPENS_PICK].flatMap((m) => Object.keys(m))
    for (const k of overrides) {
      expect(known.has(k), k).toBe(true)
    }
  })

  it('keeps every NSFW scenario’s label and setup out of its picture prompt', () => {
    for (const s of nsfw) {
      const prompt = (HAPPENS_COVERED[s.key] ?? '').toLowerCase()
      expect(prompt.includes(presetLabel(s.key).label.toLowerCase()), `${s.key} carries its label`).toBe(false)
      expect(prompt.includes(s.setup.toLowerCase()), `${s.key} carries its setup`).toBe(false)
    }
  })

  it('keeps explicit words out of every picture prompt', () => {
    for (const j of jobs()) expect(j.prompt?.match(EXPLICIT)?.[0], `${j.row} ${j.key}`).toBeUndefined()
  })

  it('renders every missing picture', async () => {
    for (const { row, key, prompt } of jobs()) {
      const file = path.join(pub, presetThumb(row, key)!)
      if (MODE !== 'all' && fs.existsSync(file)) continue
      fs.mkdirSync(path.dirname(file), { recursive: true })
      let ok = false
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const params = { ...krea2TurboWorkflow.defaultParams, prompt: prompt!, seed: freshSeed() + attempt, width: 1024,
          height: 1024, upscale: false, detailer: false, promptEnhancer: false } as GenerationParams
        const wf = krea2TurboWorkflow.buildPrompt(params)
        wf['k:save'].inputs.filename_prefix = 'video-helper-thumb'
        const { files } = await renderGraph(env.base, wf, `${row} ${key}`, env.outputDir)
        try {
          // Not a black frame (luma ~2.5) and not the sampler's untouched starting noise: structure 9.7-10.4 on
          // 2026-10-21, when this ComfyUI returned every Krea2 render as noise, against 42-83 on the image helper's
          // where/time/light pictures. Three misses stop the run. Colour spread is not gated — every picture is
          // looked at on a contact sheet. 15, not 25: structure is a contrast measure, and a near-black place
          // (Private booth, luma 26-28) scored 20.7-23.9 three times on 2026-10-22.
          const luma = meanLuma(rgb(files[0]))
          const shape = structure(files[0])
          console.log(`${row} ${key}: luma ${luma.toFixed(1)}, structure ${shape.toFixed(1)}`)
          ok = luma > 8 && shape > 15
          if (ok) {
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', files[0], '-vf', 'scale=192:192:flags=lanczos',
              '-c:v', 'libwebp', '-quality', '78', file])
          }
        } finally {
          for (const f of files) fs.rmSync(f, { force: true })
        }
      }
      expect(ok, `${row} ${key}`).toBe(true)
    }
  }, 4 * 60 * 60_000)
})
