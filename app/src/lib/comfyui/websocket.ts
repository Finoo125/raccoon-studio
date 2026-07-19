import type { WSMessage } from '@/types/comfyui'

type MessageHandler = (msg: WSMessage) => void
type PreviewHandler = (blob: Blob) => void

// ComfyUI binary frame event types (protocol.py BinaryEventTypes).
const PREVIEW_IMAGE = 1
const PREVIEW_IMAGE_WITH_METADATA = 4

// Sampler latent previews are gated server-side behind this capability
// handshake (comfy_execution/progress.py): unless the client declares it as its
// FIRST websocket message, ComfyUI silently drops every preview frame. Must be
// re-sent on each (re)connect since the server resets per-socket metadata.
const FEATURE_FLAGS_HANDSHAKE = JSON.stringify({
  type: 'feature_flags',
  data: { supports_preview_metadata: true },
})

// Image file signatures, used to locate the embedded image inside a
// PREVIEW_IMAGE (event 1) frame whose sub-header length is producer-dependent.
const JPEG_SOI = [0xff, 0xd8, 0xff]
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47]

/** Offset of the first JPEG/PNG signature at or after `from`, else -1. */
function findImageStart(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 3 < bytes.length; i++) {
    if (bytes[i] === JPEG_SOI[0] && bytes[i + 1] === JPEG_SOI[1] && bytes[i + 2] === JPEG_SOI[2]) return i
    if (
      bytes[i] === PNG_SIG[0] && bytes[i + 1] === PNG_SIG[1] &&
      bytes[i + 2] === PNG_SIG[2] && bytes[i + 3] === PNG_SIG[3]
    ) return i
  }
  return -1
}

/**
 * Decode a ComfyUI binary preview frame into an image Blob.
 *
 * Wire formats (server.py encode_bytes prepends a 4-byte big-endian event type):
 *   - PREVIEW_IMAGE (1):                [event][4B type_num][image bytes]
 *   - PREVIEW_IMAGE_WITH_METADATA (4):  [event][4B meta_len][meta JSON][image]
 * v0.24.1 sends its own sampler previews as event 4. But custom previewers also
 * emit event 1 with a LONGER sub-header — notably the KJNodes LTX video preview
 * override (borrowed from VideoHelperSuite) prepends [type*2:8][frame_index:4]
 * [node_id:16p], putting the JPEG at offset 32. So for event 1 we locate the
 * actual image signature instead of assuming a fixed 8-byte header, which lets
 * both image (KSampler) and LTX video previews render. Returns null otherwise.
 */
export function parseBinaryPreview(buf: ArrayBuffer): Blob | null {
  if (buf.byteLength < 8) return null
  const view = new DataView(buf)
  const eventType = view.getUint32(0) // big-endian, matches Python ">I"

  if (eventType === PREVIEW_IMAGE) {
    // Scan past the ComfyUI-standard 8-byte header for the image start; this is
    // offset 8 for standard frames (no behavior change) and further in for the
    // longer VideoHelperSuite/LTX layout.
    const bytes = new Uint8Array(buf)
    const start = findImageStart(bytes, 8)
    if (start === -1) return new Blob([buf.slice(8)], { type: 'image/jpeg' })
    const mime = bytes[start] === PNG_SIG[0] ? 'image/png' : 'image/jpeg'
    return new Blob([buf.slice(start)], { type: mime })
  }

  if (eventType === PREVIEW_IMAGE_WITH_METADATA) {
    const metaLen = view.getUint32(4)
    if (buf.byteLength < 8 + metaLen) return null
    let mime = 'image/jpeg'
    try {
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, metaLen)))
      if (typeof meta.image_type === 'string') mime = meta.image_type
    } catch {
      // Malformed metadata — fall back to JPEG.
    }
    return new Blob([buf.slice(8 + metaLen)], { type: mime })
  }

  return null
}

export class ComfyUIWebSocket {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private previewHandlers = new Set<PreviewHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = 1000
  private closed = false

  constructor(
    private readonly clientId: string,
    private readonly wsBase: string = 'ws://127.0.0.1:8188',
  ) {}

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.ws = new WebSocket(`${this.wsBase}/ws?clientId=${this.clientId}`)
    // Receive binary preview frames as ArrayBuffer so we can read the header.
    this.ws.binaryType = 'arraybuffer'

    this.ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const blob = parseBinaryPreview(e.data)
        if (blob) this.previewHandlers.forEach((h) => h(blob))
        return
      }
      try {
        const msg = JSON.parse(e.data as string) as WSMessage
        this.handlers.forEach((h) => h(msg))
      } catch {
        // non-JSON text frame
      }
    }

    this.ws.onclose = () => {
      if (this.closed) return
      this.reconnectTimer = setTimeout(() => {
        this.backoff = Math.min(this.backoff * 2, 30000)
        this.connect()
      }, this.backoff)
    }

    this.ws.onopen = () => {
      this.backoff = 1000
      // Must be the first message so ComfyUI enables sampler preview frames.
      this.ws?.send(FEATURE_FLAGS_HANDSHAKE)
    }
  }

  on(handler: MessageHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onPreview(handler: PreviewHandler) {
    this.previewHandlers.add(handler)
    return () => this.previewHandlers.delete(handler)
  }

  disconnect() {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}
