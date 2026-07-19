/**
 * Lists the saved ReActor face models available on the ComfyUI server.
 *
 * ReActor's `ReActorLoadFaceModel` node exposes the contents of
 * `models/reactor/faces/` as the value list of its `face_model` combo input, so
 * we read it straight off `/object_info`. Returns the filenames (e.g.
 * `alice.safetensors`); an empty list when ComfyUI is offline or the node is
 * missing (ReActor not installed).
 */
export async function listFaceModels(): Promise<string[]> {
  try {
    const res = await fetch('/api/comfyui/object_info/ReActorLoadFaceModel', { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    const names = data?.ReActorLoadFaceModel?.input?.required?.face_model?.[0]
    if (!Array.isArray(names)) return []
    // ReActor lists a literal "none" placeholder when the folder is empty; drop it.
    return (names as string[]).filter((n) => n && n.toLowerCase() !== 'none')
  } catch {
    return []
  }
}
