/**
 * Shared plumbing for the live (LIVE_RENDER=1) harnesses that talk to a running
 * ComfyUI. Not a test file — vitest never collects it — and nothing in the app
 * imports it. The older live tests each inline the same helpers; these are the
 * Qwen-Image 2.1 ones' copy, in one place.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ComfyUIPrompt } from '@/types/comfyui'

/** `.env.local` is what the app reads; vitest does not load it. */
export function readEnvLocal(): Record<string, string> {
  const file = path.resolve(__dirname, '../../../.env.local')
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^﻿?([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

export function liveEnv() {
  const env = { ...readEnvLocal(), ...process.env } as Record<string, string>
  const repoRoot = path.resolve(__dirname, '../../../..')
  return {
    // localhost, not 127.0.0.1 — see the live-smoke notes in memory.
    base: (env.COMFYUI_BASE_URL || 'http://localhost:8188').replace(/\/$/, ''),
    outputDir: env.COMFYUI_OUTPUT_DIR ?? path.join(repoRoot, 'comfyui/ComfyUI/output'),
    inputDir: env.COMFYUI_INPUT_DIR || path.join(repoRoot, 'comfyui/ComfyUI/input'),
    modelsDir: env.COMFYUI_MODELS_DIR ?? path.join(repoRoot, 'comfyui/ComfyUI/models'),
    repoRoot,
  }
}

/** A fresh seed per run, logged by the caller — a fixed one lets the cache fake a pass. */
export const freshSeed = (): number => Number(process.env.LIVE_SEED ?? Date.now() % 9_000_000_000)

/** Film grain is unseeded noise; dropping it makes two graphs comparable. */
export function stripGrain(wf: ComfyUIPrompt, saveId: string): ComfyUIPrompt {
  if (wf['grain:film']) {
    wf[saveId].inputs.images = wf['grain:film'].inputs.image
    delete wf['grain:film']
  }
  return wf
}

type HistoryEntry = {
  status?: { completed?: boolean; status_str?: string; messages?: [string, { timestamp?: number }][] }
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type?: string }[]; text?: string[] }>
}

/**
 * POST a graph, poll /history until it settles, return the saved image paths,
 * any PreviewAny text, and ComfyUI's own execution time (start→success
 * timestamps) — falls back to wall time when the messages are missing.
 */
export async function renderGraph(base: string, wf: ComfyUIPrompt, label: string, outputDir: string, timeoutMs = 20 * 60_000) {
  const res = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'raccoon-qwen21-live' }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`[${label}] POST /prompt rejected the graph: ${body}`)
  const { prompt_id, node_errors } = JSON.parse(body) as { prompt_id: string; node_errors?: Record<string, unknown> }
  if (node_errors && Object.keys(node_errors).length) {
    throw new Error(`[${label}] node errors: ${JSON.stringify(node_errors)}`)
  }
  const started = Date.now()
  let entry: HistoryEntry | undefined
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000))
    const hist = (await fetch(`${base}/history/${prompt_id}`).then((r) => r.json()).catch(() => ({}))) as Record<string, HistoryEntry>
    entry = hist[prompt_id]
    if (entry?.status?.completed || entry?.status?.status_str === 'error') break
  }
  if (!entry?.status?.completed) {
    throw new Error(`[${label}] did not complete: ${JSON.stringify(entry?.status ?? 'timeout')}`)
  }
  const msgs = entry.status.messages ?? []
  const t0 = msgs.find(([m]) => m === 'execution_start')?.[1]?.timestamp
  const t1 = msgs.find(([m]) => m === 'execution_success')?.[1]?.timestamp
  const seconds = t0 && t1 ? (t1 - t0) / 1000 : (Date.now() - started) / 1000
  const files: string[] = []
  const texts: string[] = []
  for (const out of Object.values(entry.outputs ?? {})) {
    for (const img of out.images ?? []) {
      if (img.type && img.type !== 'output') continue
      files.push(path.join(outputDir, img.subfolder ?? '', img.filename))
    }
    texts.push(...(out.text ?? []))
  }
  return { files, seconds, texts }
}

/** Decode to raw RGB at a fixed width via ffmpeg — no image library needed. Pass a
 *  height to force one grid on two images of slightly different aspect. */
export function rgb(file: string, width = 256, height = -2): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  }) as unknown as Buffer
}

/** Mean luma, 0-255. ~2.5 on the black frames Z-Image and Krea2 produced; 120-170 healthy. */
export function meanLuma(px: Buffer): number {
  let s = 0
  for (let i = 0; i + 2 < px.length; i += 3) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  return s / (px.length / 3)
}

