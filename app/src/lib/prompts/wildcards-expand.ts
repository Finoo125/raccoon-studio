// Caps total resolution steps to break self-referential list cycles
// (`__x__` → "… __x__ …"). Each inline group / token costs one step, so this
// must comfortably exceed the group count of a large hand-written prompt.
const MAX_DEPTH = 500
const TOKEN_RE = /__([A-Za-z0-9_-]+)__/

/** True if the string contains an inline group `{...}` or a `__name__` token. */
export function hasWildcards(s: string): boolean {
  return s.includes('{') || TOKEN_RE.test(s)
}

/** Splits the top-level `|` separators of a group body, respecting nested braces. */
function splitOptions(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '{') { depth++; cur += ch }
    else if (ch === '}') { depth--; cur += ch }
    else if (ch === '|' && depth === 0) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

/** Resolves the inner-most `{...}` group once; returns null if there is none. */
function resolveOneGroup(s: string, rng: () => number): string | null {
  const open = s.lastIndexOf('{')
  if (open === -1) return null
  const close = s.indexOf('}', open)
  if (close === -1) return null
  const body = s.slice(open + 1, close)
  const opts = splitOptions(body)
  const pick = opts[Math.min(opts.length - 1, Math.floor(rng() * opts.length))]
  return s.slice(0, open) + pick + s.slice(close + 1)
}

/**
 * Expands wildcard syntax to a concrete string:
 * - `{a|b|c}` → one option at random (nested groups resolve inner-first).
 * - `__name__` → a random line from `lists[name]`, itself expanded.
 * Unknown `__name__` tokens are left literal; recursion is depth-capped.
 */
export function expandWildcards(
  template: string,
  lists: Record<string, string[]>,
  rng: () => number = Math.random,
): string {
  let s = template
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    // Resolve inline groups first (inner-most out via lastIndexOf).
    const next = resolveOneGroup(s, rng)
    if (next !== null) { s = next; continue }
    // Then the left-most __name__ token; the replacement may reintroduce groups
    // or tokens, so we loop again.
    const m = TOKEN_RE.exec(s)
    if (!m) break
    const list = lists[m[1]]
    if (!list || list.length === 0) {
      // Unknown/empty list: leave the token literal and expand only what
      // follows it, so we neither loop forever nor blank a typo'd token.
      const head = s.slice(0, m.index + m[0].length)
      const tail = s.slice(m.index + m[0].length)
      return head + expandWildcards(tail, lists, rng)
    }
    const choice = list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
    s = s.slice(0, m.index) + choice + s.slice(m.index + m[0].length)
  }
  return s
}
