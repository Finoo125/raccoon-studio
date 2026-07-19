export interface ComfyUIPromptNode {
  class_type: string
  inputs: Record<string, unknown>
}

export type ComfyUIPrompt = Record<string, ComfyUIPromptNode>

export interface PromptResponse {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface QueueStatus {
  queue_running: [number, string, ComfyUIPrompt, Record<string, unknown>][]
  queue_pending: [number, string, ComfyUIPrompt, Record<string, unknown>][]
}

export interface OutputImage {
  filename: string
  subfolder: string
  type: string
}

export interface HistoryEntry {
  outputs: Record<string, { images?: OutputImage[] }>
  status: { completed: boolean; status_str: string }
}

export type WSMessageType =
  | 'status'
  | 'execution_start'
  | 'executing'
  | 'progress'
  | 'executed'
  | 'execution_error'
  | 'execution_cached'

export interface WSMessage {
  type: WSMessageType
  data: {
    prompt_id?: string
    node?: string | null
    value?: number
    max?: number
    output?: { images?: OutputImage[]; gifs?: OutputImage[] }
    exception_message?: string
    status?: { exec_info: { queue_remaining: number } }
  }
}
