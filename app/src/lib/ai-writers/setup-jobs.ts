import path from 'node:path'
import { KREA2_TEXT_ENCODER, KREA2_TEXT_ENCODER_URL } from '@/lib/video/describe'
import { OLLAMA_TIERS } from './tiers'
import { writerErrorMessage } from './errors'
import { parseWriterId } from './writer-id'

export interface SetupStep {
  label: string
  state: 'waiting' | 'running' | 'done' | 'error'
  /** A download step's size, and how much of it has arrived. */
  gb?: number
  doneGb?: number
}

export interface SetupJob {
  kind: 'builtin' | 'ollama'
  model?: string
  status: 'running' | 'done' | 'error'
  steps: SetupStep[]
  error?: string
  /** The test write, shown when the setup is done. */
  sample?: string
  seconds?: number
  /** The writer id to select once done. */
  writer?: string
}

export type SetupRequest = { kind: 'builtin' } | { kind: 'ollama'; model: string }

type Progress = (doneGb: number, totalGb: number) => void

export interface SetupDeps {
  platform: NodeJS.Platform
  arch: string
  freeGb: (dir: string) => Promise<number | null>
  download: (spec: { url: string; dir: string; name: string; root?: string }, progress: Progress) => Promise<string>
  comfyUp: () => Promise<boolean>
  startComfy: () => Promise<void>
  ollamaInstalled: () => boolean
  installOllama: (file: string) => Promise<void>
  startOllama: () => Promise<void>
  pull: (model: string, progress: Progress) => Promise<void>
  testWrite: (writerId: string) => Promise<{ sample: string; seconds: number }>
  removeFile: (file: string) => void
  modelsDir: string
  ollamaModelsDir: string
  /** The app's data folder: installers download into its `downloads/`. */
  downloadsRoot: string
}

const OLLAMA_WIN = 'https://ollama.com/download/OllamaSetup.exe'
const ollamaLinux = (arch: string) => `https://ollama.com/download/ollama-linux-${arch === 'arm64' ? 'arm64' : 'amd64'}.tar.zst`
const OLLAMA_APP_GB = 1.6
/** Ollama's docs: "at least 4GB of space for the binary install". */
const OLLAMA_BINARIES_GB = 4
const MARGIN_GB = 2
const DOWNLOAD_STOPPED = 'The download stopped. Check the internet connection, then try again.'

const jobs: Map<string, SetupJob> =
  ((globalThis as unknown as { __raccoonWriterSetups?: Map<string, SetupJob> }).__raccoonWriterSetups ??= new Map())

export const listSetups = (): SetupJob[] => [...jobs.values()]

interface Plan { step: SetupStep; run: (progress: Progress) => Promise<void>; fail: (err: unknown) => string }

/**
 * One-click setup of the built-in writer or Ollama, as a server job: it runs on
 * when the dialog closes, and a second click joins it instead of starting again.
 */
export function startSetup(req: SetupRequest, deps: SetupDeps): SetupJob | { error: string } {
  if (req.kind === 'ollama' && !OLLAMA_TIERS.some((t) => t.model === req.model)) return { error: 'Unknown model' }
  const running = jobs.get(req.kind)
  if (running?.status === 'running') return running

  const job: SetupJob = { kind: req.kind, model: req.kind === 'ollama' ? req.model : undefined, status: 'running', steps: [] }
  jobs.set(req.kind, job)
  void run(job, req, deps)
  return job
}

async function run(job: SetupJob, req: SetupRequest, d: SetupDeps): Promise<void> {
  const step = (label: string, gb?: number): SetupStep => ({ label, state: 'waiting', ...(gb ? { gb } : {}) })
  const plans: Plan[] = []
  let need: number
  let checkDir: string
  let writer: string
  let installer: string | null = null

  if (req.kind === 'builtin') {
    need = 5 + MARGIN_GB
    checkDir = d.modelsDir
    writer = 'builtin'
    plans.push({
      step: step('Downloading Krea2’s text model', 5),
      run: (p) => d.download({ url: KREA2_TEXT_ENCODER_URL, dir: 'text_encoders', name: KREA2_TEXT_ENCODER }, p).then(() => {}),
      fail: () => DOWNLOAD_STOPPED,
    })
    if (!(await d.comfyUp())) {
      plans.push({ step: step('Starting ComfyUI'), run: () => d.startComfy(),
        fail: () => 'ComfyUI didn’t start. Start it from the top bar, then try again.' })
    }
  } else {
    const tier = OLLAMA_TIERS.find((t) => t.model === req.model)!
    const installed = d.ollamaInstalled()
    need = tier.sizeGb + MARGIN_GB + (installed ? 0 : OLLAMA_APP_GB + OLLAMA_BINARIES_GB)
    checkDir = d.ollamaModelsDir
    writer = `ollama:${req.model}`
    if (!installed) {
      const win = d.platform === 'win32'
      const url = win ? OLLAMA_WIN : ollamaLinux(d.arch)
      plans.push({
        step: step('Downloading Ollama', OLLAMA_APP_GB),
        run: async (p) => { installer = await d.download({ url, dir: 'downloads', name: path.posix.basename(url), root: d.downloadsRoot }, p) },
        fail: () => DOWNLOAD_STOPPED,
      })
      plans.push({
        step: step(win ? 'Installing Ollama (no administrator rights needed)' : 'Unpacking Ollama'),
        run: () => d.installOllama(installer!),
        fail: () => win
          ? 'Windows stopped the Ollama installer. You can install it yourself from ollama.com/download.'
          : 'Ollama couldn’t be unpacked. You can install it yourself from ollama.com/download.',
      })
    }
    plans.push({ step: step('Starting Ollama'), run: () => d.startOllama(),
      fail: (e) => (e instanceof Error ? e.message : String(e)) })
    plans.push({ step: step(`Downloading ${req.model}`, tier.sizeGb), run: (p) => d.pull(req.model, p),
      fail: () => `Ollama couldn’t download ${req.model}. Try again, or pick a smaller model.` })
  }
  plans.push({
    step: step('Writing a test description'),
    run: async () => {
      const t = await d.testWrite(writer)
      job.sample = t.sample
      job.seconds = t.seconds
    },
    fail: (e) => writerErrorMessage(e, parseWriterId(writer)!),
  })
  job.steps = plans.map((p) => p.step)

  const free = await d.freeGb(checkDir)
  if (free !== null && free < need) {
    const drive = (d.platform === 'win32' ? path.win32 : path.posix).parse(checkDir).root.replace(/[\\/]$/, '') || checkDir
    job.error = `Not enough free space: needs ${Math.ceil(need)} GB, ${drive} has ${Math.floor(free)} GB.`
    job.status = 'error'
    return
  }

  for (const p of plans) {
    p.step.state = 'running'
    try {
      await p.run((done, total) => { p.step.doneGb = Math.round(done * 10) / 10; if (total > 0) p.step.gb = Math.round(total * 10) / 10 })
      p.step.state = 'done'
    } catch (err) {
      p.step.state = 'error'
      job.error = p.fail(err)
      job.status = 'error'
      return
    }
  }
  if (installer) {
    try { d.removeFile(installer) } catch { /* a leftover installer is harmless */ }
  }
  job.writer = writer
  job.status = 'done'
}
