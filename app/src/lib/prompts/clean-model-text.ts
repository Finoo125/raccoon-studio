/**
 * One clean paragraph of what a local text model was asked for, or ''. Drops
 * think blocks (closed or not), a preamble ("Here is a prompt:"), a leading
 * "Prompt:" label, wrapping quotes or emphasis, chatter after a blank line,
 * refusals and step-by-step reasoning. Shared by everything that reads a
 * writer's answer — Edit's picture descriptions and the Prompt Helper — so one
 * fix reaches both.
 */
export function cleanModelText(raw: string): string {
  const unthought = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim()
  let paras = unthought.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)
  while (paras.length > 1 && /:\s*(?:\*\*)?$/.test(paras[0])) paras = paras.slice(1)
  const text = (paras[0] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^here(?:'s| is)[^:]*:\s*/i, '')
    .replace(/^(?:\*\*)?(?:final |improved |enhanced )?prompt:(?:\*\*)?\s*/i, '')
    .replace(/^["'“]+|["'”]+$/g, '')
    .replace(/^(\*{1,2}|_{1,2})(\S[\s\S]*\S)\1$/, '$2') // a markdown emphasis pair around it all
    .trim()
  if (/^(i'?m sorry|i can'?t|i cannot|sorry\b|step \d|first,|let me|okay[, ]|sure\b|certainly|the user)/i.test(text)) return ''
  if (/:$/.test(text)) return ''
  return text
}
