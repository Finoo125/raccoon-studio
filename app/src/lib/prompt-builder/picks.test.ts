import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { workflows } from '@/lib/workflows'
import {
  PICK_ROWS, dropBlocked, fitToLimit, hasPhrase, litPick, phraseOf, picksFor, promptStyleOf, rerollRow, rowBlock, surprise, thumbPath, tidyTags, togglePick, visibleRows,
  type PickRow, type PromptStyle,
} from './picks'

const row = (id: PickRow['id']) => PICK_ROWS.find((r) => r.id === id)!
const pick = (r: PickRow, id: string) => r.picks.find((p) => p.id === id)!
const STYLES: PromptStyle[] = ['sentences', 'tags']

describe('promptStyleOf', () => {
  it('tag models are exactly Pony, Illustrious and Anima', () => {
    expect(workflows.filter((w) => promptStyleOf(w) === 'tags').map((w) => w.id).sort())
      .toEqual(['anima', 'anima-turbo', 'illustrious', 'pony'])
  })
})

describe('pick data', () => {
  it('every row has picks in both styles', () => {
    for (const r of PICK_ROWS) for (const s of STYLES) expect(picksFor(r, s).length, `${r.id}/${s}`).toBeGreaterThan(0)
  })

  it('no phrase contains another phrase of the same style', () => {
    for (const s of STYLES) {
      const phrases = PICK_ROWS.flatMap((r) => r.picks.map((p) => phraseOf(p, s))).filter((x): x is string => !!x)
      for (const a of phrases) for (const b of phrases) if (a !== b) expect(hasPhrase(a, b), `"${a}" contains "${b}"`).toBe(false)
    }
  })

  it('describes adults only, consenting, unrelated, unhurt', () => {
    const minors = /\b(child|children|kids?|teen|teenage|minor|loli|shota|school\w*|young (girl|boy)|little (girl|boy)|underage|toddler|baby)\b/i
    const harm = /\b(rape|forced|non-?consensual|drugged|unconscious|asleep|drunk|hypno\w*|blackmail|incest|step-?\w+|sister|brother|mother|father|mom|dad|daughter|cousin|aunt|uncle|blood|gore|chok(e|ing)|strangl\w*|abuse)\b/i
    for (const r of PICK_ROWS) for (const p of r.picks) {
      for (const text of [p.label, p.sentence ?? '', p.tags ?? '']) {
        expect(text, `${r.id}/${p.id}`).not.toMatch(minors)
        expect(text, `${r.id}/${p.id}`).not.toMatch(harm)
      }
    }
  })

  it('marks lingerie adult, so only the 18+ switch offers it', () => {
    expect(pick(row('wear'), 'lingerie').adult).toBe(true)
  })
})

describe('hasPhrase / litPick', () => {
  it('matches whole phrases only, case-insensitive', () => {
    expect(hasPhrase('A Man on a bench', 'a man')).toBe(true)
    expect(hasPhrase('a manta ray', 'a man')).toBe(false)
    expect(hasPhrase('sunset_glow', 'sunset')).toBe(false)
  })
  it('follows hand edits', () => {
    const where = row('where')
    expect(litPick('my cat, on a sunny beach', where, 'sentences')?.id).toBe('beach')
    expect(litPick('my cat, on a sunny shore', where, 'sentences')).toBeUndefined()
  })
})

describe('togglePick', () => {
  const where = row('where')
  const beach = pick(where, 'beach')
  const forest = pick(where, 'forest')

  it('appends with one separator', () => {
    expect(togglePick('my cat', where, beach, 'sentences')).toBe('my cat, on a sunny beach')
    expect(togglePick('', where, beach, 'sentences')).toBe('on a sunny beach')
    expect(togglePick('masterpiece, best quality, ', where, beach, 'tags')).toBe('masterpiece, best quality, beach, ocean')
  })
  it('folds a trailing full stop into the separator', () => {
    expect(togglePick('A cat on a wall.', where, beach, 'sentences')).toBe('A cat on a wall, on a sunny beach')
  })
  it('removes a lit pick with its separator, wherever it sits', () => {
    expect(togglePick('my cat, on a sunny beach', where, beach, 'sentences')).toBe('my cat')
    expect(togglePick('on a sunny beach, my cat', where, beach, 'sentences')).toBe('my cat')
    expect(togglePick('my cat, on a sunny beach, at sunset', where, beach, 'sentences')).toBe('my cat, at sunset')
    expect(togglePick('a cat on a sunny beach at dawn', where, beach, 'sentences')).toBe('a cat at dawn')
    expect(togglePick('on a sunny beach', where, beach, 'sentences')).toBe('')
  })
  it('swaps another pick of the same row in place', () => {
    expect(togglePick('my cat, on a sunny beach, at sunset', where, forest, 'sentences'))
      .toBe('my cat, in a misty forest, at sunset')
  })
  it('never touches typed text', () => {
    expect(togglePick('Line one\nline two', where, beach, 'sentences')).toBe('Line one\nline two, on a sunny beach')
  })
  it('ignores a pick that has no phrase in this style', () => {
    const photo = pick(row('look'), 'photo')
    expect(togglePick('1girl', row('look'), photo, 'tags')).toBe('1girl')
  })
})

