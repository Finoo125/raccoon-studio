const WRITER_PATH = 'rvn/generate_stream'
const FEATURE = 'prompt-builder'

// fetch/aiohttp normalise dot segments, empty segments and percent-escapes, so
// the gate must too. Anything undecodable fails closed (treated as the writer).
function normalise(path: string): string {
  let p = path
  try {
    for (let i = 0; i < 5; i++) {
      const d = decodeURIComponent(p)
      if (d === p) break
      p = d
    }
  } catch { return WRITER_PATH }
  const out: string[] = []
  for (const seg of p.split(/[/\\]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/**
 * The video prompt writer streams through the generic ComfyUI proxy, which has
 * no add-on check. Returns a 403 for that one path when the Prompt Helper is
 * locked (Director owners keep the writer in Director mode), else null.
 */
export async function videoWriterRefusal(
  path: string,
  body: ArrayBuffer,
  unlocked: (id: string) => Promise<boolean>,
): Promise<Response | null> {
  if (normalise(path) !== WRITER_PATH) return null
  if (await unlocked(FEATURE)) return null
  let mode: unknown
  try { mode = JSON.parse(new TextDecoder().decode(body))?.video_mode } catch { /* unparsable = locked */ }
  if (mode === 'director' && (await unlocked('ltx-director'))) return null
  return new Response(JSON.stringify({ error: 'Feature locked', feature: FEATURE }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
