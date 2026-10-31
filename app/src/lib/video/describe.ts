import type { ComfyUIPrompt } from '@/types/comfyui'
import { cleanModelText } from '@/lib/prompts/clean-model-text'

/** Krea2's text encoder — a Qwen3-VL-4B that can also write. H3's own 32B encoder cannot (it returns commas). */
export const KREA2_TEXT_ENCODER = 'qwen3vl_4b_fp8_scaled.safetensors'
export const KREA2_TEXT_ENCODER_URL = `https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/${KREA2_TEXT_ENCODER}`

const ONLY = 'Write only the description, in one sentence.'
const QUESTIONS: Record<string, string> = {
  character: `Describe the person in this picture for a video edit: apparent age and sex, hair (colour, length, style), skin tone, build, tattoos or other distinctive marks, and every visible piece of clothing with its colour. ${ONLY}`,
  outfit: `Describe the clothing in this picture for a video edit: each garment, its cut, material, colours and pattern. Ignore any person. ${ONLY}`,
  location: `Describe the place in this picture for a video edit: the setting, time of day, light, main objects and colours. Ignore any people. ${ONLY}`,
  prop: `Describe the main object in this picture for a video edit: what it is, its shape, material and colours. Ignore any person. ${ONLY}`,
  style: `Describe the visual style of this picture: medium, linework, colour palette, shading and texture. Do not name artists. ${ONLY}`,
}
const HEAD = `Describe this person's head for an identity reference: sex, apparent age, face shape, skin tone, eye colour, hair (colour, length, style), facial hair, glasses or jewelry. ${ONLY}`
const OTHER = `Describe the main subject of this picture for a video edit. ${ONLY}`

export function describeQuestion(role: string | null, head: boolean): string {
  return head ? HEAD : QUESTIONS[role ?? ''] ?? OTHER
}

/**
 * One clean sentence or ''. Drops think blocks (closed or not), a preamble
 * ("Here is a description:"), quotes, chatter after a blank line, refusals and
 * step-by-step reasoning — anything that is not the description itself.
 */
export function cleanDescription(raw: string): string {
  const text = cleanModelText(raw)
  return text.length > 500 ? `${text.slice(0, 497).replace(/\s+\S*$/, '')}…` : text
}

/** The built-in describer: Krea2's encoder writing about one picture, read back through PreviewAny. */
export function buildDescribePicturePrompt(image: string, question: string): ComfyUIPrompt {
  return {
    'desc:clip': { class_type: 'CLIPLoader', inputs: { clip_name: KREA2_TEXT_ENCODER, type: 'krea2', device: 'default' } },
    'desc:img': { class_type: 'LoadImage', inputs: { image } },
    'desc:gen': {
      class_type: 'TextGenerate',
      inputs: {
        clip: ['desc:clip', 0], image: ['desc:img', 0], prompt: question, max_length: 256,
        // thinking: true — off, Qwen3-VL wrote its reasoning into the answer (Krea2 enhancer, 2026-09-30).
        thinking: true, use_default_template: true,
        sampling_mode: 'on', 'sampling_mode.temperature': 0.7, 'sampling_mode.top_k': 64, 'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05, 'sampling_mode.repetition_penalty': 1.05, 'sampling_mode.seed': 0, 'sampling_mode.presence_penalty': 0,
      },
    },
    'desc:out': { class_type: 'PreviewAny', inputs: { source: ['desc:gen', 0] } },
  }
}
