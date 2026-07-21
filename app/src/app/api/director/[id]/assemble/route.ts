import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { loadRun, saveRun } from '@/lib/director/runs'
import { assertEntitled } from '@/lib/addons/guard'
import { markAssembled } from '@/lib/director/run-doc'
import { parseComfyViewUrl } from '@/lib/director/render'
import { buildAssemblyClips, type BeatClipInput } from '@/lib/director/assembly'
import { createProject, saveProject } from '@/lib/movies/projects'
import { probeMedia } from '@/lib/movies/ffprobe'
import type { MovieAsset } from '@/types/movie'

const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR ?? ''

type Ctx = { params: Promise<{ id: string }> }

/** Resolve a done beat's clip to an absolute on-disk path. */
function clipPath(videoPath: string | undefined, videoUrl: string | undefined): string | null {
  if (videoPath && fs.existsSync(videoPath)) return videoPath
  if (videoUrl && OUTPUT_DIR) {
    const ref = parseComfyViewUrl(videoUrl)
    if (ref) {
      const p = path.resolve(OUTPUT_DIR, ref.subfolder, ref.filename)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const denied = await assertEntitled('movie-maker')
  if (denied) return denied
  const { id } = await params
  const run = loadRun(id)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const doneBeats = run.beats.filter((b) => b.status === 'done')
  if (doneBeats.length === 0) {
    return NextResponse.json({ error: 'No rendered clips to assemble' }, { status: 400 })
  }

  // Probe each clip and build the asset list + clip inputs (in beat order).
  const assets: MovieAsset[] = []
  const clipInputs: BeatClipInput[] = []
  for (const beat of doneBeats) {
    const p = clipPath(beat.videoPath, beat.videoUrl)
    if (!p) {
      return NextResponse.json(
        { error: `Beat ${beat.index + 1} clip is missing on disk` },
        { status: 422 },
      )
    }
    let probe
    try {
      probe = await probeMedia(p)
    } catch (e) {
      return NextResponse.json({ error: `ffprobe failed on beat ${beat.index + 1}: ${String(e)}` }, { status: 500 })
    }
    const assetId = randomUUID()
    assets.push({
      id: assetId,
      kind: 'video',
      source: 'gallery',
      path: p,
      filename: path.basename(p),
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    })
    clipInputs.push({ assetId, durationSec: probe.durationSec })
  }

  // Create the project, drop the clips end-to-end on the first video track (V1).
  const project = createProject(run.name)
  project.assets = assets
  project.tracks[0].clips = buildAssemblyClips(clipInputs)
  saveProject(project)

  const saved = saveRun(markAssembled(run, project.id))
  return NextResponse.json({ movieProjectId: project.id, run: saved })
}
