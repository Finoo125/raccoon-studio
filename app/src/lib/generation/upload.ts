/**
 * Uploads an image to ComfyUI's input directory via the existing proxy and
 * returns the stored filename (prefixed with its subfolder, if any) for a
 * `LoadImage`/`LoadImageMask` node to reference. Shared by the base-image and
 * mask flows; mirrors the form-data shape FaceSwapInput uses.
 */
export async function uploadImageBlob(blob: Blob, filename: string): Promise<string> {
  const form = new FormData()
  form.append('image', new File([blob], filename, { type: blob.type || 'image/png' }))
  form.append('overwrite', 'true')
  form.append('type', 'input')
  const res = await fetch('/api/comfyui/upload/image', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as { name: string; subfolder?: string }
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}

/**
 * Fetches a same-origin image URL (a gallery route or a finished-result view URL)
 * and re-uploads its bytes into ComfyUI's input dir so it can be used as an
 * img2img/inpaint/outpaint base. Returns the stored filename.
 */
export async function uploadImageFromUrl(url: string, filename = 'base.png'): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load source image (${res.status})`)
  return uploadImageBlob(await res.blob(), filename)
}

/**
 * The view URL for a file already sitting in ComfyUI's input dir — the inverse
 * of what `uploadImageBlob` returns, subfolder prefix and all.
 *
 * Needed wherever a slot holds a filename this browser never uploaded itself (a
 * prefill from another tab, a form restored from storage): the uploader keeps an
 * object URL for its own upload, but has nothing to show for a name handed to it.
 */
export function inputViewUrl(name: string): string {
  const slash = name.lastIndexOf('/')
  const subfolder = slash >= 0 ? name.slice(0, slash) : ''
  const filename = slash >= 0 ? name.slice(slash + 1) : name
  return `/api/comfyui/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=input`
}
