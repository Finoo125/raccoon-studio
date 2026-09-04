import { workflows } from '@/lib/workflows'
import type { ImageMetadata } from '@/types/gallery'
import type { GenerationParams, WorkflowDefinition } from '@/types/workflow'

/** Convert embedded Gallery metadata into the image form's reusable settings. */
export function galleryMetadataToGenerationParams(metadata: ImageMetadata): Partial<GenerationParams> {
  return {
    ...(metadata.prompt ? { prompt: metadata.prompt } : {}),
    ...(metadata.negativePrompt ? { negativePrompt: metadata.negativePrompt } : {}),
    ...(metadata.seed !== undefined ? { seed: metadata.seed } : {}),
    ...(metadata.width ? { width: metadata.width } : {}),
    ...(metadata.height ? { height: metadata.height } : {}),
    ...(metadata.loras?.length
      ? { loras: metadata.loras.map((lora) => ({ ...lora })) }
      : {}),
  }
}

/**
 * Output-folder name → the preset to assume when nothing more specific
 * identifies the render.
 *
 * The gallery records `metadata.workflow` from the **folder** an image was
 * written to (`images/<folder>/<date>/`), which comes from each workflow JSON's
 * `filename_prefix` — so the values are `ZIT`, `ERNIE`, `KREA2`, `Anima`,
 * `SDXL`, and none of them is a workflow id or name. Matching them against
 * `id`/`name` therefore always failed, and "Send to Generate" landed on the
 * first preset in the list with the prompt pasted into it.
 *
 * Several presets share one folder (SDXL/Pony/Illustrious all write to `SDXL`),
 * so this is only the fallback: `baseModel` below identifies the exact preset
 * whenever the PNG recorded which model it loaded. Guarded by a test that walks
 * the workflow JSONs, so a new family cannot quietly land here unmapped.
 */
const FOLDER_DEFAULT_WORKFLOW: Record<string, string> = {
  ZIT: 'z-image-turbo',
  ERNIE: 'ernie-turbo',
  KREA2: 'krea2-turbo',
  ANIMA: 'anima',
  SDXL: 'sdxl',
}

/**
 * The preset that most likely produced a gallery image, for "Send to Generate"
 * and "Reuse settings" — both of which used to fall back to the first workflow
 * in the list, leaving the user to pick the model and re-paste the prompt by
 * hand (switching preset applies its defaults and wipes what was prefilled).
 */
export function resolveWorkflowFromMetadata(metadata: ImageMetadata): WorkflowDefinition | undefined {
  const wf = metadata.workflow?.trim()
  const model = metadata.model?.trim()

  // 1. The checkpoint / diffusion model the PNG actually recorded — the
  //    strongest evidence there is, and the only thing that separates the three
  //    SDXL presets or the two Krea2/Anima ones. It has to be tried *before*
  //    the name match below: the SDXL folder is spelled exactly like the SDXL
  //    preset's name, so a Pony render would otherwise come back as plain SDXL.
  if (model) {
    const byModel = workflows.find((w) => w.baseModel.toLowerCase() === model.toLowerCase())
    if (byModel) return byModel
  }
  // 2. An id or a preset name — what a prefill or an older link writes.
  if (wf) {
    const named = workflows.find(
      (w) => w.id === wf.toLowerCase() || w.name.toLowerCase() === wf.toLowerCase(),
    )
    if (named) return named
  }
  // 3. The folder. All that is left for a render that swapped in an Aria model,
  //    or whose metadata was stripped.
  const id = wf ? FOLDER_DEFAULT_WORKFLOW[wf.toUpperCase()] : undefined
  return id ? workflows.find((w) => w.id === id) : undefined
}
