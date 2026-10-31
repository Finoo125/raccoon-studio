import { redirect } from 'next/navigation'
import { getSettings } from '@/lib/settings/settings'
import { modelsOnDisk } from '@/lib/models/on-disk'
import { getComfyUIDir } from '@/lib/comfyui/server-state'

// Per request: a build-time answer would send every install to the same page forever.
export const dynamic = 'force-dynamic'

/** A new install (no picture model on disk) starts at the setup; everyone else at Generate Image. */
export default function Home() {
  const disk = modelsOnDisk(process.env.COMFYUI_MODELS_DIR ?? '', getSettings().sharedModelsDir, getComfyUIDir())
  redirect(disk.known && !disk.hasImageModel ? '/setup' : '/generate')
}
