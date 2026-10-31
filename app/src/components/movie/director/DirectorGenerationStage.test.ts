import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DirectorGenerationStage from './DirectorGenerationStage'

// The AI film's Render step embeds the whole video studio. VideoGenerationForm reads
// useVideoForm(), which throws outside a VideoFormProvider — and only /generate-videos
// had one, so every Render step crashed on mount.
describe('DirectorGenerationStage', () => {
  // (The image studio needs the Next app router mounted, which a unit test has not.)
  it('mounts the video studio', () => {
    const el = createElement(DirectorGenerationStage, {
      kind: 'video', label: 'Beat 1 of 3', prefill: { workflowId: 'ltx23', params: {} }, onSelect: () => {},
    })
    expect(() => renderToString(el)).not.toThrow()
  })
})
