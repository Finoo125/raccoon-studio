// Preset lists (environment / scenario / camera / music) from the vendored
// video prompt node's GET /rvn/options — index 0 of each list is its default.

export interface VideoPromptOptions {
  environments: string[]
  scenarios: string[]
  cameras: string[]
  music: string[]
}

/** Safe defaults when ComfyUI is down — the node's own "None" keys. */
export const FALLBACK_OPTIONS: VideoPromptOptions = {
  environments: ['None — LLM decides'],
  scenarios: ["None — user's prompt decides"],
  cameras: ['None'],
  music: ['None — LLM decides'],
}

/** Fetch the preset lists through the proxy. Never throws — returns fallbacks. */
export async function fetchVideoPromptOptions(): Promise<VideoPromptOptions> {
  try {
    const res = await fetch('/api/comfyui/rvn/options', { cache: 'no-store' })
    if (!res.ok) return FALLBACK_OPTIONS
    const j = (await res.json()) as Partial<VideoPromptOptions>
    const list = (x: unknown, fb: string[]) =>
      Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === 'string')
        ? (x as string[])
        : fb
    return {
      environments: list(j.environments, FALLBACK_OPTIONS.environments),
      scenarios: list(j.scenarios, FALLBACK_OPTIONS.scenarios),
      cameras: list(j.cameras, FALLBACK_OPTIONS.cameras),
      music: list(j.music, FALLBACK_OPTIONS.music),
    }
  } catch {
    return FALLBACK_OPTIONS
  }
}
