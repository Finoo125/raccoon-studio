import { comboOptions } from '@/lib/models/installed'

/**
 * Lists the saved ReActor face models available on the ComfyUI server.
 *
 * ReActor's `ReActorLoadFaceModel` node exposes the contents of
 * `models/reactor/faces/` as the value list of its `face_model` combo input, so
 * we read it straight off `/object_info`. Returns the filenames (e.g.
 * `alice.safetensors`).
 *
 * `null` means ComfyUI could not be asked — offline, or the node is missing
 * because ReActor isn't installed. That is deliberately *not* the same as `[]`
 * (asked, and this install has saved no faces): only the latter proves that a
 * remembered `faceModel` is gone, and the caller has to tell them apart before
 * clearing one.
 */
export async function listFaceModels(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/comfyui/object_info/ReActorLoadFaceModel', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.ReActorLoadFaceModel) return null
    // ReActor lists a literal "none" placeholder when the folder is empty; drop it.
    return comboOptions(data, 'ReActorLoadFaceModel', 'face_model').filter(
      (n) => n && n.toLowerCase() !== 'none',
    )
  } catch {
    return null
  }
}
