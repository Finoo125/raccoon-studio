'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { videoWorkflows, isLtxWorkflow } from '@/lib/workflows/video-index'
import { STARTER_MODELS, isInstalled, type StarterModel } from '@/lib/models/starter'
import { h3RefCheckpointReady } from '@/lib/workflows/minimax-h3'
import { simpleVideoMode, type SimpleVideoMode } from '@/lib/workflows/simple-values'
import { useVideoForm } from './video-form-context'
import { DurationRow, OrientationPicker, ReferencePanel, ResolutionSpeedRow, SourceImageInput, modelPatch } from './VideoFormPanels'
import PromptReview from './PromptReview'
import VideoPromptHelperDialog, { VideoPromptHelperButton } from './VideoPromptHelper'
import { SimpleModelCards, SimpleMoreHint, SimpleSteps } from './SimpleSteps'

const START: { mode: SimpleVideoMode; label: string; line: string }[] = [
  { mode: 't2v', label: 'Words', line: 'just describe it' },
  { mode: 'i2v', label: 'A picture', line: 'it starts moving' },
  { mode: 'ref2v', label: 'Reference pictures', line: 'a character, an outfit, a place' },
]

/** Simple Generate Video (spec §3): model, start from, prompt, shape/length/quality. */
export default function SimpleVideoForm() {
  const {
    params, set, setParams, workflow, onDisk, ref2vReady, erosReady, hybridReady, sparserefReady,
    setImageB64, seedPreview, setSeedPreview,
  } = useVideoForm()
  const [helperOpen, setHelperOpen] = useState(false)
  const mode = simpleVideoMode(params.mode)
  const isLtx = isLtxWorkflow(workflow.id)
  const current = (m: StarterModel) => m.opens.page === 'video' && m.opens.workflow === workflow.id &&
    (m.opens.workflow !== 'minimax-h3' || m.opens.h3Checkpoint === (params.h3Checkpoint ?? 'base'))
  // Installed video models; with an unknown disk, all of them. Plus the current pick (stock H3, an uninstalled one).
  const cards = STARTER_MODELS.filter((m) => m.group === 'video' && (!onDisk || isInstalled(m, onDisk) || current(m)))
  const pick = (m: StarterModel) => {
    if (m.opens.page !== 'video') return
    const { workflow: id, h3Checkpoint: ckpt } = m.opens
    const w = videoWorkflows.find((x) => x.id === id)
    if (w) setParams((p) => modelPatch(p, w, ckpt))
  }
  const refOk = !isLtx && h3RefCheckpointReady(params.h3Checkpoint, { ref2v: ref2vReady, eros: erosReady, hybrid: hybridReady, sparseref: sparserefReady })
  const starts = START.filter((s) => s.mode !== 'ref2v' || refOk)

  return (
    <div className="space-y-5">
      <SimpleSteps
        steps={[
          {
            title: 'Model',
            body: (
              <SimpleModelCards
                cards={[
                  ...cards.map((m) => ({ key: m.id, name: m.name, blurb: m.blurb, selected: current(m), onPick: () => pick(m) })),
                  // stock H3 or anything outside the starter table: show it so Simple never hides the pick
                  ...(cards.some(current) ? [] : [{ key: 'current', name: workflow.name, blurb: workflow.description, selected: true, onPick: () => {} }]),
                ]}
              />
            ),
          },
          {
            title: 'Start from',
            body: (
              <div className="space-y-2">
                <div className={`grid gap-2 ${starts.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {starts.map((s) => (
                    <Button
                      key={s.mode}
                      variant={mode === s.mode ? 'default' : 'outline'}
                      className="h-auto flex-col gap-0.5 py-2"
                      onClick={() => set('mode', s.mode)}
                    >
                      <span className="text-sm font-semibold">{s.label}</span>
                      <span className="text-[11px] font-normal opacity-75">{s.line}</span>
                    </Button>
                  ))}
                </div>
                {mode === 'i2v' && (
                  <SourceImageInput
                    compact
                    value={params.inputImage}
                    onChange={(filename) => { set('inputImage', filename); setSeedPreview(null) }}
                    onB64={setImageB64}
                    onDims={(d) => setParams((p) => ({ ...p, inputImageWidth: d?.w, inputImageHeight: d?.h }))}
                    previewUrl={seedPreview}
                  />
                )}
                {mode === 'ref2v' && <ReferencePanel simple />}
              </div>
            ),
          },
          {
            title: 'Describe what happens',
            action: <VideoPromptHelperButton onOpen={() => setHelperOpen(true)} />,
            body: (
              <>
                <PromptReview prompt={params.prompt} onPromptChange={(v) => set('prompt', v)} />
                <VideoPromptHelperDialog open={helperOpen} onClose={() => setHelperOpen(false)} />
              </>
            ),
          },
          {
            title: 'Shape, length and quality',
            body: (
              <div className="space-y-3">
                {/* A picture sets the clip's shape itself. */}
                {mode !== 'i2v' && <OrientationPicker />}
                <DurationRow />
                <ResolutionSpeedRow simple />
              </div>
            ),
          },
        ]}
      />
      <SimpleMoreHint>An end frame, keyframes, LoRAs, finishing touches and more</SimpleMoreHint>
    </div>
  )
}
