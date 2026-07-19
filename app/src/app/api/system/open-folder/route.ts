import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { isInsideAllowedRoot } from '@/lib/system/paths'
import { log } from '@/lib/logging/logger'

/**
 * Opens the OS file manager at a folder, optionally selecting (revealing) a
 * specific file inside it. Cross-platform: Windows Explorer, macOS Finder,
 * Linux xdg-open.
 */
export async function POST(req: NextRequest) {
  let body: { path?: string; reveal?: boolean }
  try {
    body = (await req.json()) as { path?: string; reveal?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const target = body.path
  if (!target || typeof target !== 'string') {
    return NextResponse.json({ error: 'Missing "path"' }, { status: 400 })
  }

  if (!isInsideAllowedRoot(target)) {
    return NextResponse.json({ error: 'Path is not inside an allowed directory' }, { status: 403 })
  }

  if (!fs.existsSync(target)) {
    return NextResponse.json({ error: 'Path does not exist' }, { status: 404 })
  }

  const isFile = fs.statSync(target).isFile()
  const reveal = body.reveal === true && isFile
  // When not revealing a file, open the containing folder if a file was passed.
  const folder = isFile && !reveal ? path.dirname(target) : target

  let cmd: string
  let args: string[]
  switch (process.platform) {
    case 'win32':
      cmd = 'explorer.exe'
      args = reveal ? ['/select,', target] : [folder]
      break
    case 'darwin':
      cmd = 'open'
      args = reveal ? ['-R', target] : [folder]
      break
    default:
      // Linux / other: no portable "select file" — open the folder.
      cmd = 'xdg-open'
      args = [folder]
  }

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
    log('info', 'system', `Opened file manager at ${reveal ? target : folder}`)
    return NextResponse.json({ ok: true, opened: reveal ? target : folder })
  } catch (e) {
    log('error', 'system', `Failed to open file manager: ${String(e)}`)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