describe('rerollRow', () => {
  it('always changes the row, never to lingerie without 18+', () => {
    const wear = row('wear')
    let p = 'a woman'
    for (let i = 0; i < 200; i++) {
      const next = rerollRow(p, wear, 'sentences', { nsfw: false })
      expect(litPick(next, wear, 'sentences')?.id).not.toBe(litPick(p, wear, 'sentences')?.id)
      expect(next).not.toMatch(/lingerie/)
      p = next
    }
  })
  it('offers lingerie with 18+ on', () => {
    let p = 'a woman'
    let seen = false
    for (let i = 0; i < 400 && !seen; i++) { p = rerollRow(p, row('wear'), 'sentences', { nsfw: true }); seen = /lingerie/.test(p) }
    expect(seen).toBe(true)
  })
  it('swaps in place and leaves other words alone', () => {
    const out = rerollRow('my cat, on a sunny beach, at dawn', row('where'), 'sentences', { rng: () => 0 })
    expect(out).toBe('my cat, on a busy city street, at dawn')
  })
})

describe('surprise', () => {
  const first = () => 0
  const peopleRows = PICK_ROWS.filter((r) => r.forPeople).map((r) => r.id)

  it('changes the description on every click', () => {
    const one = surprise('', 'sentences', { rng: first })
    const two = surprise(one, 'sentences', { rng: first })
    const three = surprise(two, 'sentences', { rng: first })
    expect(two).not.toBe(one)
    expect(three).not.toBe(two)
  })

  it('fills people rows only when Who is a person, and never picks lingerie', () => {
    for (let i = 0; i < 100; i++) {
      const out = surprise('', 'sentences')
      const who = litPick(out, row('who'), 'sentences')
      expect(who).toBeDefined()
      for (const r of visibleRows(false)) {
        const lit = litPick(out, r, 'sentences')
        if (r.forPeople) expect(!!lit, `${r.id} with ${who!.id}`).toBe(!who!.nonHuman)
        else expect(lit, r.id).toBeDefined()
      }
      expect(out).not.toMatch(/lingerie/)
    }
  })

  it("never touches the user's own subject and adds nothing personal to it", () => {
    const out = surprise('my cat as a knight', 'sentences', { rng: first })
    expect(out.startsWith('my cat as a knight, ')).toBe(true)
    expect(litPick(out, row('who'), 'sentences')).toBeUndefined()
    for (const id of peopleRows) expect(litPick(out, row(id), 'sentences'), id).toBeUndefined()
    expect(litPick(out, row('where'), 'sentences')).toBeDefined()
  })

  it('treats a description holding only the preset prefix as empty', () => {
    const prefix = 'score_9, score_8_up, '
    const out = surprise(prefix, 'tags', { prefix, rng: first })
    expect(litPick(out, row('who'), 'tags')).toBeDefined()
    expect(out.startsWith('score_9, score_8_up, ')).toBe(true)
  })

  it('leaves kept rows alone', () => {
    const out = surprise('a woman, at sunset', 'sentences', { keep: new Set(['time', 'who']), rng: first })
    expect(litPick(out, row('time'), 'sentences')?.id).toBe('sunset')
    expect(litPick(out, row('who'), 'sentences')?.id).toBe('woman')
    expect(litPick(out, row('hair'), 'sentences')).toBeDefined()
  })

  // Final review 2026-10-10: a Who that turns into an animal kept the last click's dress (29% of second clicks).
  it('clears hair, clothes and faces when Who becomes an animal', () => {
    const before = 'a woman, with long flowing hair, in an elegant evening dress, blushing shyly, on a sunny beach'
    // An rng that lands Who on the first animal of the list (whatever its length).
    const pool = picksFor(row('who'), 'sentences', false).filter((p) => p.id !== 'woman')
    const at = pool.findIndex((p) => p.nonHuman)
    const out = surprise(before, 'sentences', { rng: () => (at + 0.5) / pool.length })
    expect(litPick(out, row('who'), 'sentences')?.nonHuman).toBe(true)
    for (const id of peopleRows) expect(litPick(out, row(id), 'sentences'), id).toBeUndefined()
  })

  // Final review 2026-10-10: removing a pick leaves the tag prefix without its trailing ", ".
  it('still treats a tag prefix without its trailing comma as empty', () => {
    const prefix = 'score_9, score_8_up, '
    const out = surprise('score_9, score_8_up', 'tags', { prefix, rng: first })
    expect(litPick(out, row('who'), 'tags')).toBeDefined()
  })

  it('keeps people rows empty under a kept animal', () => {
    const out = surprise('a fluffy cat', 'sentences', { keep: new Set(['who']), rng: first })
    for (const id of peopleRows) expect(litPick(out, row(id), 'sentences'), id).toBeUndefined()
  })
})

