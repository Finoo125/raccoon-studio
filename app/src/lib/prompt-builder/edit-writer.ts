import type { ChatMessage } from '@/lib/director/ollama'
import type { H3EditKind } from '@/lib/workflows/minimax-h3'
import { PICK_ROWS, type PickRow, type PickRowId } from './picks'

const ONLY = 'Reply with only the instruction text — no preamble, no quotes, no explanation.'

/**
 * Names no example content: a 4B writer copies whatever the system prompt shows.
 * Shapes are the ones that worked in this project's Edit tests.
 */
const SYSTEM: Record<H3EditKind, string> = {
  vfx: [
    'You write instructions for an AI video editor that changes a video.',
    'The user gives a rough wish. Write one short instruction in plain English: first the change itself, ' +
      'then a keep clause saying what must stay the same — the face, hair, pose, motion, camera and setting.',
    'If a picture of the video is attached, name what you see there in the keep clause, and only what you see.',
    'Never describe anyone as a child, teenager or minor.',
    ONLY,
  ].join(' '),
  style: [
    'You write instructions for an AI video editor that restyles a whole video.',
    'The user gives a rough wish. Write exactly one sentence in plain English that starts with "Transform this video into" ' +
      'and then names the look. Do not describe the content of the video.',
    ONLY,
  ].join(' '),
  head: [
    'You write instructions for an AI video editor that swaps a person’s head for a new face.',
    'The user gives a rough wish. Write one line of comma-separated words describing only the new face: ' +
      'age, face shape, eyes, skin, hair. Nothing about the body, clothes, setting or motion.',
    'The new person is always an adult.',
    ONLY,
  ].join(' '),
}

export function buildEditMessages(kind: H3EditKind, idea: string, current: string, frameB64?: string): ChatMessage[] {
  const ask = current.trim() ? `Wish: ${idea}\nCurrent instruction: ${current}` : `Wish: ${idea}`
  return [
    { role: 'system', content: SYSTEM[kind] },
    // "Answer in English." is repeated here: small writers answer in the idea's language without it.
    { role: 'user', content: `${ask}\nAnswer in English.`, ...(frameB64 ? { images: [frameB64] } : {}) },
  ]
}

const source = (id: PickRowId): PickRow => PICK_ROWS.find((r) => r.id === id)!
/** The image helper's row with every sentence rewritten; ids stay so thumbPath finds the pictures. */
const reword = (id: PickRowId, fn: (s: string) => string): PickRow => {
  const row = source(id)
  return { ...row, picks: row.picks.flatMap((p) => (p.sentence ? [{ ...p, sentence: fn(p.sentence) }] : [])) }
}

const card = (id: string, label: string, sentence: string) => ({ id, label, sentence })
const NEW_HEAD_ROWS: PickRow[] = [
  { id: 'age', label: 'Age', emoji: '🎂', forPeople: true, picks: [
    card('25', 'About 25', 'about 25 years old'),
    card('35', 'About 35', 'about 35 years old'),
    card('45', 'About 45', 'about 45 years old'),
    card('55', 'About 55', 'about 55 years old'),
    card('65', 'About 65', 'about 65 years old'),
  ] },
  { id: 'faceshape', label: 'Face shape', emoji: '🙂', forPeople: true, picks: [
    card('oval', 'Oval', 'an oval face'),
    card('round', 'Round', 'a round face'),
    card('square', 'Square', 'a square jaw'),
    card('heart', 'Heart', 'a heart-shaped face'),
    card('long', 'Long', 'a long face'),
  ] },
  { id: 'eyes', label: 'Eyes', emoji: '👁', forPeople: true, picks: [
    card('blue', 'Blue', 'blue eyes'),
    card('green', 'Green', 'green eyes'),
    card('brown', 'Brown', 'brown eyes'),
    card('hazel', 'Hazel', 'hazel eyes'),
    card('grey', 'Grey', 'grey eyes'),
  ] },
]

/** Picture-card rows for one kind of edit; each pick's sentence is a clause the editor can follow. */
export function editRows(kind: H3EditKind): PickRow[] {
  if (kind === 'vfx') return [
    reword('wear', (s) => `Change the clothes so the person is ${s}`),
    reword('haircolor', (s) => `Give the person ${s.replace(/^with /, '')}`),
    reword('where', (s) => `Place the scene ${s}`),
    reword('time', (s) => `Set the scene ${s}`),
  ]
  if (kind === 'style') return [reword('look', (s) => `Transform this video into ${s}`)]
  return [source('hair'), source('haircolor'), ...NEW_HEAD_ROWS]
}
