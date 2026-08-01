import { describe, it, expect } from 'vitest'
import { describeDownloadError } from './download-error'

const HF = 'https://huggingface.co/circlestone-labs/Anima/resolve/main/anima-turbo-v1.0.safetensors'
const netErr = (code: string, address?: string) =>
  Object.assign(new Error(`connect ${code} ${address ?? '1.2.3.4'}:443`), { code, address })

describe('describeDownloadError', () => {
  it('names the host a bare ETIMEDOUT hides', () => {
    // The real report: "Download failed: connect ETIMEDOUT 75.126.135.131:443",
    // which never said the host was HuggingFace.
    const out = describeDownloadError(netErr('ETIMEDOUT', '75.126.135.131'), HF)
    expect(out).toContain('huggingface.co')
    expect(out).toContain('75.126.135.131')
    expect(out).toContain('ETIMEDOUT')
  })

  it('names the CDN when the redirect hop is the one blocked', () => {
    // Bytes come from the Xet CDN, not huggingface.co — a network can block one
    // and not the other, so the failing hop is what gets reported.
    const out = describeDownloadError(netErr('ECONNREFUSED'), 'https://us.aws.cdn.hf.co/xet-bridge-us/abc')
    expect(out).toContain('us.aws.cdn.hf.co')
    expect(out).not.toContain('huggingface.co')
  })

  it('passes non-connection failures through untouched', () => {
    // An HTTP status or a disk error is not a reachability problem, and dressing
    // it up as one would send the next reader hunting a firewall that is fine.
    expect(describeDownloadError(new Error('HTTP 404'), HF)).toBe('HTTP 404')
    expect(describeDownloadError(Object.assign(new Error('no space'), { code: 'ENOSPC' }), HF)).toBe('no space')
  })

  it('survives a malformed url rather than throwing inside the error path', () => {
    expect(describeDownloadError(netErr('ETIMEDOUT'), 'not a url')).toContain('the download host')
  })

  it('handles a non-Error rejection', () => {
    expect(describeDownloadError('boom', HF)).toBe('boom')
  })
})
