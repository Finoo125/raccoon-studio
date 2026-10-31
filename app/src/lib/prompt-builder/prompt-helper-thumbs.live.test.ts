/**
 * Renders the Prompt Helper's example pictures:
 *   app/public/prompt-helper/photo/<row>/<pick>.webp  (Krea2 Turbo, picks with a sentence)
 *   app/public/prompt-helper/anime/<row>/<pick>.webp  (Anima Turbo, picks with tags)
 *
 *   cd app
 *   PROMPT_HELPER_THUMBS=1 node_modules/.bin/vitest run src/lib/prompt-builder/prompt-helper-thumbs.live.test.ts
 *
 * `=1` renders the missing pictures of both sets, `=all` re-renders every one,
 * `=photo` / `=anime` only that set's missing ones. Rules every prompt follows:
 * adults only (`mature_female` on every anime woman), glamour look, and an 18+
 * pick's prompt NEVER carries the pick's own explicit words — it shows the idea
 * covered (sheets, towels, silhouettes, backs): these pictures ship in the public
 * repo. Every picture is looked at on a contact sheet afterwards.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { freshSeed, liveEnv, meanLuma, renderGraph, rgb } from '@/lib/workflows/live-render'
import { krea2TurboWorkflow } from '@/lib/workflows/krea2'
import { animaTurboWorkflow } from '@/lib/workflows/anima'
import type { GenerationParams } from '@/types/workflow'
import { PICK_ROWS, thumbPath, type PickRow, type PickRowId, type PromptPick } from './picks'

const MODE = process.env.PROMPT_HELPER_THUMBS

// ---------- photo set (Krea2 Turbo) ----------
const STUDIO = 'soft studio lighting, clean simple background'
const GLAM = 'glamour photography, magazine editorial, flattering light, high quality photograph'
const COVER = 'sensual boudoir photography, beautiful adult woman, tasteful, nothing explicit visible, soft window light'
const COUPLE = 'sensual photo of an attractive adult couple, tasteful, nothing explicit visible, soft warm light'

const PHOTO_ROW: Partial<Record<PickRowId, (s: string) => string>> = {
  skin: (s) => `glamour beauty portrait of a beautiful adult woman ${s}, bare shoulders, ${STUDIO}, ${GLAM}`,
  hair: (s) => `glamour portrait of a beautiful adult woman ${s}, ${STUDIO}, ${GLAM}`,
  haircolor: (s) => `glamour portrait of a beautiful adult woman ${s}, ${STUDIO}, ${GLAM}`,
  face: (s) => `close-up glamour portrait of a beautiful adult woman ${s}, ${STUDIO}, ${GLAM}`,
  wear: (s) => `full-body fashion photo of a beautiful adult model ${s}, ${STUDIO}, ${GLAM}`,
  pose: (s) => `full-body glamour photo of a beautiful adult woman in a stylish dress ${s}, ${STUDIO}, ${GLAM}`,
  where: (s) => `a beautiful adult woman in a stylish outfit ${s}, ${GLAM}`,
  time: (s) => `a beautiful adult woman in a stylish outfit ${s}, ${GLAM}`,
  light: (s) => `glamour portrait of a beautiful adult woman ${s}, ${GLAM}`,
  shot: (s) => `a beautiful adult woman in a stylish outfit in a sunny park, ${s}, ${GLAM}`,
  colors: (s) => `glamour fashion photo of a beautiful adult woman, ${s}`,
  look: (s) => `a beautiful adult woman in an elegant dress, ${s}`,
  outfit: (s) => `${COVER}, ${s}`,
}

const BODY = 'three-quarter length glamour photo of'
// Body types must be unmistakable at 84 px: one shared template rendered five identical slim women.
const PHOTO_PICK: Record<string, string> = {
  // Skin tones and marks must read at 84 px: the shared template made four near-identical faces.
  'skin/pale': `glamour beauty portrait of a beautiful adult woman with very pale, porcelain-white skin, ${STUDIO}, ${GLAM}`,
  'skin/fair': `glamour beauty portrait of a beautiful adult woman with fair, light skin and rosy cheeks, ${STUDIO}, ${GLAM}`,
  'skin/olive': `glamour beauty portrait of a beautiful adult woman with warm olive Mediterranean skin, ${STUDIO}, ${GLAM}`,
  'skin/tanned': `glamour beauty portrait of a beautiful adult woman with deeply sun-tanned golden-bronze skin, ${STUDIO}, ${GLAM}`,
  'skin/freckles': `close-up glamour beauty portrait of a beautiful adult woman with lots of freckles across her nose and cheeks, ${STUDIO}, ${GLAM}`,
  'skin/tanlines': `glamour portrait of a beautiful tanned adult woman in a strapless top, clearly visible white bikini tan lines on her shoulders, ${STUDIO}, ${GLAM}`,
  'body/slim': `${BODY} a beautiful slim, slender adult woman in a sports bra and leggings, ${STUDIO}, ${GLAM}`,
  'body/curvy': `${BODY} a beautiful curvy adult woman with an hourglass figure and wide hips, in a fitted dress, ${STUDIO}, ${GLAM}`,
  'body/athletic': `${BODY} an athletic, toned adult woman with toned arms and legs, in a sports bra and shorts, ${STUDIO}, ${GLAM}`,
  'body/fitness': `${BODY} an adult female fitness model with a visible six-pack, in a sports bra and shorts, ${STUDIO}, ${GLAM}`,
  'body/muscular': `${BODY} a muscular adult woman with strong defined arms and shoulders, in a sports bra, ${STUDIO}, ${GLAM}`,
  'body/muscle-woman': `${BODY} a very muscular adult woman with big biceps, broad shoulders and visible abs, flexing, in a sports bra, ${STUDIO}, ${GLAM}`,
  'body/bodybuilder': `${BODY} a female bodybuilder with huge muscles, very large biceps and shoulders, flexing on stage in a competition bikini, ${GLAM}`,
  'body/thick': `${BODY} a thick, voluptuous adult woman with thick thighs and wide hips, in a fitted dress, ${STUDIO}, ${GLAM}`,
  'body/plus': `${BODY} a beautiful plus-size adult woman with a full figure, in a fitted dress, ${STUDIO}, ${GLAM}`,
  'body/tall': `${BODY} a very tall, long-legged adult model in a short dress and high heels, ${STUDIO}, ${GLAM}`,
  'body/busty': `${BODY} a beautiful adult woman with a large bust in an elegant low-cut dress, ${STUDIO}, ${GLAM}`,
  'who/woman': `glamour portrait of a beautiful woman in her late twenties, ${STUDIO}, ${GLAM}`,
  'who/man': `glamour portrait of a handsome man in his thirties, ${STUDIO}, ${GLAM}`,
  'who/couple': `an attractive adult couple embracing, waist up, ${STUDIO}, ${GLAM}`,
  'who/two-women': `two beautiful adult women posing together, waist up, ${STUDIO}, ${GLAM}`,
  'who/two-men': `two handsome adult men posing together, waist up, ${STUDIO}, ${GLAM}`,
  'who/mmf': `a beautiful adult woman posing between two handsome men, waist up, ${STUDIO}, ${GLAM}`,
  'who/ffm': `a handsome adult man posing between two beautiful women, waist up, ${STUDIO}, ${GLAM}`,
  'who/older-woman': `glamour portrait of an elegant woman in her fifties, ${STUDIO}, ${GLAM}`,
  'who/older-man': `portrait of a handsome man in his sixties with a grey beard, ${STUDIO}, ${GLAM}`,
  'who/vampire': `glamour portrait of a seductive adult vampire woman, pale skin, red lips, gothic dress, ${GLAM}`,
  'who/cat': `a fluffy cat sitting and looking at the camera, ${STUDIO}`,
  'who/dog': `a friendly golden retriever sitting, ${STUDIO}`,
  'who/dragon': 'a majestic small green dragon with detailed scales, fantasy creature, clean background',
  'who/robot': `a sleek humanoid robot, white and silver, upper body, ${STUDIO}`,
  'nudity/implied': `${COVER}, lying in bed covered by a white silk sheet, bare shoulders`,
  'nudity/topless': `${COVER}, seen from behind, bare back, arms crossed over her chest`,
  'nudity/bottomless': `${COVER}, wearing only an oversized white shirt, sitting on the edge of a bed`,
  'nudity/nude': `${COVER}, wrapped loosely in a white bedsheet, standing by a window`,
  'nudity/undressing': `${COVER}, slipping a satin dress off her shoulder, seen from behind`,
  'nudity/see-through': `${COVER}, silhouette behind a sheer white curtain`,
  'nudity/wet-skin': `${COVER}, glistening wet skin after a shower, wrapped in a white towel`,
  'outfit/bodysuit': `${COVER}, in a black lace bodysuit`,
  'outfit/fishnets': `${COVER}, in a black dress and fishnet stockings`,
  'outfit/garter': `${COVER}, in black stockings, a garter belt and a lace slip`,
  'outfit/robe': `${COVER}, in a silk robe, tied`,
  'outfit/thong': `${COVER}, in a black lace lingerie set, seen from the side`,
  'outfit/harness': `${COVER}, in black lingerie with a leather harness`,
  'outfit/shirt-only': `${COVER}, wearing only an oversized shirt, sitting on a bed`,
  'outfit/heels': `${COVER}, in black high heels and a silk robe, sitting on a bed, legs crossed`,
  'sensual/on-bed': `${COVER}, lying on a bed in black lingerie, seductive look`,
  'sensual/arched': `${COVER}, in lingerie arching her back on a bed`,
  'sensual/over-shoulder': `${COVER}, in lingerie glancing seductively over her shoulder`,
  'sensual/kneeling': `${COVER}, kneeling on a bed in lingerie`,
  'sensual/all-fours': `${COVER}, on a bed in lingerie, playful pose, seen from the side`,
  'sensual/spread': `${COVER}, lying on a bed in lingerie with knees raised, legs in shadow`,
  'sensual/bent-over': `${COVER}, in lingerie leaning over a bed, seen from the side`,
  'sensual/touching': `${COVER}, in lingerie lying on a bed, hand on her thigh, eyes closed`,
  'sensual/chest': `${COVER}, in a lace bra, hands on her chest, close-up`,
  'sensual/shower': `${COVER}, silhouette behind the frosted glass of a steamy shower`,
  'sensual/straddling': `${COVER}, in lingerie straddling a chair backwards`,
  'sensual/legs-up': `${COVER}, lying on a bed in lingerie with her legs up in the air`,
  'act/kissing': `${COUPLE}, in a passionate kiss, clothed`,
  'act/making-out': `${COUPLE}, making out on a sofa, clothed`,
  'act/undressing-each': `${COUPLE}, unbuttoning each other's shirts`,
  'act/blowjob': `${COUPLE}, in bed under white sheets, she is kissing his chest`,
  'act/cunnilingus': `${COUPLE}, in bed under white sheets, he is kissing her stomach`,
  'act/handjob': `${COUPLE}, lying in bed under sheets, her hand on his chest, smiling`,
  'act/titjob': `${COUPLE}, in bed under sheets, she leans over him, hair falling`,
  'act/fingering': `${COUPLE}, lying in bed under sheets, his hand on her hip, she bites her lip`,
  'act/sex': `${COUPLE}, bodies intertwined under white sheets in bed`,
  'act/anal': `${COUPLE}, spooning closely under white sheets, him behind her`,
  'act/cum-body': `${COUPLE}, lying in messy sheets afterwards, smiling, glowing skin`,
  'act/creampie': `${COUPLE}, lying together in bed afterwards, tangled sheets, satisfied`,
  'position/missionary': `${COUPLE}, under white sheets, him above her, faces close`,
  'position/cowgirl': `${COUPLE}, she sits on top of him in bed, sheet around her waist, seen from behind`,
  'position/reverse-cowgirl': `${COUPLE}, backlit silhouette of a woman sitting on a man in bed, facing away`,
  'position/doggy': `${COUPLE}, silhouettes on a bed behind a sheer curtain`,
  'position/spooning': `${COUPLE}, cuddling under the covers, him behind her`,
  'position/standing': `${COUPLE}, embracing against a wall, kissing, clothed`,
  'position/prone': `${COUPLE}, lying under sheets, him behind her, her face on the pillow`,
  'position/lotus': `${COUPLE}, sitting face to face on a bed, wrapped in a sheet`,
  'position/69': `${COUPLE}, lying head to toe under white sheets, playful`,
  'position/lifted': `${COUPLE}, he carries her with her legs around his waist, kissing, clothed`,
}

// ---------- anime set (Anima Turbo) ----------
// Owner, 2026-10-10: flat 2D anime, not the semi-realistic painterly default Anima drifts to.
const A = 'masterpiece, best quality, anime_screencap, flat_color, cel_shading, 2d, clean_lineart, '
const ADULT = 'mature_female, beautiful, detailed_eyes'
const GIRL = (rating: string, rest: string) => `${A}${rating}, 1girl, solo, ${ADULT}, ${rest}`
const S = (rest: string) => GIRL('sensitive', rest)
const L = (rest: string) => S(`black_lingerie, ${rest}`)
const C = (rest: string) => `${A}sensitive, 1boy, 1girl, couple, ${ADULT}, mature_male, ${rest}`
const CB = (rest: string) => C(`camisole, ${rest}`)
const racy = (p: PromptPick) => p.adult || p.id === 'swimwear' || p.id === 'bikini'

const ANIME_ROW: Partial<Record<PickRowId, (t: string, p: PromptPick) => string>> = {
  body: (t, p) => GIRL(racy(p) ? 'sensitive' : 'safe', `${t}, sports_bra, shorts, cowboy_shot, simple_background`),
  skin: (t) => GIRL('safe', `${t}, looking_at_viewer, upper_body, simple_background`),
  hair: (t) => GIRL('safe', `${t}, looking_at_viewer, upper_body, simple_background`),
  haircolor: (t) => GIRL('safe', `${t}, looking_at_viewer, upper_body, simple_background`),
  face: (t) => GIRL('safe', `${t}, portrait, simple_background`),
  wear: (t, p) => GIRL(racy(p) ? 'sensitive' : 'safe', `${t}, full_body, standing, simple_background`),
  pose: (t) => GIRL('safe', `dress, ${t}, full_body, simple_background`),
  where: (t) => GIRL('safe', `dress, ${t}, scenery, upper_body`),
  time: (t) => GIRL('safe', `dress, ${t}, scenery, upper_body`),
  light: (t) => GIRL('safe', `dress, ${t}, upper_body`),
  shot: (t) => GIRL('safe', `casual, park, ${t}`),
  colors: (t) => GIRL('safe', `dress, ${t}, upper_body`),
  look: (t) => GIRL('safe', `dress, ${t}, upper_body`),
}

const ANIME_PICK: Record<string, string> = {
  'who/woman': GIRL('safe', 'looking_at_viewer, smile, upper_body, simple_background'),
  'who/man': `${A}safe, 1boy, solo, mature_male, handsome, looking_at_viewer, upper_body, simple_background`,
  'who/couple': `${A}safe, 1boy, 1girl, couple, ${ADULT}, mature_male, hug, upper_body, simple_background`,
  'who/two-women': `${A}safe, 2girls, ${ADULT}, smile, upper_body, simple_background`,
  'who/two-men': `${A}safe, 2boys, mature_male, handsome, upper_body, simple_background`,
  'who/mmf': `${A}safe, 2boys, 1girl, ${ADULT}, mature_male, group, upper_body, simple_background`,
  'who/ffm': `${A}safe, 1boy, 2girls, ${ADULT}, mature_male, group, upper_body, simple_background`,
  'who/older-woman': `${A}safe, 1girl, solo, mature_female, elegant, upper_body, simple_background`,
  'who/older-man': `${A}safe, 1boy, solo, old_man, grey_hair, beard, upper_body, simple_background`,
  'who/vampire': GIRL('safe', 'vampire, fangs, gothic, red_eyes, upper_body, simple_background'),
  'who/cat': `${A}safe, cat, no_humans, cute, simple_background`,
  'who/dog': `${A}safe, dog, no_humans, golden_retriever, simple_background`,
  'who/dragon': `${A}safe, dragon, no_humans, fantasy, simple_background`,
  'who/robot': `${A}safe, robot, mecha, no_humans, upper_body, simple_background`,
  'nudity/implied': S('naked_sheet, on_bed, bare_shoulders, covering'),
  'nudity/topless': S('from_behind, bare_back, covering_breasts, upper_body'),
  'nudity/bottomless': S('oversized_shirt, sitting, on_bed'),
  'nudity/nude': S('naked_sheet, standing, window'),
  'nudity/undressing': S('dress, off_shoulder, from_behind, looking_back'),
  'nudity/see-through': S('white_dress, backlighting, silhouette, curtains, standing'),
  'nudity/wet-skin': S('bathrobe, wet_hair, steam, bathroom, upper_body'),
  'outfit/bodysuit': S('black_bodysuit, lace, upper_body'),
  'outfit/latex': S('latex, catsuit, full_body'),
  'outfit/fishnets': S('black_dress, fishnet_thighhighs, full_body'),
  'outfit/garter': S('slip, garter_belt, thighhighs, full_body'),
  'outfit/corset': S('corset, full_body'),
  'outfit/robe': S('robe, sitting, on_bed'),
  'outfit/micro': S('bikini, beach'),
  'outfit/thong': S('lingerie, from_side, standing'),
  'outfit/harness': S('lingerie, harness, upper_body'),
  'outfit/shirt-only': S('oversized_shirt, sitting, on_bed'),
  'outfit/towel': S('bathrobe, towel_on_head, bathroom, upper_body'),
  'outfit/heels': S('high_heels, robe, sitting, crossed_legs, on_bed'),
  'sensual/on-bed': L('lying, on_bed'),
  'sensual/arched': L('arched_back, on_bed'),
  'sensual/over-shoulder': L('looking_back, from_behind'),
  'sensual/kneeling': L('kneeling, on_bed'),
  'sensual/all-fours': L('all_fours, on_bed, from_side'),
  'sensual/spread': L('lying, on_bed, knees_up, shadow'),
  'sensual/bent-over': L('leaning_forward, from_side'),
  'sensual/touching': L('lying, on_bed, closed_eyes, hand_on_own_thigh'),
  'sensual/chest': S('lace_bra, hands_on_own_chest, upper_body'),
  'sensual/shower': S('shower, silhouette, steam'),
  'sensual/straddling': L('straddling, chair'),
  'sensual/legs-up': L('lying, legs_up, on_bed'),
  'act/kissing': C('kiss, clothed, upper_body'),
  'act/making-out': C('kiss, hug, couch, clothed'),
  'act/undressing-each': C('unbuttoning, shirt, upper_body'),
  'act/blowjob': CB('bed, under_covers, kissing_chest'),
  'act/cunnilingus': CB('bed, under_covers, kissing_stomach'),
  'act/handjob': CB('bed, under_covers, hand_on_another\'s_chest, smile'),
  'act/titjob': CB('bed, under_covers, leaning_over, long_hair'),
  'act/fingering': CB('bed, under_covers, hand_on_hip, lip_biting'),
  'act/sex': CB('bed, under_covers, embrace'),
  'act/anal': CB('spooning, under_covers'),
  'act/cum-body': CB('bed, messy_sheets, smile, lying'),
  'act/creampie': CB('bed, tangled_sheets, lying, afterglow'),
  'position/missionary': CB('under_covers, lying_on_person'),
  'position/cowgirl': CB('girl_on_top, from_behind'),
  'position/reverse-cowgirl': C('silhouette, backlighting, sitting_on_person'),
  'position/doggy': C('silhouette, curtains, bed'),
  'position/spooning': CB('cuddling, under_covers, smile'),
  'position/standing': C('against_wall, kiss, clothed'),
  'position/prone': CB('under_covers, lying, from_behind'),
  'position/lotus': CB('facing_another, sitting, bed'),
  'position/69': CB('under_covers, lying, playful'),
  'position/lifted': C('carrying, legs_around_waist, kiss, clothed'),
}

type Set = 'photo' | 'anime'
const key = (r: PickRow, p: PromptPick) => `${r.id}/${p.id}`

function promptFor(set: Set, r: PickRow, p: PromptPick): string | undefined {
  if (set === 'photo') return PHOTO_PICK[key(r, p)] ?? (p.sentence && PHOTO_ROW[r.id]?.(p.sentence))
  return ANIME_PICK[key(r, p)] ?? (p.tags && ANIME_ROW[r.id]?.(p.tags, p))
}

/** Every pick the set needs a picture for: photo = picks with a sentence, anime = picks with tags. */
const needed = (set: Set) =>
  PICK_ROWS.flatMap((r) => r.picks.filter((p) => (set === 'photo' ? p.sentence : p.tags)).map((p) => [r, p] as const))

