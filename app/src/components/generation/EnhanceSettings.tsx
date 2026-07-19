'use client'

import { Sparkles, Loader2, Settings2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import type { VideoPromptOptions } from '@/lib/comfyui/video-prompt-options'

export interface EnhanceSettingsValues {
  userIntent: string
  model: string
  environment: string
  scenario: string
  camera: string
  music: string
  dialogueTier: 'none' | 'standard' | 'talkative'
  energy: number
  pov: boolean
  povGender: 'female' | 'male'
}

const DIALOGUE_TIERS: { value: EnhanceSettingsValues['dialogueTier']; label: string }[] = [
  { value: 'none', label: 'Silent' },
  { value: 'standard', label: 'Standard' },
  { value: 'talkative', label: 'Talkative' },
]

interface EnhanceSettingsProps {
  collapsed: boolean
  onExpand: () => void
  values: EnhanceSettingsValues
  onChange: <K extends keyof EnhanceSettingsValues>(key: K, value: EnhanceSettingsValues[K]) => void
  models: string[]
  options: VideoPromptOptions
  onEnhance: () => void
  isStreaming: boolean
  disabledReason: string | null
}

export default function EnhanceSettings({
  collapsed, onExpand, values, onChange, models, options,
  onEnhance, isStreaming, disabledReason,
}: EnhanceSettingsProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <Settings2 className="h-4 w-4 text-primary shrink-0" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {[values.model, values.dialogueTier, values.pov ? 'POV' : null, `energy ${values.energy}`]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="space-y-2">
        <SectionLabel>Your idea</SectionLabel>
        <Textarea
          placeholder="Rough intent: who, what action, mood…"
          className="min-h-[80px] resize-y text-sm"
          value={values.userIntent}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange('userIntent', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LabeledSelect label="Model" value={values.model} options={models}
          onValueChange={(v) => onChange('model', v)} />
        <LabeledSelect label="Environment" value={values.environment} options={options.environments}
          onValueChange={(v) => onChange('environment', v)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LabeledSelect label="Scenario" value={values.scenario} options={options.scenarios}
          onValueChange={(v) => onChange('scenario', v)} />
        <LabeledSelect label="Camera" value={values.camera} options={options.cameras}
          onValueChange={(v) => onChange('camera', v)} />
      </div>

      <LabeledSelect label="Music" value={values.music} options={options.music}
        onValueChange={(v) => onChange('music', v)} />

      {/* Dialogue tier */}
      <div className="space-y-1.5">
        <SectionLabel>Dialogue</SectionLabel>
        <div className="flex gap-2">
          {DIALOGUE_TIERS.map((t) => (
            <Button
              key={t.value}
              variant={values.dialogueTier === t.value ? 'default' : 'outline'}
              className="h-8 flex-1 text-sm"
              onClick={() => onChange('dialogueTier', t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Energy */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Energy</SectionLabel>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{values.energy}</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={values.energy}
          onChange={(e) => onChange('energy', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      {/* POV + gender */}
      <div className="flex gap-2">
        <Button
          variant={values.pov ? 'default' : 'outline'}
          className="h-8 flex-1 text-sm"
          onClick={() => onChange('pov', !values.pov)}
        >
          POV
        </Button>
        {values.pov && (
          <>
            <Button
              variant={values.povGender === 'female' ? 'default' : 'outline'}
              className="h-8 flex-1 text-sm"
              onClick={() => onChange('povGender', 'female')}
            >
              ♀ Female
            </Button>
            <Button
              variant={values.povGender === 'male' ? 'default' : 'outline'}
              className="h-8 flex-1 text-sm"
              onClick={() => onChange('povGender', 'male')}
            >
              ♂ Male
            </Button>
          </>
        )}
      </div>

      <Button
        className="w-full h-10 font-bold"
        onClick={onEnhance}
        disabled={isStreaming || disabledReason !== null}
        title={disabledReason ?? undefined}
      >
        {isStreaming ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enhancing…</>
        ) : (
          <><Sparkles className="h-4 w-4 mr-2" /> Enhance prompt</>
        )}
      </Button>
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
    </div>
  )
}

function LabeledSelect({
  label, value, options, onValueChange,
}: {
  label: string
  value: string
  options: string[]
  onValueChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      <Select
        value={value}
        onValueChange={(v: string | null) => {
          if (v !== null) onValueChange(v)
        }}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-sm">{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center text-xs font-semibold tracking-tight text-muted-foreground">
      {children}
    </label>
  )
}