/** Mean RGB channel spread — the DynamicVRAM-corruption metric: clean < 60, corrupted 90-113. */
export function channelSpread(px: Buffer): number {
  let s = 0
  for (let i = 0; i + 2 < px.length; i += 3) {
    s += Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2])
  }
  return s / (px.length / 3)
}

/**
 * Large-scale structure: std-dev of a 16-wide grey thumbnail. A photo has some
 * (26–47 on the Qwen bodybuilder set); the uniform grey texture of a Qwen 2.1
 * render whose sampler never denoised has almost none (0–16) — and it passed
 * both metrics above, normal luma and low spread. Use with them, not instead.
 */
export function structure(file: string): number {
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=16:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 1 << 20,
  }) as unknown as Buffer
  const m = g.reduce((a, b) => a + b, 0) / g.length
  return Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / g.length)
}

/** p99 of |Laplacian| on a 512-wide grayscale copy: fine-detail energy, robust to a few edges. */
export function laplacianP99(file: string): number {
  const W = 512
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:-2`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  }) as unknown as Buffer
  const H = g.length / W
  const vals: number[] = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      vals.push(Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]))
    }
  }
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length * 0.99)]
}

/** One frame of a clip as a PNG. */
export function frameAt(video: string, seconds: number, out: string): string {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', out])
  return out
}

/**
 * ArcFace cosine of each image's largest face against the reference's, with
 * ComfyUI's venv and the vendored RaccoonSwapNodes analyzer (the scorer the
 * face-swap A/Bs use). Same person ≈ 0.8, a stranger ≈ 0; null = no face.
 */
export function arcface(reference: string, images: string[]): (number | null)[] {
  const { repoRoot, modelsDir } = liveEnv()
  const script = path.join(os.tmpdir(), 'raccoon-arcface.py')
  fs.writeFileSync(script, [
    'import json, sys, os',
    "sys.path.insert(0, os.environ['PACK_DIR'])",
    'import cv2, numpy as np',
    'import analyzer',
    "A = analyzer.Analyzer(os.path.join(os.environ['MODELS_DIR'], 'insightface', 'models', 'buffalo_l'))",
    'def emb(p):',
    '    img = cv2.imdecode(np.fromfile(p, np.uint8), cv2.IMREAD_COLOR)',
    '    faces = A.get(img)',
    '    return max(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1])).normed_embedding if faces else None',
    'ref = emb(sys.argv[1])',
    'out = []',
    'for p in sys.argv[2:]:',
    '    e = emb(p)',
    '    out.append(None if e is None or ref is None else float(np.dot(ref, e)))',
    'print(json.dumps(out))',
  ].join('\n'))
  const py = path.join(repoRoot, 'comfyui/ComfyUI/.venv/Scripts/python.exe')
  const stdout = execFileSync(py, [script, reference, ...images], {
    env: { ...process.env, PACK_DIR: path.join(repoRoot, 'comfyui/ComfyUI/custom_nodes/RaccoonSwapNodes'), MODELS_DIR: modelsDir },
    maxBuffer: 1 << 20,
  }).toString()
  return JSON.parse(stdout.trim().split('\n').pop()!)
}

/**
 * SeedVR2 video upscale nodes (numz/ComfyUI-SeedVR2_VideoUpscaler — not in the pinned node set yet), keyed `dit`, `vae`
 * and `up`: `image` to `resolution` on the short edge. The node's own video defaults (its HD example): batch 33 with
 * overlap 3 for temporal consistency, LAB colour correction, no added noise — the conservative end, since the owner
 * wants no invented texture. 7B kept the skin calmer than 3B on an H3 close-up (2026-10-14).
 */
export function seedvr2Nodes(model: string, image: unknown, resolution = 1080, cache = false): Record<string, unknown> {
  return {
    dit: {
      class_type: 'SeedVR2LoadDiTModel',
      inputs: { model, device: 'cuda:0', blocks_to_swap: 0, swap_io_components: false, offload_device: 'cpu', cache_model: cache, attention_mode: 'sdpa' },
    },
    vae: {
      class_type: 'SeedVR2LoadVAEModel',
      inputs: {
        model: 'ema_vae_fp16.safetensors', device: 'cuda:0', encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128,
        decode_tiled: true, decode_tile_size: 768, decode_tile_overlap: 128, tile_debug: 'false', offload_device: 'cpu', cache_model: cache,
      },
    },
    up: {
      class_type: 'SeedVR2VideoUpscaler',
      inputs: {
        image, dit: ['dit', 0], vae: ['vae', 0], seed: 42, resolution, max_resolution: 0, batch_size: 33, uniform_batch_size: true,
        temporal_overlap: 3, prepend_frames: 0, color_correction: 'lab', input_noise_scale: 0, latent_noise_scale: 0, offload_device: 'cpu',
        enable_debug: false,
      },
    },
  }
}
