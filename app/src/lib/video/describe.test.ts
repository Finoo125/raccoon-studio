import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KREA2_TEXT_ENCODER, describeQuestion, cleanDescription, buildDescribePicturePrompt } from './describe'

describe('describe', () => {
  it('uses the encoder the Krea2 template loads', () => {
    const tpl = JSON.parse(readFileSync(join(__dirname, '../../../workflows/image_krea2.json'), 'utf8'))
    expect(tpl['k:clip'].inputs.clip_name).toBe(KREA2_TEXT_ENCODER)
  })
  it('asks a question per role, and an identity question for Swap head', () => {
    expect(describeQuestion('character', false)).toMatch(/hair[\s\S]*build[\s\S]*clothing/)
    expect(describeQuestion('outfit', false)).toMatch(/Ignore any person/)
    expect(describeQuestion('location', false)).toMatch(/Ignore any people/)
    expect(describeQuestion('style', false)).toMatch(/Do not name artists/)
    expect(describeQuestion('character', true)).toMatch(/face shape/)
    expect(describeQuestion(null, false)).toMatch(/main subject/)
  })
  it('cleanDescription keeps one clean sentence and drops reasoning or refusals', () => {
    expect(cleanDescription('  "A woman with silver hair."\n\nI hope this helps')).toBe('A woman with silver hair.')
    expect(cleanDescription('<think>hmm</think>A beach at sunset.')).toBe('A beach at sunset.')
    expect(cleanDescription("I'm sorry, I can't help with that.")).toBe('')
    expect(cleanDescription('Step 1: look at the picture')).toBe('')
    expect(cleanDescription('x'.repeat(900)).length).toBeLessThanOrEqual(500)
  })
  it('builds the built-in describer graph', () => {
    const wf = buildDescribePicturePrompt('me.png', 'Describe.')
    expect(wf['desc:clip']).toEqual({ class_type: 'CLIPLoader', inputs: { clip_name: KREA2_TEXT_ENCODER, type: 'krea2', device: 'default' } })
    expect(wf['desc:gen'].inputs).toMatchObject({ clip: ['desc:clip', 0], image: ['desc:img', 0], prompt: 'Describe.', thinking: true, 'sampling_mode.seed': 0 })
    expect(wf['desc:out']).toEqual({ class_type: 'PreviewAny', inputs: { source: ['desc:gen', 0] } })
  })
})

describe('cleanDescription — chatty answers', () => {
  it('skips a preamble that ends in a colon and the usual openers', () => {
    expect(cleanDescription('Here is a one-sentence description:\n\nA woman with silver hair.')).toBe('A woman with silver hair.')
    expect(cleanDescription("Here's the description: A beach at sunset.")).toBe('A beach at sunset.')
    expect(cleanDescription('Sure! A red bikini.')).toBe('')
    expect(cleanDescription('The user wants a description of the picture.')).toBe('')
    expect(cleanDescription('<think>still thinking about it')).toBe('')
  })
})
