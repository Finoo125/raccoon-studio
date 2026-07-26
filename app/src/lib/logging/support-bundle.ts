import ltx23 from '../../../workflows/LTX23.json'
import anima from '../../../workflows/image_anima_preview.json'
import ernie from '../../../workflows/image_ernie_image_turbo.json'
import sdxl from '../../../workflows/image_sdxl.json'
import zImage from '../../../workflows/image_z_image_turbo.json'

/**
 * One plain-text file a user can attach in Discord when something breaks.
 *
 * Deliberately NOT an archive: the point is that a supporter can read it
 * inline. Text needs no extraction, previews in Discord, and costs us no zip
 * dependency (`tar` exists, but only because the installer checks for it).
 *
 * The section list is drawn from what actually cost us diagnosis time, not from
 * "everything we could dump": the raw logs alone did not explain either of the
 * two bugs reported on 2026-07-25 — one needed ComfyUI's loaded node classes
 * (a custom-node pack silently failed to import) and the other needed the model
 * lists ComfyUI reports per loader. Both are here.
 */

/** Log-file tails, in lines. comfyui.err carries the node import tracebacks. */
export const TAIL_LINES: Record<string, number> = {
  'comfyui.err': 400,
  'comfyui.log': 200,
  install: 300,
  app: 400,
}

/**
 * Pack-provided nodes the default-on optional stages need. The bundled
 * workflow JSONs are scanned automatically (see `requiredNodeClasses`), but
 * these are appended by the graph helpers at build time, so they appear in no
 * template. Kept to the stages that are ON by default — a miss here breaks
 * generation for someone who changed nothing.
 */
const HELPER_NODES = [
  'FaceDetailer',
  'UltralyticsDetectorProvider',
  'SAMLoader',
  'UpscaleModelLoader',
  'ImageUpscaleWithModel',
  'ReActorFaceSwap',
]

type Graph = Record<string, { class_type?: string }>

/**
 * Every node class the shipped workflows submit. A class missing from ComfyUI's
 * `/object_info` is the `missing_node_type` error the user will hit, named
 * before they hit it.
 */
export function requiredNodeClasses(): string[] {
  const found = new Set<string>(HELPER_NODES)
  for (const graph of [ltx23, anima, ernie, sdxl, zImage] as unknown as Graph[]) {
    for (const node of Object.values(graph)) {
      if (node?.class_type) found.add(node.class_type)
    }
  }
  return [...found].sort()
}

/**
 * Add-on unlock keys are `<base64url payload>.<base64url signature>`, and this
 * file is meant to be posted in public channels. Nothing logs a key today; this
 * is here so that a future log line cannot quietly turn a support request into
 * a licence leak.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}/g, '[redacted-key]')
    .replace(/("?\b(?:api[_-]?key|token|secret|password)\b"?\s*[:=]\s*"?)([^\s",}]+)/gi, '$1[redacted]')
}

/** The last `max` non-empty-trailing lines of a file's text. */
export function tailLines(text: string, max: number): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  if (lines.length <= max) return lines.join('\n')
  return [`… (${lines.length - max} earlier lines trimmed)`, ...lines.slice(-max)].join('\n')
}

export interface BundleSection {
  title: string
  body: string
}

export interface BundleInput {
  generatedAt: string
  app: Record<string, string>
  /** Whitelisted config only — never the raw environment (it holds secrets). */
  paths: Record<string, string>
  comfyui: {
    reachable: boolean
    baseUrl: string
    error?: string
    systemStats?: unknown
    /** Node classes ComfyUI has loaded; empty when unreachable. */
    loadedNodes: string[]
    /** Loader node → filenames it offers. */
    models: Record<string, string[]>
  }
  /** Log filename → full text, already read off disk. */
  logs: Record<string, string>
}

function heading(title: string): string {
  return `\n${'='.repeat(72)}\n  ${title}\n${'='.repeat(72)}\n`
}

function kv(rows: Record<string, string>): string {
  const width = Math.max(0, ...Object.keys(rows).map((k) => k.length))
  return Object.entries(rows)
    .map(([k, v]) => `  ${k.padEnd(width)}  ${v}`)
    .join('\n')
}

/** Assemble the bundle text. Pure — the route does the IO and hands it in. */
export function buildSupportBundle(input: BundleInput): string {
  const { comfyui } = input
  const out: string[] = [
    'Raccoon Studio — Support Bundle',
    `Generated: ${input.generatedAt}`,
    '',
    'Attach this whole file to your support request.',
    'It contains no add-on keys; file paths include your Windows username.',
  ]

  out.push(heading('App'), kv(input.app))
  out.push(heading('Configuration'), kv(input.paths))

  out.push(heading('ComfyUI'))
  if (!comfyui.reachable) {
    out.push(
      `  NOT REACHABLE at ${comfyui.baseUrl}`,
      `  ${comfyui.error ?? 'no further detail'}`,
      '',
      '  Nothing can generate while ComfyUI is down — start it first, then',
      '  create this bundle again so the sections below are filled in.',
    )
  } else {
    out.push(
      kv({ 'base url': comfyui.baseUrl, 'node classes loaded': String(comfyui.loadedNodes.length) }),
      '',
      JSON.stringify(comfyui.systemStats ?? {}, null, 2),
    )
  }

  // The headline check: a pack that failed to import takes all of its nodes
  // with it, and ComfyUI reports that only as `missing_node_type` mid-generate.
  out.push(heading('Required nodes MISSING from ComfyUI'))
  if (!comfyui.reachable) {
    out.push('  (skipped — ComfyUI unreachable)')
  } else {
    const missing = requiredNodeClasses().filter((c) => !comfyui.loadedNodes.includes(c))
    out.push(
      missing.length === 0
        ? '  None — every node the shipped workflows use is loaded.'
        : [
            '  These are referenced by the shipped workflows but are NOT loaded.',
            '  A custom-node pack most likely failed to import — search comfyui.err',
            '  below for "Traceback" or the pack name.',
            '',
            ...missing.map((c) => `    !! ${c}`),
          ].join('\n'),
    )
  }

  out.push(heading('Models ComfyUI can see'))
  if (!comfyui.reachable) {
    out.push('  (skipped — ComfyUI unreachable)')
  } else {
    out.push(
      '  A model on disk but absent here means ComfyUI is not reading the folder',
      '  it was downloaded into. Compare with COMFYUI_MODELS_DIR above.',
      '',
      Object.entries(comfyui.models)
        .map(([loader, names]) =>
          names.length === 0
            ? `  ${loader}: (none)`
            : `  ${loader} (${names.length}):\n${names.map((n) => `      ${n}`).join('\n')}`,
        )
        .join('\n'),
    )
  }

  for (const [name, text] of Object.entries(input.logs)) {
    out.push(heading(`logs/${name}`))
    out.push(text.trim() ? text : '  (empty)')
  }

  return redactSecrets(out.join('\n')) + '\n'
}
