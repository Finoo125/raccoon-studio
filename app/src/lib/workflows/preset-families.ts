import { workflows } from '@/lib/workflows'
import type { WorkflowDefinition } from '@/types/workflow'

/**
 * How presets are named by family, one place for the Generate panel's preset
 * cards and the Models catalog's image rows: the family is the label, each
 * preset is what is left of its name ("Krea2 RAW" → Krea2 · RAW, "Anima" →
 * Anima · Base). A family missing here shows its presets under their full names.
 */
const FAMILY_NAMES: Record<string, { label: string; prefix: string }> = {
  anima: { label: 'Anima', prefix: 'Anima' },
  ernie: { label: 'Ernie', prefix: 'Ernie Image' },
  krea2: { label: 'Krea2', prefix: 'Krea2' },
  qwen21: { label: 'Qwen 2.1', prefix: 'Qwen-Image 2.1' },
  zimage: { label: 'Z-Image', prefix: 'Z Image' },
  sdxl: { label: 'SDXL', prefix: 'SDXL' },
}

export interface PresetName { family: string; variant: string }

export function presetName(w: Pick<WorkflowDefinition, 'id' | 'name' | 'loraFamily'>): PresetName {
  const fam = FAMILY_NAMES[w.loraFamily ?? w.id]
  if (!fam) return { family: w.name, variant: w.name }
  return { family: fam.label, variant: w.name.startsWith(fam.prefix) ? w.name.slice(fam.prefix.length).trim() || 'Base' : w.name }
}

/** The family/variant name of a registered preset id, or undefined for anything else. */
export function presetNameById(id: string): PresetName | undefined {
  const w = workflows.find((x) => x.id === id)
  return w && presetName(w)
}

type PresetGroup = { label: string; presets: { w: WorkflowDefinition; variant: string }[] }

/** Every image preset, grouped by family in registry order. */
export const PRESET_GROUPS = workflows.reduce<PresetGroup[]>((groups, w) => {
  const { family, variant } = presetName(w)
  const group = groups.find((g) => g.label === family)
  if (group) group.presets.push({ w, variant })
  else groups.push({ label: family, presets: [{ w, variant }] })
  return groups
}, [])
