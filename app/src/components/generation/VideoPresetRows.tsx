'use client'

import { PickCard, RowHeader } from './PromptPicks'
import { cardsFor, pickPreset, rerollPreset, selectedOf, type PresetRowId } from '@/lib/prompt-builder/video-picks'
import type { EnhanceSettingsValues } from '@/lib/comfyui/enhance-settings'
import type { VideoPromptOptions } from '@/lib/comfyui/video-prompt-options'

const ROWS: Record<PresetRowId, { label: string; emoji: string }> = {
  where: { label: 'Where', emoji: '🏠' },
  happens: { label: 'What happens', emoji: '🎬' },
  camera: { label: 'Camera move', emoji: '🎥' },
  music: { label: 'Music', emoji: '🎵' },
  talking: { label: 'Talking', emoji: '💬' },
  pov: { label: 'Point of view', emoji: '👁' },
}

/** A little scene under a still frame; a moving camera's `anim` (globals.css) slides the scene. */
function CameraScene({ anim }: { anim?: string }) {
  return (
    <span className="absolute inset-0 overflow-hidden bg-[#1e3350]" aria-hidden>
      <span className={`absolute inset-[-25%] flex items-center justify-center gap-1 bg-[linear-gradient(to_bottom,#2b4a73_52%,#2f4a2c_52%)] text-xl ${anim ? 'cam-anim' : ''}`}
        style={anim ? { animationName: anim } : undefined}>
        <span>🌳</span><span className="text-2xl">🧍</span><span>🏠</span>
      </span>
      <span className="absolute inset-1.5 rounded-sm border border-white/50" />
    </span>
  )
}

/**
 * The video Prompt Helper's preset rows: each sets ONE value (dropdown
 * semantics — click picks, clicking the lit card goes back to the row's
 * "None"), with 🔒 keep and 🎲 per row, then the 🔥 Energy slider.
 */
export default function VideoPresetRows({ rows, settings, options, nsfw, keep, onChange, onToggleKeep }: {
  rows: PresetRowId[]
  settings: EnhanceSettingsValues
  options: VideoPromptOptions
  nsfw: boolean
  keep: ReadonlySet<string>
  onChange: (next: EnhanceSettingsValues) => void
  onToggleKeep: (row: PresetRowId) => void
}) {
  return (
    <div className="space-y-5">
      {rows.map((row) => {
        const { label, emoji } = ROWS[row]
        const now = selectedOf(row, settings)
        return (
          <section key={row} aria-label={label}>
            <RowHeader emoji={emoji} label={label} kept={keep.has(row)} onToggleKeep={() => onToggleKeep(row)}
              onReroll={() => onChange(rerollPreset(settings, row, options, nsfw))} />
            <div className="flex flex-wrap items-start gap-1.5">
              {cardsFor(row, options, nsfw, settings.userIntent).map((c) => (
                <PickCard key={c.value} emoji={c.emoji || emoji} label={c.label} src={c.thumb} on={now === c.value} title={c.value}
                  onClick={() => onChange(pickPreset(settings, row, c.value, options))}>
                  {row === 'camera' ? <CameraScene anim={c.anim} /> : undefined}
                </PickCard>
              ))}
            </div>
          </section>
        )
      })}
      <section aria-label="Energy">
        <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
          🔥 Energy <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{settings.energy}</span>
        </h3>
        <div className="flex max-w-md items-center gap-3 text-xs text-muted-foreground">
          <span>calm</span>
          <input type="range" min={1} max={10} step={1} value={settings.energy} aria-label="Energy"
            onChange={(e) => onChange({ ...settings, energy: Number(e.target.value) })} className="flex-1 accent-primary" />
          <span>wild</span>
        </div>
      </section>
    </div>
  )
}
