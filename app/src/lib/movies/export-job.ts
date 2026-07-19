import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { MovieProject } from '@/types/movie'
import { buildExportArgs, type ExportSettings } from './export-graph'
import { ffmpegBin, friendlyFfmpegError } from './ffmpeg-bin'

export interface ExportJob {
  projectId: string
  status: 'running' | 'done' | 'error'
  progress: number
  outputPath: string
  error?: string
  startedAt: string
}

// Survives Next dev hot-reloads
const jobs: Map<string, ExportJob> =
  ((globalThis as unknown as { __movieExportJobs?: Map<string, ExportJob> }).__movieExportJobs ??= new Map())

export function getExportJob(projectId: string): ExportJob | null {
  return jobs.get(projectId) ?? null
}

export function startExport(
  project: MovieProject,
  settings: ExportSettings & { filename: string },
): ExportJob {
  const existing = jobs.get(project.id)
  if (existing?.status === 'running') return existing

  const outputDir = path.join(process.env.COMFYUI_OUTPUT_DIR ?? process.cwd(), 'movies')
  fs.mkdirSync(outputDir, { recursive: true })
  const base = settings.filename.replace(/[^\w.\-()\s]/g, '_') || 'movie'
  const outputPath = path.join(outputDir, base.endsWith('.mp4') ? base : `${base}.mp4`)

  const { args, durationSec } = buildExportArgs(project, settings, outputPath)
  const job: ExportJob = {
    projectId: project.id,
    status: 'running',
    progress: 0,
    outputPath,
    startedAt: new Date().toISOString(),
  }
  jobs.set(project.id, job)

  const bin = ffmpegBin()
  const proc = spawn(bin, ['-nostats', '-progress', 'pipe:1', ...args])
  let stderrTail = ''
  proc.stderr.on('data', (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000)
  })
  proc.stdout.on('data', (d: Buffer) => {
    for (const m of d.toString().matchAll(/out_time_us=(\d+)/g)) {
      job.progress = Math.min(1, Number(m[1]) / 1e6 / durationSec)
    }
  })
  proc.on('error', (err) => {
    job.status = 'error'
    job.error = friendlyFfmpegError(err, bin)
  })
  proc.on('close', (code) => {
    if (job.status === 'error') return
    if (code === 0) {
      job.status = 'done'
      job.progress = 1
    } else {
      job.status = 'error'
      job.error = stderrTail.split('\n').slice(-15).join('\n')
    }
  })
  return job
}
