import type { ComfyUIPrompt, PromptResponse, QueueStatus, HistoryEntry, OutputImage } from '@/types/comfyui'

const BASE = process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`ComfyUI ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ComfyUI ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getSystemStats() {
  return get<Record<string, unknown>>('/system_stats')
}

export async function queuePrompt(prompt: ComfyUIPrompt, clientId: string): Promise<PromptResponse> {
  return post<PromptResponse>('/prompt', { prompt, client_id: clientId })
}

export async function getQueue(): Promise<QueueStatus> {
  return get<QueueStatus>('/queue')
}

export async function clearQueue() {
  return post('/queue', { clear: true })
}

export async function cancelPrompt(promptId: string) {
  return post('/queue', { delete: [promptId] })
}

export async function getHistory(promptId?: string): Promise<Record<string, HistoryEntry>> {
  const path = promptId ? `/history/${promptId}` : '/history'
  return get(path)
}

export function imageViewUrl(image: OutputImage): string {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  })
  return `${BASE}/view?${params}`
}

export async function getObjectInfo(): Promise<Record<string, unknown>> {
  return get('/object_info')
}

export async function uploadImage(file: File): Promise<{ name: string; subfolder: string; type: string }> {
  const form = new FormData()
  form.append('image', file)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const res = await fetch(`${BASE}/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json()
}
