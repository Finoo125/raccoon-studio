import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

process.env.COMFYUI_PID_FILE ??= path.join(os.tmpdir(), `raccoon-test-comfyui-${process.pid}.pid`)
process.env.RACCOON_LOGS_DIR ??= path.join(os.tmpdir(), `raccoon-test-logs-${process.pid}`)
const { gitRepos } = await import('./update-check')

const root = path.join(os.tmpdir(), `raccoon-test-updcheck-${process.pid}`)

beforeAll(() => {
  // Fake ComfyUI install: core repo + one git custom node + one non-git node.
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.mkdirSync(path.join(root, 'custom_nodes', 'ComfyUI-Manager', '.git'), { recursive: true })
  fs.mkdirSync(path.join(root, 'custom_nodes', 'plain-node'), { recursive: true })
  fs.writeFileSync(path.join(root, 'custom_nodes', 'websocket_image_save.py'), '', 'utf8')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('gitRepos', () => {
  it('finds the core repo and git-cloned custom nodes only', () => {
    expect(gitRepos(root)).toEqual([root, path.join(root, 'custom_nodes', 'ComfyUI-Manager')])
  })

  it('handles a dir without .git or custom_nodes', () => {
    const empty = path.join(root, 'custom_nodes', 'plain-node')
    expect(gitRepos(empty)).toEqual([])
  })
})
