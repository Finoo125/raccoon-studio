import { describe, expect, it } from 'vitest'
import { refusal } from './request-guard'

const req = (over: Partial<Parameters<typeof refusal>[0]> = {}) =>
  ({ method: 'GET', host: 'localhost:3000', origin: null, site: null, ...over })

describe('refusal — Host (DNS rebinding)', () => {
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.5:3000', 'abc123-8080.proxy.runpod.net', null])(
    'serves %s', (host) => {
      expect(refusal(req({ host }))).toBeNull()
    })
  it.each(['rebind.evil.example', 'localhost.evil.example:3000', 'evilproxy.runpod.net', 'x.proxy.runpod.net.evil.com'])(
    'refuses %s', (host) => {
      expect(refusal(req({ host }))).toMatch(/not allowed/)
    })
  it('serves a name the owner allowed', () => {
    expect(refusal(req({ host: 'studio.lan:3000' }), ['studio.lan'])).toBeNull()
  })
})

describe('refusal — other web pages', () => {
  it.each(['cross-site', 'same-site'])('refuses any request a %s page makes', (site) => {
    expect(refusal(req({ site }))).toMatch(/refused/)
    expect(refusal(req({ site, method: 'POST' }))).toMatch(/refused/)
  })
  it('lets Civitai (or the sign-in relay) send the browser back to the sign-in callback', () => {
    // a top-level redirect from civitai.com / raccoon-unlock is cross-site by definition
    expect(refusal(req({ site: 'cross-site', path: '/api/civitai/auth/callback' }))).toBeNull()
    // only that path, only a GET, and still only on an allowed Host
    expect(refusal(req({ site: 'cross-site', path: '/api/civitai/auth/start' }))).toMatch(/refused/)
    expect(refusal(req({ site: 'cross-site', method: 'POST', path: '/api/civitai/auth/callback' }))).toMatch(/refused/)
    expect(refusal(req({ site: 'cross-site', path: '/api/civitai/auth/callback', host: 'rebind.evil.example' }))).toMatch(/not allowed/)
  })
  it.each(['same-origin', 'none', null])('serves Sec-Fetch-Site %s', (site) => {
    expect(refusal(req({ site }))).toBeNull()
  })
  it('refuses a write from another origin even without Sec-Fetch-Site (older browsers)', () => {
    expect(refusal(req({ method: 'POST', origin: 'https://evil.example' }))).toMatch(/refused/)
    expect(refusal(req({ method: 'DELETE', origin: 'null' }))).toMatch(/refused/)
    expect(refusal(req({ method: 'PUT', origin: 'http://localhost:8188' }))).toMatch(/refused/)
  })
  it('serves its own pages and callers without an Origin (curl, the server itself)', () => {
    expect(refusal(req({ method: 'POST', origin: 'http://localhost:3000' }))).toBeNull()
    expect(refusal(req({ method: 'POST', host: 'abc-8080.proxy.runpod.net', origin: 'https://abc-8080.proxy.runpod.net' }))).toBeNull()
    expect(refusal(req({ method: 'POST' }))).toBeNull()
  })
})
