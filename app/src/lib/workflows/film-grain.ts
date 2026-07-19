import type { ComfyUIPrompt } from '@/types/comfyui'

export interface FilmGrainOptions {
  /**
   * Blend alpha toward a grayscale noise image (Image.blend). This is BOTH the
   * grain strength and the desaturation driver, so keep it low — 0.1 already
   * reads as visibly grainy and gray. ~0.04 gives a subtle photographic grain
   * with negligible color loss.
   */
  intensity?: number
  /** Grain coverage/fineness; higher = denser texture. */
  density?: number
}

/**
 * Appends a subtle film-grain pass (RES4LYF "Film Grain" node) as the very last
 * step before SaveImage, wrapping whatever currently feeds it.
 *
 * Why: photorealistic checkpoints (and the ReActor/GPEN face restore) tend to
 * render airbrushed, high-frequency-poor skin. A light photographic grain
 * reintroduces that texture across the frame so the result reads as a photo
 * rather than an over-smoothed render.
 *
 * `repeats` MUST stay 1; the node tiles the batch otherwise. Node id uses a
 * `grain:` prefix to avoid numeric-id collisions.
 */
export function appendFilmGrain(wf: ComfyUIPrompt, saveNodeId: string, opts: FilmGrainOptions = {}): void {
  const imageInput = wf[saveNodeId].inputs.images as [string, number]

  wf['grain:film'] = {
    class_type: 'Film Grain',
    inputs: {
      image: imageInput,
      density: opts.density ?? 0.4,
      intensity: opts.intensity ?? 0.04,
      highlights: 1.0,
      supersample_factor: 2,
      repeats: 1,
    },
  }

  wf[saveNodeId].inputs.images = ['grain:film', 0]
}
