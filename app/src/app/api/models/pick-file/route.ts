import { NextResponse } from 'next/server'
import { spawn } from 'child_process'

// Runs on the local machine (same as copy-local), so we can open a native OS
// file dialog and return the chosen path — no browser upload, works for huge
// model files. Node runtime is required for child_process.
export const runtime = 'nodejs'

interface DialogResult {
  path: string | null // null = user cancelled
}

// Resolves to the selected path, null on cancel, or rejects if the command is
// missing / fails to launch (so the caller can try the next dialog).
function runDialog(cmd: string, args: string[]): Promise<DialogResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', reject) // e.g. ENOENT when the binary is not installed
    proc.on('close', (code) => {
      // Dialogs print the chosen path on stdout and exit 0; cancel exits non-zero
      // (zenity/kdialog/osascript) or prints nothing (Windows dialog), so an empty
      // stdout is treated as a cancel either way.
      if (code === 0 && out.trim()) resolve({ path: out.trim() })
      else resolve({ path: null })
    })
  })
}

const MODEL_EXTS = ['safetensors', 'ckpt', 'pt', 'bin', 'gguf', 'pth']

// Windows: drive a native OpenFileDialog through PowerShell. Passed as an
// -EncodedCommand (base64 UTF-16LE) to dodge all quoting issues, run -STA so the
// WinForms dialog has a message pump, and owned by a TopMost form so it surfaces
// in front of the browser instead of opening behind it.
function windowsPowerShellAttempt(): [string, string[]] {
  const filter =
    `Model files (${MODEL_EXTS.map((e) => `*.${e}`).join(';')})|${MODEL_EXTS.map((e) => `*.${e}`).join(';')}|All files (*.*)|*.*`
  const script = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.Windows.Forms | Out-Null`,
    `$owner = New-Object System.Windows.Forms.Form`,
    `$owner.TopMost = $true`,
    `$dlg = New-Object System.Windows.Forms.OpenFileDialog`,
    `$dlg.Title = 'Select a model file'`,
    `$dlg.Filter = '${filter}'`,
    `if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.FileName) }`,
    `$owner.Dispose()`,
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return ['powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded]]
}

export async function POST() {
  // Per-platform native dialogs. Each entry is tried in order; a missing binary
  // (ENOENT) rejects runDialog and falls through to the next.
  let attempts: Array<[string, string[]]>
  if (process.platform === 'win32') {
    attempts = [windowsPowerShellAttempt()]
  } else if (process.platform === 'darwin') {
    // osascript prints the POSIX path on OK and errors (non-zero) on cancel.
    attempts = [[
      'osascript',
      ['-e', 'POSIX path of (choose file with prompt "Select a model file")'],
    ]]
  } else {
    // Linux: zenity (GNOME) first, then kdialog (KDE).
    attempts = [
      ['zenity', [
        '--file-selection',
        '--title=Select a model file',
        `--file-filter=Model files | ${MODEL_EXTS.map((e) => `*.${e}`).join(' ')}`,
        '--file-filter=All files | *',
      ]],
      ['kdialog', [
        '--getopenfilename',
        process.env.HOME ?? '.',
        `Model files (${MODEL_EXTS.map((e) => `*.${e}`).join(' ')})`,
      ]],
    ]
  }

  for (const [cmd, args] of attempts) {
    try {
      const { path } = await runDialog(cmd, args)
      return NextResponse.json({ path })
    } catch {
      // Command not available — try the next one.
    }
  }

  const hint =
    process.platform === 'win32'
      ? 'Could not open the Windows file dialog. Use "Import from path" instead.'
      : process.platform === 'darwin'
        ? 'Could not open the macOS file dialog. Use "Import from path" instead.'
        : 'No native file dialog found. Install zenity or kdialog, or use "Import from path".'
  return NextResponse.json({ error: hint }, { status: 500 })
}
