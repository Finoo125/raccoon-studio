/**
 * ComfyUI's answer to a graph that names a file it does not have: a
 * `value_not_in_list` error on the loader input, carrying the name it got.
 * Turned into words here because the raw JSON ("Generation failed: {…}") is
 * where new users gave up. Spec: 2026-10-11-first-start-setup-design.md §2.
 */
interface ComfyNodeError {
  class_type?: string
  errors?: { type?: string; extra_info?: { input_name?: string; received_value?: unknown } }[]
}

/** Only file names count: an unknown sampler is also `value_not_in_list`, and is not a download. */
const MODEL_FILE = /\.(safetensors|gguf|ckpt|pt|pth|bin|onnx|sft)$/i

/** The file names ComfyUI rejected because they are not on disk, in order, without repeats. */
export function missingFiles(nodeErrors: Record<string, ComfyNodeError> | undefined): string[] {
  const out: string[] = []
  for (const node of Object.values(nodeErrors ?? {})) {
    for (const e of node.errors ?? []) {
      const v = e.extra_info?.received_value
      if (e.type === 'value_not_in_list' && typeof v === 'string' && MODEL_FILE.test(v) && !out.includes(v)) out.push(v)
    }
  }
  return out
}

/** What a person reads instead of ComfyUI's JSON. */
export function missingFilesMessage(files: string[]): string {
  return files.length === 1
    ? `"${files[0]}" isn't downloaded. Download it on the Models page, or open Start here.`
    : `${files.length} model files aren't downloaded: ${files.join(', ')}. Download them on the Models page, or open Start here.`
}

/** `node_errors` from a rejected /prompt response body; undefined when the body is not ComfyUI's JSON. */
export function nodeErrorsOf(body: string): Record<string, ComfyNodeError> | undefined {
  try {
    return (JSON.parse(body) as { node_errors?: Record<string, ComfyNodeError> }).node_errors
  } catch {
    return undefined
  }
}
