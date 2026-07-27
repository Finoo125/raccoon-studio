import type { ImageMetadata } from '@/types/gallery'
import type { GenerationParams } from '@/types/workflow'

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