describe('rows', () => {
  it('are the nineteen topics in display order, with their flags', () => {
    expect(PICK_ROWS.map((r) => r.id)).toEqual(['who', 'body', 'skin', 'hair', 'haircolor', 'face', 'wear', 'pose', 'where', 'time',
      'light', 'shot', 'colors', 'look', 'nudity', 'outfit', 'sensual', 'act', 'position'])
    const ids = (f: (r: PickRow) => unknown) => PICK_ROWS.filter(f).map((r) => r.id)
    expect(ids((r) => r.forPeople)).toEqual(['body', 'skin', 'hair', 'haircolor', 'face', 'wear', 'pose', 'nudity', 'outfit', 'sensual', 'act', 'position'])
    expect(ids((r) => r.nsfw)).toEqual(['nudity', 'outfit', 'sensual', 'act', 'position'])
    expect(ids((r) => r.needsPartners)).toEqual(['act', 'position'])
    expect(ids((r) => r.replacesClothes)).toEqual(['nudity', 'outfit'])
  })
  it('point every pick at its picture: photo set, or anime set for tag models', () => {
    const beach = pick(row('where'), 'beach')
    expect(thumbPath(row('where'), beach)).toBe('/prompt-helper/photo/where/beach.webp')
    expect(thumbPath(row('where'), beach, 'tags')).toBe('/prompt-helper/anime/where/beach.webp')
  })
})

describe('18+', () => {
  it('hides 18+ rows and adult picks without the switch', () => {
    expect(visibleRows(false).some((r) => r.nsfw)).toBe(false)
    expect(visibleRows(true).filter((r) => r.nsfw).map((r) => r.id)).toEqual(['nudity', 'outfit', 'sensual', 'act', 'position'])
    expect(picksFor(row('wear'), 'sentences', false).map((p) => p.id)).not.toContain('lingerie')
    expect(picksFor(row('wear'), 'sentences', true).map((p) => p.id)).toContain('lingerie')
  })
  it('blocks people rows under an animal and partner rows under one person', () => {
    expect(rowBlock('a fluffy cat', row('body'), 'sentences')).toBe('person')
    expect(rowBlock('a fluffy cat', row('act'), 'sentences')).toBe('person')
    expect(rowBlock('a woman', row('act'), 'sentences')).toBe('partners')
    expect(rowBlock('a couple', row('act'), 'sentences')).toBeNull()
    expect(rowBlock('my girlfriend', row('position'), 'sentences')).toBeNull()
    expect(rowBlock('a woman', row('hair'), 'sentences')).toBeNull()
  })
  it('never surprises with 18+ while the switch is off', () => {
    for (let i = 0; i < 150; i++) {
      const out = surprise('', 'sentences')
      for (const r of PICK_ROWS.filter((x) => x.nsfw)) expect(litPick(out, r, 'sentences'), r.id).toBeUndefined()
      expect(out).not.toMatch(/lingerie|boudoir|large bust/)
    }
  })
  it('picks at most one 18+ topic per click, and acts only with partners', () => {
    let partnerActs = 0
    for (let i = 0; i < 200; i++) {
      const couple = surprise('a couple', 'sentences', { nsfw: true, keep: new Set(['who']) })
      const lit = PICK_ROWS.filter((r) => r.nsfw && litPick(couple, r, 'sentences'))
      expect(lit.length).toBeLessThanOrEqual(1)
      if (lit.some((r) => r.needsPartners)) partnerActs++
      const solo = surprise('a woman', 'sentences', { nsfw: true, keep: new Set(['who']) })
      expect(litPick(solo, row('act'), 'sentences')).toBeUndefined()
      expect(litPick(solo, row('position'), 'sentences')).toBeUndefined()
    }
    expect(partnerActs).toBeGreaterThan(0)
  })
  it('clears a position the new Who cannot do', () => {
    const out = surprise('a woman, in missionary position', 'sentences', { nsfw: true, keep: new Set(['who']), rng: () => 0 })
    expect(litPick(out, row('position'), 'sentences')).toBeUndefined()
  })
  // Browser sweep 2026-10-10: with 18+ off, Surprise turned 'a woman, fully nude' into 'a majestic dragon, fully nude'.
  it('clears 18+ picks the new Who cannot do, even with the switch off', () => {
    const pool = picksFor(row('who'), 'sentences', false).filter((p) => p.id !== 'woman')
    const at = pool.findIndex((p) => p.nonHuman)
    const out = surprise('a woman, fully nude', 'sentences', { nsfw: false, rng: () => (at + 0.5) / pool.length })
    expect(litPick(out, row('who'), 'sentences')?.nonHuman).toBe(true)
    expect(litPick(out, row('nudity'), 'sentences')).toBeUndefined()
  })
  it("leaves the user's own 18+ picks alone while the switch is off and Who can do them", () => {
    const out = surprise('a woman, fully nude', 'sentences', { nsfw: false, keep: new Set(['who']) })
    expect(litPick(out, row('nudity'), 'sentences')?.id).toBe('nude')
  })
  it('drops the clothes when it picks nudity or a sexy outfit', () => {
    for (let i = 0; i < 200; i++) {
      const out = surprise('a woman', 'sentences', { nsfw: true, keep: new Set(['who']) })
      if (litPick(out, row('nudity'), 'sentences') || litPick(out, row('outfit'), 'sentences')) {
        expect(litPick(out, row('wear'), 'sentences')).toBeUndefined()
      }
    }
  })
})

