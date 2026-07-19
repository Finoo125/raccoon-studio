// Pure helpers for the video prompt enhance stream (the vendored node's
// /rvn/generate_stream SSE). The hook (useCinematicEnhance) wires these to
// fetch + AbortController; everything here is side-effect-free so it can be
// unit-tested directly.

/**
 * The discriminated union of events the stream can carry. `timeline` arrives
 * from the node but is display-less here; `reset` is local-only — the hook
 * dispatches it to clear state before a fresh run.
 */
export type CinematicEvent =
  | { type: 'status'; msg: string }
  | { type: 'timeline'; beats: unknown[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; prompt?: string }
  | { type: 'error'; msg: string }
  | { type: 'reset' }

/** Accumulated UI state derived from the event stream. */
export interface EnhanceState {
  status: string
  promptText: string
  error: string | null
}

export const initialEnhanceState: EnhanceState = {
  status: '',
  promptText: '',
  error: null,
}

/**
 * Split an accumulated SSE text buffer into parsed events plus the trailing
 * partial block. SSE blocks are separated by a blank line (`\n\n`); each block's
 * payload is a `data: <json>` line. Unparseable blocks are skipped.
 */
export function parseSseBuffer(buffer: string): { events: CinematicEvent[]; rest: string } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: CinematicEvent[] = []
  for (const block of parts) {
    const line = block.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const json = line.slice(line.indexOf(':') + 1).trim()
    if (!json) continue
    try {
      events.push(JSON.parse(json) as CinematicEvent)
    } catch {
      /* partial/garbage block — skip */
    }
  }
  return { events, rest }
}

/** Fold one event into the accumulated state. Pure — returns a new object. */
export function enhanceReducer(state: EnhanceState, event: CinematicEvent): EnhanceState {
  switch (event.type) {
    case 'status':
      return { ...state, status: event.msg }
    case 'delta':
      return { ...state, promptText: state.promptText + event.text }
    case 'done':
      // The node's finalize() pass (i2v anchor, fence stripping) can differ
      // from the raw deltas — adopt its final prompt when it sends one.
      return event.prompt ? { ...state, promptText: event.prompt } : state
    case 'error':
      return { ...state, error: event.msg }
    case 'reset':
      return initialEnhanceState
    default:
      // timeline, done, and anything the node may add later.
      return state
  }
}
