import { spawn } from 'child_process'

/**
 * Native OS file dialogs for choosing where to save a backup and which backup to
 * restore. Runs on the local machine (same as the models pickers) so we can open
 * a real OS dialog and hand back a path — no multi-GB browser upload/download.
 */

interface DialogResult {
  path: string | null // null = user cancelled
}

/** Resolve to the chosen path, null on cancel, or reject if the command is
 *  missing / fails to launch (so the caller can try the next dialog). */
function runDialog(cmd: string, args: string[]): Promise<DialogResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0 && out.trim()) resolve({ path: out.trim() })
      else resolve({ path: null })
    })
  })
}

/** Default `raccoon-backup-YYYYMMDD-HHMMSS.tar`. */
export function defaultBackupName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `raccoon-backup-${stamp}.tar`
}

function encodeWinScript(script: string): [string, string[]] {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return ['powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded]]
}

function winSaveAttempt(defaultName: string): [string, string[]] {
  const script = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.Windows.Forms | Out-Null`,
    `$owner = New-Object System.Windows.Forms.Form`,
    `$owner.TopMost = $true`,
    `$dlg = New-Object System.Windows.Forms.SaveFileDialog`,
    `$dlg.Title = 'Save Raccoon Studio backup'`,
    `$dlg.Filter = 'Tar archive (*.tar)|*.tar|All files (*.*)|*.*'`,
    `$dlg.FileName = '${defaultName}'`,
    `$dlg.DefaultExt = 'tar'`,
    `$dlg.AddExtension = $true`,
    `if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.FileName) }`,
    `$owner.Dispose()`,
  ].join('\n')
  return encodeWinScript(script)
}

function winOpenAttempt(): [string, string[]] {
  const script = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.Windows.Forms | Out-Null`,
    `$owner = New-Object System.Windows.Forms.Form`,
    `$owner.TopMost = $true`,
    `$dlg = New-Object System.Windows.Forms.OpenFileDialog`,
    `$dlg.Title = 'Select a Raccoon Studio backup (.tar)'`,
    `$dlg.Filter = 'Tar archive (*.tar)|*.tar|All files (*.*)|*.*'`,
    `if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.FileName) }`,
    `$owner.Dispose()`,
  ].join('\n')
  return encodeWinScript(script)
}

/** Open a "save as" dialog for the backup archive. */
export async function pickSaveTar(): Promise<string | null> {
  const defaultName = defaultBackupName()
  let attempts: Array<[string, string[]]>
  if (process.platform === 'win32') {
    attempts = [winSaveAttempt(defaultName)]
  } else if (process.platform === 'darwin') {
    attempts = [['osascript', ['-e', `POSIX path of (choose file name with prompt "Save Raccoon Studio backup" default name "${defaultName}")`]]]
  } else {
    attempts = [
      ['zenity', ['--file-selection', '--save', '--confirm-overwrite', '--title=Save Raccoon Studio backup', `--filename=${defaultName}`]],
      ['kdialog', ['--getsavefilename', defaultName, 'Tar archive (*.tar)']],
    ]
  }
  return firstDialog(attempts)
}

/** Open a "select file" dialog filtered to `.tar` backups. */
export async function pickOpenTar(): Promise<string | null> {
  let attempts: Array<[string, string[]]>
  if (process.platform === 'win32') {
    attempts = [winOpenAttempt()]
  } else if (process.platform === 'darwin') {
    attempts = [['osascript', ['-e', 'POSIX path of (choose file with prompt "Select a Raccoon Studio backup")']]]
  } else {
    attempts = [
      ['zenity', ['--file-selection', '--title=Select a Raccoon Studio backup', '--file-filter=Tar archive | *.tar', '--file-filter=All files | *']],
      ['kdialog', ['--getopenfilename', process.env.HOME ?? '.', 'Tar archive (*.tar)']],
    ]
  }
  return firstDialog(attempts)
}

async function firstDialog(attempts: Array<[string, string[]]>): Promise<string | null> {
  for (const [cmd, args] of attempts) {
    try {
      const { path } = await runDialog(cmd, args)
      return path
    } catch {
      // Command not available — try the next.
    }
  }
  throw new Error(
    process.platform === 'linux'
      ? 'No native file dialog found. Install zenity or kdialog.'
      : 'Could not open the file dialog.',
  )
}