describe('final review, round 3', () => {
  const STYLES2: PromptStyle[] = ['sentences', 'tags']

  // "a friendly dog, having sex" came out of three clicks: Couple, Sex, Dog.
  it('drops what a newly clicked Who cannot do', () => {
    for (const st of STYLES2) {
      let d = togglePick('', row('who'), pick(row('who'), 'couple'), st)
      d = togglePick(d, row('act'), pick(row('act'), 'sex'), st)
      d = togglePick(d, row('wear'), pick(row('wear'), 'dress'), st)
      d = dropBlocked(togglePick(d, row('who'), pick(row('who'), 'dog'), st), st)
      expect(litPick(d, row('act'), st), st).toBeUndefined()
      expect(litPick(d, row('wear'), st), st).toBeUndefined()
      expect(litPick(d, row('who'), st)?.id, st).toBe('dog')
    }
  })

  it('drops acts the new Who cannot physically do', () => {
    let d = togglePick('', row('who'), pick(row('who'), 'couple'), 'sentences')
    d = togglePick(d, row('act'), pick(row('act'), 'blowjob'), 'sentences')
    d = dropBlocked(togglePick(d, row('who'), pick(row('who'), 'two-women'), 'sentences'), 'sentences')
    expect(litPick(d, row('act'), 'sentences')).toBeUndefined()
  })

  // Ordinary couple wording lit only Woman, so Acts said "needs two people" and Surprise deleted the position.
  it('counts every Who phrase: a man and a woman are partners', () => {
    expect(rowBlock('a man and a woman in bed', row('act'), 'sentences')).toBeNull()
    expect(rowBlock('a woman, a man', row('position'), 'sentences')).toBeNull()
    // Not cleared as "one person" any more — neither by a Who-change cleanup nor by Surprise with the row kept.
    // (An unkept 18+ row is still re-rolled by Surprise: one 18+ topic per click.)
    expect(dropBlocked('a man and a woman, in missionary position', 'sentences')).toContain('in missionary position')
    const out = surprise('a man and a woman, in missionary position', 'sentences', { nsfw: true, keep: new Set(['position']), rng: () => 0 })
    expect(out).toContain('in missionary position')
  })

  it('blocks people rows only when every Who is an animal or machine', () => {
    expect(rowBlock('a woman and a fluffy cat', row('wear'), 'sentences')).toBeNull()
    expect(rowBlock('a fluffy cat', row('wear'), 'sentences')).toBe('person')
  })

  it('marks every human Who as adult in tag style', () => {
    for (const p of row('who').picks.filter((x) => !x.nonHuman)) {
      expect(p.tags, p.id).toMatch(/\b(adult|mature_female|mature_male|old_man|old_woman)\b/)
    }
  })

  it('never gives Surprise an adult pick under an animal Who', () => {
    for (let i = 0; i < 300; i++) {
      const out = surprise('a fluffy cat', 'sentences', { nsfw: true, keep: new Set(['who']) })
      expect(out).not.toMatch(/boudoir|lingerie|large bust/)
    }
  })

  // "a man, flexing her muscles", "two men, receiving cunnilingus".
  it('fits Surprise picks to who is there', () => {
    for (const who of ['man', 'two-men', 'older-man']) {
      const base = phraseOf(pick(row('who'), who), 'sentences')!
      for (let i = 0; i < 200; i++) {
        const out = surprise(base, 'sentences', { nsfw: true, keep: new Set(['who']) })
        expect(out.slice(base.length), `${who}: ${out}`).not.toMatch(/\b(her|herself)\b/)
        for (const r of PICK_ROWS) {
          const lit = litPick(out, r, 'sentences')
          expect(lit?.needsWoman, `${who}: ${r.id}/${lit?.id}`).toBeFalsy()
        }
      }
    }
    for (let i = 0; i < 200; i++) {
      const out = surprise('two women', 'sentences', { nsfw: true, keep: new Set(['who']) })
      for (const r of PICK_ROWS) expect(litPick(out, r, 'sentences')?.needsMan, out).toBeFalsy()
    }
  })

  it('words everyday rows without her or herself', () => {
    for (const r of PICK_ROWS.filter((x) => !x.nsfw)) for (const p of r.picks) {
      expect(p.sentence ?? '', `${r.id}/${p.id}`).not.toMatch(/\b(her|herself)\b/)
    }
  })

  it('applies the 18+ rules in tag style too', () => {
    for (let i = 0; i < 150; i++) {
      const couple = surprise('1boy, 1girl, couple, mature_female, mature_male', 'tags', { nsfw: true, keep: new Set(['who']) })
      expect(PICK_ROWS.filter((r) => r.nsfw && litPick(couple, r, 'tags')).length).toBeLessThanOrEqual(1)
      const solo = surprise('1girl, solo, adult', 'tags', { nsfw: true, keep: new Set(['who']) })
      expect(litPick(solo, row('act'), 'tags')).toBeUndefined()
      expect(surprise('', 'tags')).not.toMatch(/fellatio|completely_nude|lingerie/)
    }
  })
})

