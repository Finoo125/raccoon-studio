import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pythonPackages } from './python-packages'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-venv-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function seed(rel: string, names: string[]) {
  const dir = path.join(tmp, '.venv', ...rel.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  for (const n of names) fs.mkdirSync(path.join(dir, n))
}

describe('pythonPackages', () => {
  it('reads a POSIX venv and renders name==version', () => {
    seed('lib/python3.12/site-packages', ['transformers-5.12.1.dist-info', 'torch-2.11.0.dist-info', 'notapkg'])
    expect(pythonPackages(tmp)).toEqual(['torch==2.11.0', 'transformers==5.12.1'])
  })

  it('reads a Windows venv', () => {
    seed('Lib/site-packages', ['transformers-5.12.1.dist-info'])
    expect(pythonPackages(tmp)).toEqual(['transformers==5.12.1'])
  })

  // Package names contain dashes, so splitting on the FIRST one truncates them.
  it('splits on the last dash, not the first', () => {
    seed('Lib/site-packages', ['comfyui-frontend-package-1.47.11.dist-info'])
    expect(pythonPackages(tmp)).toEqual(['comfyui-frontend-package==1.47.11'])
  })

  it('returns empty rather than throwing when there is no venv', () => {
    expect(pythonPackages(tmp)).toEqual([])
    expect(pythonPackages(null)).toEqual([])
  })
})
