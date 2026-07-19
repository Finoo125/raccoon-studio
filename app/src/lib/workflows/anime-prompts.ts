/**
 * Default prompt-box text for the anime/illustration families. These pre-fill the
 * positive/negative boxes when a model is selected so the user starts from that
 * model's quality-tag convention; they stay fully editable. Photoreal families
 * (SDXL base, Z-Image, Ernie) don't use them.
 *
 * The conventions differ per family, so they're split:
 *  - ANIME_* — clean Danbooru quality tags ("masterpiece, best quality, …").
 *    Used by Illustrious, which is trained on booru aesthetic tags and does
 *    NOT understand Pony's score_* vocabulary.
 *  - ANIMA_* — the official Anima model-card convention (huggingface.co/
 *    circlestone-labs/Anima): quality tags + its own score_7 ladder + "safe"
 *    rating tag in the positive, score_1–3 in the negative.
 *  - PONY_*  — Pony Diffusion V6's score ladder ("score_9, score_8_up, …"),
 *    which it specifically relies on; plain quality tags underperform on it.
 */
export const ANIME_DEFAULT_POSITIVE = 'masterpiece, best quality, amazing quality, '
export const ANIME_DEFAULT_NEGATIVE =
  'worst quality, low quality, lowres, bad anatomy, bad hands, watermark, signature, jpeg artifacts'

export const ANIMA_DEFAULT_POSITIVE = 'masterpiece, best quality, score_7, safe, '
export const ANIMA_DEFAULT_NEGATIVE =
  'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration'

export const PONY_DEFAULT_POSITIVE = 'score_9, score_8_up, score_7_up, score_6_up, '
export const PONY_DEFAULT_NEGATIVE =
  'score_4, score_3, score_2, score_1, worst quality, low quality, lowres, bad anatomy, bad hands, watermark'