describe('fitToLimit', () => {
  it('leaves short text and a missing limit alone', () => {
    expect(fitToLimit('short', 400)).toBe('short')
    expect(fitToLimit('x'.repeat(900))).toBe('x'.repeat(900))
  })
  it('cuts back to the last comma or full stop under the limit', () => {
    expect(fitToLimit('aaaa, bbbb, cccc', 13)).toBe('aaaa, bbbb')
    expect(fitToLimit('One two. Three four five', 15)).toBe('One two.')
  })
  it('falls back to a word boundary', () => {
    expect(fitToLimit('alpha beta gamma delta', 15)).toBe('alpha beta')
  })
})

describe('tidyTags', () => {
  // Live 2026-10-10: a Pony improve ran away into 3,000+ characters of no_beach_* tags.
  it('drops duplicates and no_ tags (but keeps no_humans), and caps the count', () => {
    expect(tidyTags('1girl, beach, Beach, no_clouds, cat, no_humans, , solo')).toBe('1girl, beach, cat, no_humans, solo')
    const many = Array.from({ length: 60 }, (_, i) => `tag${i}`).join(', ')
    expect(tidyTags(many).split(', ')).toHaveLength(40)
  })
  it("never drops the user's own tags", () => {
    expect(tidyTags('1girl, no_shoes, no_clouds, beach', '1girl, no_shoes')).toBe('1girl, no_shoes, beach')
    const theirs = Array.from({ length: 50 }, (_, i) => `tag${i}`).join(', ')
    expect(tidyTags(theirs + ', extra', theirs).split(', ')).toHaveLength(50)
  })
})

describe('example pictures', () => {
  it('every pick has its picture in each set it is offered in', () => {
    const pub = path.resolve(__dirname, '../../../public')
    const missing = PICK_ROWS.flatMap((r) => r.picks.flatMap((p) => [
      ...(p.sentence ? [thumbPath(r, p, 'sentences')] : []),
      ...(p.tags ? [thumbPath(r, p, 'tags')] : []),
    ])).filter((url) => !fs.existsSync(path.join(pub, url)))
    expect(missing).toEqual([])
  })
})
