import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/system/json-store'

const PRESETS_FILE = 'prompt-presets.json'
const WILDCARDS_FILE = 'wildcards.json'

export interface PromptPreset { id: string; name: string; prompt: string; negative?: string }
export type WildcardLists = Record<string, string[]>

export function readPresets(): PromptPreset[] {
  return readJson<PromptPreset[]>(PRESETS_FILE, [])
}

export function upsertPreset(p: { id?: string; name: string; prompt: string; negative?: string }): PromptPreset[] {
  const list = readPresets()
  if (p.id) {
    const idx = list.findIndex((x) => x.id === p.id)
    const rec: PromptPreset = { id: p.id, name: p.name, prompt: p.prompt, negative: p.negative }
    if (idx >= 0) list[idx] = rec
    else list.push(rec)
  } else {
    list.push({ id: randomUUID(), name: p.name, prompt: p.prompt, negative: p.negative })
  }
  writeJson(PRESETS_FILE, list)
  return list
}

export function deletePreset(id: string): PromptPreset[] {
  const next = readPresets().filter((p) => p.id !== id)
  writeJson(PRESETS_FILE, next)
  return next
}

export function readWildcards(): WildcardLists {
  return readJson<WildcardLists>(WILDCARDS_FILE, {})
}

export function putWildcard(name: string, items: string[]): WildcardLists {
  const all = readWildcards()
  all[name] = items
  writeJson(WILDCARDS_FILE, all)
  return all
}

export function deleteWildcard(name: string): WildcardLists {
  const all = readWildcards()
  delete all[name]
  writeJson(WILDCARDS_FILE, all)
  return all
}
