import type { ChatMessage } from '@/lib/director/ollama'
import type { PromptMode } from './templates'

export type PromptTask = 'enhance' | 'generate'

const MODE_GUIDANCE: Record<PromptMode, string> = {
  photoreal:
    'Target a PHOTOREALISTIC image model. Emphasize realistic skin quality (visible pores, ' +
    'subsurface scattering, natural blemishes), fine micro-detail, accurate anatomy, real-world ' +
    'lighting and lens/film characteristics. Use photoreal, photographic vocabulary. ' +
    'Never use illustration, cartoon, or anime terms.',
  anime:
    'Target an ANIME / illustrated image model. Emphasize rich environment and background detail, ' +
    'scene composition, clean lineart and cel shading, and a vibrant anime aesthetic. ' +
    'Use anime illustration vocabulary. Never use photoreal/photographic terms.',
}

const TASK_GUIDANCE: Record<PromptTask, string> = {
  enhance:
    'You are given a draft image prompt. Rewrite it into a single richer prompt. ' +
    'Preserve the user’s subject and intent exactly; only add detail and quality cues.',
  generate:
    'You are given a short idea. Write a complete, detailed image prompt from scratch ' +
    'that realizes that idea.',
}

export function buildSystemPrompt(mode: PromptMode, task: PromptTask): string {
  return [
    'You are an expert prompt engineer for text-to-image generation.',
    TASK_GUIDANCE[task],
    MODE_GUIDANCE[mode],
    'Respond with ONLY the final prompt text — no preamble, no quotes, no markdown, no explanation.',
  ].join(' ')
}

export function buildMessages(mode: PromptMode, task: PromptTask, input: string): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(mode, task) },
    { role: 'user', content: input },
  ]
}
