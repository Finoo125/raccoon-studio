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
 *  - ANIMA_* — the Anima-Aesthetic model-card convention (huggingface.co/
 *    circlestone-labs/Anima): plain quality tags + the "safe" rating tag. NO
 *    score_* tags on either side — Aesthetic was fine-tuned on high-quality
 *    images with the quality/score captions stripped, and the card warns the
 *    score ladder pushes it "too hard into slop territory". (The older
 *    Anima-Base did want score_7 / score_1–3.)
 *  - PONY_*  — Pony Diffusion V6's score ladder ("score_9, score_8_up, …"),
 *    which it specifically relies on; plain quality tags underperform on it.
 */
export const ANIME_DEFAULT_POSITIVE = 'masterpiece, best quality, amazing quality, '
export const ANIME_DEFAULT_NEGATIVE =
  'worst quality, low quality, lowres, bad anatomy, bad hands, watermark, signature, jpeg artifacts'

export const ANIMA_DEFAULT_POSITIVE = 'masterpiece, best quality, safe, '
export const ANIMA_DEFAULT_NEGATIVE =
  'worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration'

export const PONY_DEFAULT_POSITIVE = 'score_9, score_8_up, score_7_up, score_6_up, '
export const PONY_DEFAULT_NEGATIVE =
  'score_4, score_3, score_2, score_1, worst quality, low quality, lowres, bad anatomy, bad hands, watermark'
