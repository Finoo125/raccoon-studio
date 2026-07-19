import { describe, it, expect } from 'vitest'
import { parseBinaryPreview } from './websocket'

// Builds a ComfyUI binary frame: 4-byte big-endian event type, then payload.
function frame(eventType: number, payload: Uint8Array): ArrayBuffer {
  const buf = new Uint8Array(4 + payload.length)
  new DataView(buf.buffer).setUint32(0, eventType) // big-endian
  buf.set(payload, 4)
  return buf.buffer
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03])

describe('parseBinaryPreview', () => {
  it('decodes the legacy PREVIEW_IMAGE (event 1) format: [event][type_num][jpeg]', async () => {
    const payload = new Uint8Array(4 + JPEG.length)
    new DataView(payload.buffer).setUint32(0, 1) // type_num = JPEG
    payload.set(JPEG, 4)

    const blob = parseBinaryPreview(frame(1, payload))
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/jpeg')
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(JPEG)
  })

  it('decodes PREVIEW_IMAGE_WITH_METADATA (event 4): [event][meta_len][json][image]', async () => {
    const meta = new TextEncoder().encode(JSON.stringify({ image_type: 'image/jpeg', node_id: '19' }))
    const payload = new Uint8Array(4 + meta.length + JPEG.length)
    const dv = new DataView(payload.buffer)
    dv.setUint32(0, meta.length) // big-endian metadata length
    payload.set(meta, 4)
    payload.set(JPEG, 4 + meta.length)

    const blob = parseBinaryPreview(frame(4, payload))
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/jpeg')
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(JPEG)
  })

  it('honors the mime type declared in the metadata (PNG)', async () => {
    const meta = new TextEncoder().encode(JSON.stringify({ image_type: 'image/png' }))
    const payload = new Uint8Array(4 + meta.length + JPEG.length)
    new DataView(payload.buffer).setUint32(0, meta.length)
    payload.set(meta, 4)
    payload.set(JPEG, 4 + meta.length)

    const blob = parseBinaryPreview(frame(4, payload))
    expect(blob!.type).toBe('image/png')
  })

  it('decodes the KJNodes/VHS LTX video previewer frame (event 1, longer sub-header)', async () => {
    // The LTX preview override (comfyui-kjnodes, borrowed from VideoHelperSuite)
    // sends event 1 but prepends [type*2:8][frame_index:4][node_id:16p] before the
    // JPEG, so the image starts at frame offset 32 — not the ComfyUI-standard 8.
    const head = new Uint8Array(8 + 4 + 16)
    const dv = new DataView(head.buffer)
    dv.setUint32(0, 1) // (1).to_bytes(4,'big') * 2 — first half
    dv.setUint32(4, 1) // second half
    dv.setUint32(8, 0) // frame index (ind)
    const id = new TextEncoder().encode('19')
    head[12] = id.length // struct.pack('16p', ...) length byte
    head.set(id, 13) // ascii node id, zero-padded to 16
    const payload = new Uint8Array(head.length + JPEG.length)
    payload.set(head, 0)
    payload.set(JPEG, head.length)

    const blob = parseBinaryPreview(frame(1, payload))
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/jpeg')
    // Must extract ONLY the JPEG, with no leading sub-header bytes.
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(JPEG)
  })

  it('returns null for unknown event types', () => {
    expect(parseBinaryPreview(frame(3, JPEG))).toBeNull()
  })

  it('returns null for frames too short to hold a header', () => {
    expect(parseBinaryPreview(new Uint8Array([0, 0]).buffer)).toBeNull()
  })
})
