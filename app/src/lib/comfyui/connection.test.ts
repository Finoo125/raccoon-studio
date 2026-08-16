import { describe, it, expect } from 'vitest'
import { resolveWsBase } from './connection'

const loc = (url: string) => {
  const u = new URL(url)
  return { protocol: u.protocol, hostname: u.hostname, host: u.host }
}

describe('resolveWsBase', () => {
  it('trusts the detected URL when the browser is on the same machine', () => {
    expect(resolveWsBase('http://127.0.0.1:8188', loc('http://localhost:3000')))
      .toBe('ws://127.0.0.1:8188/ws')
    expect(resolveWsBase('http://127.0.0.1:8188', loc('http://127.0.0.1:3000')))
      .toBe('ws://127.0.0.1:8188/ws')
  })

  // The detected URL is the SERVER's view, so off-box it points the browser at
  // its own loopback — the bug that kills previews, progress and the meters for
  // every non-local viewer while HTTP keeps working through the Next proxy.
  it('goes same-origin for any other host, ignoring the detected URL', () => {
    expect(resolveWsBase('http://127.0.0.1:8188', loc('http://192.168.1.40:3000')))
      .toBe('ws://192.168.1.40:3000/comfy-ws')
    expect(resolveWsBase('http://127.0.0.1:8188', loc('https://abc123-8080.proxy.runpod.net/')))
      .toBe('wss://abc123-8080.proxy.runpod.net/comfy-ws')
  })

  it('keeps the scheme in step with the page, so https never opens a plain ws', () => {
    expect(resolveWsBase('http://127.0.0.1:8188', loc('https://studio.example.com/')))
      .toMatch(/^wss:/)
  })

  it('survives a server-side call with no location at all', () => {
    expect(resolveWsBase('http://127.0.0.1:8188')).toBe('ws://127.0.0.1:8188/ws')
  })

  it('does not double the slash when the detected URL has a trailing one', () => {
    expect(resolveWsBase('http://127.0.0.1:8188/', loc('http://localhost:3000')))
      .toBe('ws://127.0.0.1:8188/ws')
  })
})