describe.skipIf(!MODE)('Prompt Helper — example pictures', () => {
  const env = liveEnv()
  const pub = path.resolve(__dirname, '../../../public')
  const sets: Set[] = MODE === 'photo' ? ['photo'] : MODE === 'anime' ? ['anime'] : ['photo', 'anime']

  it('has a picture prompt for every pick of every set', () => {
    for (const set of ['photo', 'anime'] as Set[]) {
      expect(needed(set).filter(([r, p]) => !promptFor(set, r, p)).map(([r, p]) => key(r, p)), set).toEqual([])
    }
  })

  // Nudity, acts and positions show the idea covered — their own words must never reach a picture prompt.
  // (Outfits and poses are clothing and posture; those are checked by eye on the contact sheets.)
  it('keeps nudity, act and position words out of their picture prompts', () => {
    for (const [r, p] of [...needed('photo'), ...needed('anime')]) {
      if (!['nudity', 'act', 'position'].includes(r.id)) continue
      const words = [p.sentence, p.tags].filter((x): x is string => !!x)
      for (const set of ['photo', 'anime'] as Set[]) {
        const prompt = promptFor(set, r, p)
        if (prompt) for (const w of words) expect(prompt.includes(w), `${set} ${key(r, p)} carries "${w}"`).toBe(false)
      }
    }
  })

  it('renders every missing picture', async () => {
    for (const set of sets) {
      for (const [r, p] of needed(set)) {
        const file = path.join(pub, thumbPath(r, p, set === 'anime' ? 'tags' : 'sentences'))
        if (MODE !== 'all' && fs.existsSync(file)) continue
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const prompt = promptFor(set, r, p)!
        let ok = false
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const wfDef = set === 'photo' ? krea2TurboWorkflow : animaTurboWorkflow
          const save = set === 'photo' ? 'k:save' : '46'
          const params = { ...wfDef.defaultParams, prompt, seed: freshSeed() + attempt, width: 1024, height: 1024,
            upscale: false, detailer: false, promptEnhancer: false } as GenerationParams
          const wf = wfDef.buildPrompt(params)
          wf[save].inputs.filename_prefix = 'prompt-helper-thumb'
          const { files } = await renderGraph(env.base, wf, `${set} ${key(r, p)}`, env.outputDir)
          try {
            // Not a black frame (~2.5). Colour spread is not gated: vivid scenes sit in the corruption band;
            // every picture gets looked at on a contact sheet instead.
            const luma = meanLuma(rgb(files[0]))
            ok = luma > 8
            if (ok) {
              execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', files[0], '-vf', 'scale=192:192:flags=lanczos',
                '-c:v', 'libwebp', '-quality', '78', file])
            }
          } finally {
            for (const f of files) fs.rmSync(f, { force: true })
          }
        }
        expect(ok, `${set} ${key(r, p)}`).toBe(true)
      }
    }
  }, 4 * 60 * 60_000)
})
