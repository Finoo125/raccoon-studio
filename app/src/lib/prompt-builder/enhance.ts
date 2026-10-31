import type { ChatMessage } from '@/lib/director/ollama'
import { wildcardTokens } from '@/lib/prompts/wildcards-expand'
import type { PromptStyle } from './picks'

/** write = idea → full prompt; improve = polish the prompt that is there. */
export type PromptTask = 'write' | 'improve'

const TASK: Record<PromptTask, string> = {
  write:
    'The user gives an idea and, optionally, words already in their prompt. Turn the idea into a ' +
    'complete image prompt and keep everything that is already in the prompt.',
  improve:
    'The user gives their image prompt. Improve it: keep every subject, object, action and meaning ' +
    'exactly as they are, and only add helpful visual detail.',
}

const STYLE: Record<PromptStyle, string> = {
  sentences:
    'Write one vivid paragraph of plain English, about 50 to 90 words: the subject, what they wear, the ' +
    'setting, the light, the camera framing and the overall look. Describe only what can be seen. ' +
    'No lists, no headings, no line breaks.',
  tags:
    'Write comma-separated Danbooru-style tags, most important first, lowercase with underscores: at most ' +
    '40 tags, and only for things that are in the picture. No sentences.',
}

/**
 * Every example named here gets copied into the answer by a 4B model (live,
 * 2026-10-10: sentence prompts came back starting "score_9 masterpiece," and a
 * cat became "an adult cat"), so the rules name no tags, and the lines about
 * leading tags and wildcards appear only when `prompt` has them.
 */
export function buildSystemPrompt(task: PromptTask, style: PromptStyle, limit?: number, prompt = ''): string {
  const wildcards = wildcardTokens(prompt)
  return [
    'You are an expert prompt writer for an AI image generator.',
    TASK[task],
    STYLE[style],
    'Write the prompt in English, whatever language the user writes in.',
    'Never describe anyone as a child, teenager or minor.',
    'Never write sexual content involving animals, or anyone who has not consented.',
    style === 'tags' && prompt.trim() ? 'Keep the tags already at the start of the prompt exactly as they are.' : '',
    wildcards.length ? `Keep these wildcards exactly as written: ${wildcards.join(', ')}.` : '',
    limit ? `Keep the whole prompt under ${limit} characters.` : '',
    'Reply with only the prompt text — no preamble, no quotes, no explanation.',
  ].filter(Boolean).join(' ')
}

export function buildUserMessage(task: PromptTask, prompt: string, idea?: string): string {
  // Repeated from the system prompt: a small writer (qwen3.5:4b) answered German ideas in German without it.
  const ask = task === 'improve' ? `Prompt: ${prompt}` : prompt.trim() ? `Idea: ${idea}\nAlready in the prompt: ${prompt}` : `Idea: ${idea}`
  return `${ask}\nAnswer in English.`
}

export function buildMessages(
  task: PromptTask, style: PromptStyle, prompt: string, idea?: string, limit?: number,
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(task, style, limit, prompt) },
    { role: 'user', content: buildUserMessage(task, prompt, idea) },
  ]
}
