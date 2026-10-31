import type { VideoGenerationParams } from '@/types/video-workflow'
import { h3EditFrames, h3EditKind, h3EditPictures, h3RefCheckpointReady, type H3EditKind } from '@/lib/workflows/minimax-h3'
import { viewUrl } from '@/lib/comfyui/output-media'

/**
 * Where an edit source lives, from its LoadVideo value. The gallery hands over
 * `<output path> [output]` (read in place, like Continue); an upload is a bare
 * input/ filename. Traversal is refused here so neither the probe route nor a
 * graph ever sees it.
 */
export function editSourceRef(source: string): { filename: string; subfolder: string; type: 'input' | 'output' } {
  const output = source.endsWith(' [output]')
  const path = (output ? source.slice(0, -' [output]'.length) : source).replace(/\\/g, '/')
  if (!path || path.split('/').some((p) => p === '..' || p === '')) throw new Error(`Bad clip path: ${source}`)
  const cut = path.lastIndexOf('/')
  return { filename: path.slice(cut + 1), subfolder: cut === -1 ? '' : path.slice(0, cut), type: output ? 'output' : 'input' }
}

/** The clip's proxied view URL, to fetch it back out of ComfyUI (the Edit helper's frame). Throws like `editSourceRef`. */
export const editSourceUrl = (source: string): string => viewUrl(editSourceRef(source))

/**
 * Frames at H3's 24 fps, from the VIDEO stream's duration. Floored with a 0.05
 * frame allowance: ffprobe reports milliseconds (a 362-frame clip arrives as
 * 15.083 s = 361.99), and over-counting is the expensive direction — VHS then
 * delivers one frame fewer than the cap, and MiniMaxH3AddGuide crops a short
 * guide down to the previous 17k+5, leaving the clip's last 0.7 s unanchored.
 */
export const framesFromDuration = (durationSec: number): number => Math.floor(durationSec * 24 + 0.05)

/** Why Edit mode cannot submit yet, or null. One reader for the button and the toast. */
export function editBlockReason(p: VideoGenerationParams): string | null {
  if (p.mode !== 'edit') return null
  if (!p.editSource) return 'Pick the clip to edit first.'
  if (!p.editSourceFrames || !p.editSourceWidth || !p.editSourceHeight) return 'Still reading the clip…'
  if (h3EditFrames(p.editSourceFrames) === null) {
    return `This clip is ${(p.editSourceFrames / 24).toFixed(1)} s — Edit takes up to 15 s. Trim it first.`
  }
  if (h3EditKind(p) === 'head' && h3EditPictures(p).length === 0) return 'Swap head needs a face picture — add it below.'
  return null
}

/**
 * Why an edit cannot render on THIS machine, or null: the kind's LoRA, or the
 * checkpoint the pick renders (Eros, or the stock ref2va weights). Separate
 * from `editBlockReason` because it reads install state, not the form — and
 * every path into Edit (the mode button, the gallery's "Edit video", a restored
 * session, a checkpoint flip) has to hit it before ComfyUI 400s on a missing file.
 */
export function editInstallReason(
  p: VideoGenerationParams,
  r: { editReady: Record<H3EditKind | 'ffp', boolean>; erosReady: boolean; ref2vReady: boolean; hybridReady?: boolean; sparserefReady?: boolean },
): string | null {
  if (p.mode !== 'edit') return null
  // Loosely runs MiniMax's own reference route — no edit LoRA to install.
  if (p.editFollow === 'loose') return refCheckpointReason(p, r)
  const kind = h3EditKind(p)
  const KIND_LABEL: Record<H3EditKind, string> = { vfx: '"Change something"', style: '"Restyle"', head: '"Swap head"' }
  if (!r.editReady[kind]) {
    // Edit opens without any edit LoRA now (Loosely needs none), so say so.
    return `Install the ${KIND_LABEL[kind]} Edit LoRA on the Models page first${kind === 'vfx' ? ' — or switch "Follow the original" to Loosely, which needs none' : ''}.`
  }
  if (h3EditPictures(p).some((x) => x.firstFrame) && !r.editReady.ffp) {
    return 'Install the First-frame Edit LoRA on the Models page first — or clear the first frame.'
  }
  return refCheckpointReason(p, r)
}

/**
 * Why the picked checkpoint cannot render reference conditioning (References,
 * Edit), or null. Eros, the Hybrid and SparseRef15 carry ref2va's weights themselves; only
 * the Standard pick needs the separate ref2va file (`h3RefCheckpointReady`).
 */
export function refCheckpointReason(
  p: VideoGenerationParams,
  r: { erosReady: boolean; ref2vReady: boolean; hybridReady?: boolean; sparserefReady?: boolean },
): string | null {
  if (h3RefCheckpointReady(p.h3Checkpoint, { ref2v: r.ref2vReady, eros: r.erosReady, hybrid: r.hybridReady === true, sparseref: r.sparserefReady === true })) return null
  if (p.h3Checkpoint === 'eros') return 'Install the 10Eros checkpoint on the Models page first.'
  if (p.h3Checkpoint === 'hybrid') return 'Install the Hybrid checkpoint on the Models page first.'
  if (p.h3Checkpoint === 'sparseref') return 'Install the SparseRef15 checkpoint on the Models page first.'
  return `${p.mode === 'edit' ? 'Edit' : 'Reference mode'} on the Standard checkpoint needs the MiniMax H3 reference model — install it on the Models page, or pick 10Eros.`
}

/**
 * Has this edit got its instruction? Swap head may leave it empty when its face
 * picture is described — the builder then fills the template from the
 * description. One reader for the Generate button and the toast.
 */
export function editHasInstruction(p: VideoGenerationParams): boolean {
  if (p.prompt.trim()) return true
  return p.mode === 'edit' && h3EditKind(p) === 'head' && !!h3EditPictures(p)[0]?.note
}

/**
 * Apply a kind or follow change. When it flips whether this is a head swap, the
 * descriptions answered a different question (identity only vs the whole look),
 * so they go and are made again.
 */
export function withEditKindChange(
  p: VideoGenerationParams,
  change: Partial<Pick<VideoGenerationParams, 'editKind' | 'editFollow'>>,
): VideoGenerationParams {
  const next = { ...p, ...change }
  return (h3EditKind(p) === 'head') !== (h3EditKind(next) === 'head') ? { ...next, editPictureNotes: undefined } : next
}
