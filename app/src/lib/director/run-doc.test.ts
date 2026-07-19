import { describe, it, expect } from 'vitest'
import {
  deriveBeatCount, createRunDoc, applyStoryboard, applyOpeningImage,
  seedImageForBeat, markBeatRendering, markBeatDone, markBeatError, resetBeat,
  nextPendingBeat, allBeatsDone, markAssembled,
} from './run-doc'

describe('deriveBeatCount', () => {
  it('rounds target seconds to 15s beats, minimum 1', () => {
    expect(deriveBeatCount(60, 15)).toBe(4)
    expect(deriveBeatCount(120, 15)).toBe(8)
    expect(deriveBeatCount(90, 15)).toBe(6)
    expect(deriveBeatCount(67, 15)).toBe(4) // 4.46 -> 4
    expect(deriveBeatCount(0, 15)).toBe(1) // clamp to >= 1
  })
})

describe('createRunDoc', () => {
  it('builds a draft run with derived beat count and no beats yet', () => {
    const run = createRunDoc({
      name: '  My Film ',
      plot: 'a hero rises',
      imageModel: 'anima',
      ollamaModel: 'llama3.1',
      targetSeconds: 90,
    })
    expect(run.id).toMatch(/[0-9a-f-]{36}/)
    expect(run.name).toBe('My Film')
    expect(run.status).toBe('draft')
    expect(run.clipSeconds).toBe(15)
    expect(run.beatCount).toBe(6)
    expect(run.beats).toEqual([])
    expect(run.openingImagePrompt).toBe('')
    expect(run.createdAt).toBe(run.modifiedAt)
  })

  it('falls back to a default name and clamps target seconds', () => {
    const run = createRunDoc({
      name: '   ',
      plot: 'x',
      imageModel: 'z-image-turbo',
      ollamaModel: 'm',
      targetSeconds: 9999,
    })
    expect(run.name).toBe('Untitled film')
    expect(run.targetSeconds).toBe(120)
  })
})

describe('applyStoryboard', () => {
  it('writes opening prompt + beats and advances status to storyboard', () => {
    const run = createRunDoc({
      name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 60,
    })
    const next = applyStoryboard(run, {
      openingImagePrompt: 'a wide shot of a city',
      negativePrompt: 'blurry',
      beats: ['beat one', 'beat two'],
    })
    expect(next.status).toBe('storyboard')
    expect(next.openingImagePrompt).toBe('a wide shot of a city')
    expect(next.negativePrompt).toBe('blurry')
    expect(next.beats).toEqual([
      { index: 0, videoPrompt: 'beat one', status: 'pending' },
      { index: 1, videoPrompt: 'beat two', status: 'pending' },
    ])
  })

  it('does not mutate the input run', () => {
    const run = createRunDoc({
      name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 60,
    })
    applyStoryboard(run, { openingImagePrompt: 'x', beats: ['a'] })
    expect(run.beats).toEqual([])
    expect(run.status).toBe('draft')
  })

  it('syncs beatCount to the actual number of parsed beats', () => {
    const run = createRunDoc({
      name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 120,
    })
    expect(run.beatCount).toBe(8) // derived from 120s
    const next = applyStoryboard(run, {
      openingImagePrompt: 'x',
      beats: ['a', 'b', 'c'], // model returned only 3
    })
    expect(next.beatCount).toBe(3)
    expect(next.beats).toHaveLength(3)
  })
})

describe('applyOpeningImage', () => {
  it('stores the opening image and pins status to opening-image', () => {
    const run = applyStoryboard(
      createRunDoc({ name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 30 }),
      { openingImagePrompt: 'x', beats: ['a'] },
    )
    const next = applyOpeningImage(run, {
      inputFilename: 'director-abc.png',
      url: '/api/comfyui/view?filename=director-abc.png&subfolder=&type=input',
    })
    expect(next.status).toBe('opening-image')
    expect(next.openingImage).toEqual({
      inputFilename: 'director-abc.png',
      url: '/api/comfyui/view?filename=director-abc.png&subfolder=&type=input',
    })
  })

  it('does not mutate the input run', () => {
    const run = createRunDoc({ name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 30 })
    applyOpeningImage(run, { inputFilename: 'x.png', url: 'u' })
    expect(run.openingImage).toBeUndefined()
  })
})

