import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSettings, setSettings } from './settings'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-set-'))
  process.env.RACCOON_DATA_DIR = tmp
  delete process.env.OLLAMA_BASE_URL
  delete process.env.COMFYUI_BASE_URL
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.RACCOON_DATA_DIR
})

describe('settings', () => {
  it('falls back to hard defaults when no file and no env', () => {
    const s = getSettings()
    expect(s.ollamaBaseUrl).toBe('http://127.0.0.1:11434')
    expect(s.comfyuiBaseUrl).toBe('http://127.0.0.1:8188')
    expect(s.ollamaNumCtx).toBe(8192)
  })

  it('uses the env var when set and no file value', () => {
    process.env.OLLAMA_BASE_URL = 'http://ollama.local:11434'
    expect(getSettings().ollamaBaseUrl).toBe('http://ollama.local:11434')
  })

  it('file value overrides env', () => {
    process.env.OLLAMA_BASE_URL = 'http://env:11434'
    setSettings({ ollamaBaseUrl: 'http://file:11434' })
    expect(getSettings().ollamaBaseUrl).toBe('http://file:11434')
  })

  it('setSettings merges a partial patch and persists', () => {
    setSettings({ ollamaNumCtx: 4096 })
    setSettings({ comfyuiBaseUrl: 'http://127.0.0.1:9000' })
    const s = getSettings()
    expect(s.ollamaNumCtx).toBe(4096)
    expect(s.comfyuiBaseUrl).toBe('http://127.0.0.1:9000')
  })
})