function renderReadyRun() {
  const run = applyOpeningImage(
    applyStoryboard(
      createRunDoc({ name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 30 }),
      { openingImagePrompt: 'x', beats: ['beat one', 'beat two'] },
    ),
    { inputFilename: 'opening.png', url: 'u' },
  )
  return run
}

describe('seedImageForBeat', () => {
  it('uses the opening image for beat 0 and the prior last frame after', () => {
    let run = renderReadyRun()
    expect(seedImageForBeat(run, 0)).toBe('opening.png')
    // beat 1 needs beat 0's last frame
    expect(seedImageForBeat(run, 1)).toBeNull()
    run = markBeatDone(run, 0, { videoUrl: 'v0', lastFrameInputFilename: 'lf0.png' })
    expect(seedImageForBeat(run, 1)).toBe('lf0.png')
  })

  it('returns null for beat 0 when no opening image is set', () => {
    const run = applyStoryboard(
      createRunDoc({ name: 'f', plot: 'p', imageModel: 'anima', ollamaModel: 'm', targetSeconds: 30 }),
      { openingImagePrompt: 'x', beats: ['a'] },
    )
    expect(seedImageForBeat(run, 0)).toBeNull()
  })
})

describe('beat transitions', () => {
  it('markBeatRendering sets the beat + run status to rendering', () => {
    const run = markBeatRendering(renderReadyRun(), 0, { promptId: 'p1', seedImageFilename: 'opening.png' })
    expect(run.status).toBe('rendering')
    expect(run.beats[0]).toMatchObject({ status: 'rendering', promptId: 'p1', seedImageFilename: 'opening.png' })
  })

  it('markBeatDone records the video + last frame and clears error', () => {
    let run = markBeatError(renderReadyRun(), 0, 'boom')
    run = markBeatDone(run, 0, { videoUrl: 'v0', lastFrameInputFilename: 'lf0.png' })
    expect(run.beats[0]).toMatchObject({ status: 'done', videoUrl: 'v0', lastFrameInputFilename: 'lf0.png' })
    expect(run.beats[0].error).toBeUndefined()
  })

  it('markBeatError stores the message', () => {
    const run = markBeatError(renderReadyRun(), 1, 'nope')
    expect(run.beats[1]).toMatchObject({ status: 'error', error: 'nope' })
  })

  it('resetBeat returns a beat to pending and drops promptId/error', () => {
    let run = markBeatError(renderReadyRun(), 0, 'x')
    run = markBeatRendering(run, 0, { promptId: 'p', seedImageFilename: 's' })
    run = resetBeat(run, 0)
    expect(run.beats[0]).toMatchObject({ status: 'pending' })
    expect(run.beats[0].promptId).toBeUndefined()
    expect(run.beats[0].error).toBeUndefined()
  })

  it('does not mutate the input run', () => {
    const run = renderReadyRun()
    markBeatDone(run, 0, { videoUrl: 'v', lastFrameInputFilename: 'l' })
    expect(run.beats[0].status).toBe('pending')
  })
})

describe('nextPendingBeat / allBeatsDone', () => {
  it('finds the first pending beat and detects completion', () => {
    let run = renderReadyRun()
    expect(nextPendingBeat(run)).toBe(0)
    expect(allBeatsDone(run)).toBe(false)
    run = markBeatDone(run, 0, { videoUrl: 'v', lastFrameInputFilename: 'l' })
    expect(nextPendingBeat(run)).toBe(1)
    run = markBeatDone(run, 1, { videoUrl: 'v', lastFrameInputFilename: 'l' })
    expect(nextPendingBeat(run)).toBeNull()
    expect(allBeatsDone(run)).toBe(true)
  })

  it('skips an errored beat (it is not "pending") so the chain halts on it', () => {
    let run = renderReadyRun()
    run = markBeatError(run, 0, 'x')
    expect(nextPendingBeat(run)).toBe(1)
    expect(allBeatsDone(run)).toBe(false)
  })
})

describe('markAssembled', () => {
  it('records the movie project id and marks the run done', () => {
    const run = renderReadyRun()
    const next = markAssembled(run, 'movie-123')
    expect(next.status).toBe('done')
    expect(next.movieProjectId).toBe('movie-123')
  })

  it('does not mutate the input run', () => {
    const run = renderReadyRun()
    markAssembled(run, 'm')
    expect(run.movieProjectId).toBeUndefined()
    expect(run.status).not.toBe('done')
  })
})
