'use client'

import { useEffect, useState } from 'react'
import { X, Download, Maximize2, ChevronLeft, ChevronRight, RotateCcw, Check, Pencil } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStudioStore } from '@/lib/generation/studio-store'
import { useRecentImagesStore } from '@/lib/generation/recent-store'
import { useDirectorStage } from '@/lib/director/director-stage'
import { useRouter } from 'next/navigation'
import { workflows } from '@/lib/workflows'
import type { GenerationParams } from '@/types/workflow'

/**
 * Centered modal that inspects a recent gallery image. Opened by the RecentRail
 * via `studio-store.inspectImageUrl`. Closing it has no effect on the Create-menu
 * form — only the explicit "Reuse settings" action loads metadata back in.
 */
export default function GenerateInspector() {
  const images = useRecentImagesStore((s) => s.images)
  const inspectImageUrl = useStudioStore((s) => s.inspectImageUrl)
  const setInspectImage = useStudioStore((s) => s.setInspectImage)
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const [lightbox, setLightbox] = useState(false)
  const director = useDirectorStage('image')
  const router = useRouter()

  const idx = images.findIndex((i) => i.url === inspectImageUrl)
  const image = idx >= 0 ? images[idx] : null
  const prev = idx > 0 ? images[idx - 1] : null
  const next = idx >= 0 && idx < images.length - 1 ? images[idx + 1] : null

  // Esc closes the lightbox first, then the modal; arrows navigate.
  useEffect(() => {
    if (!image) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(false)
        else setInspectImage(null)
      } else if (e.key === 'ArrowLeft' && prev) {
        setInspectImage(prev.url)
      } else if (e.key === 'ArrowRight' && next) {
        setInspectImage(next.url)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [image, lightbox, prev, next, setInspectImage])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset overlay on navigation
  useEffect(() => { setLightbox(false) }, [inspectImageUrl])

  if (!image) return null
  const m = image.metadata

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = image.url
    a.download = image.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Saving image…')
  }

  const handleReuse = () => {
    const wf = m.workflow
      ? workflows.find(
          (w) => w.id === m.workflow!.toLowerCase() || w.name.toLowerCase() === m.workflow!.toLowerCase(),
        )
      : undefined
    const params: Partial<GenerationParams> = {
      ...(m.prompt ? { prompt: m.prompt } : {}),
      ...(m.negativePrompt ? { negativePrompt: m.negativePrompt } : {}),
      ...(m.seed !== undefined ? { seed: m.seed } : {}),
      ...(m.width ? { width: m.width } : {}),
      ...(m.height ? { height: m.height } : {}),
    }
    setPrefill({ workflowId: wf?.id ?? workflows[0].id, params })
    setInspectImage(null)
    toast.success('Settings loaded — hit Generate')
  }

  const handleEdit = () => {
    const params = new URLSearchParams({ subfolder: image.subfolder, filename: image.filename })
    setInspectImage(null)
    router.push(`/photo-editing?${params}`)
  }

  return (
    <>
      <AnimatePresence>
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          onClick={() => setInspectImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="relative flex w-full max-w-3xl max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setInspectImage(null)}
              className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
              title="Close (Esc)"
              aria-label="Close inspector"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative h-[48vh] shrink-0 bg-muted group">
              <button
                type="button"
                onClick={() => setLightbox(true)}
                className="absolute inset-0 h-full w-full cursor-zoom-in"
                title="Click for full size"
                aria-label="View full size"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local gallery image */}
                <img src={image.url} alt={m.prompt || image.filename} className="h-full w-full object-contain" />
              </button>
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-90">
                <Maximize2 className="h-3 w-3" /> Click for full size
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!prev} onClick={() => prev && setInspectImage(prev.url)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  {idx + 1} of {images.length}
                </span>
                <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!next} onClick={() => next && setInspectImage(next.url)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 px-4 pt-4">
                {director && (
                  <Button
                    className="h-11 text-sm font-semibold col-span-3 bg-primary text-primary-foreground"
                    disabled={director.selecting}
                    onClick={async () => { await director.onSelect(image.url); setInspectImage(null) }}
                  >
                    <Check className="h-4 w-4 mr-2" /> Use this for {director.label}
                  </Button>
                )}
                <Button className="h-11 text-sm font-semibold col-span-3" onClick={handleReuse}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Reuse settings
                </Button>
                <Button variant="outline" className="h-11 flex-col gap-1 text-xs col-span-3" onClick={handleEdit}>
                  <Pencil className="h-4 w-4" /> Edit image
                </Button>
                <Button variant="outline" className="h-11 flex-col gap-1 text-xs" onClick={handleDownload}>
                  <Download className="h-4 w-4" /> Save image
                </Button>
                <Button variant="outline" className="h-11 flex-col gap-1 text-xs col-span-2" onClick={() => setLightbox(true)}>
                  <Maximize2 className="h-4 w-4" /> Full size
                </Button>
              </div>

              <div className="px-4 py-4 space-y-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generation details</p>
                {m.workflow && <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">{m.workflow}</span>}
                {m.prompt && <p className="text-sm leading-relaxed">{m.prompt}</p>}
                {m.negativePrompt && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <span className="text-muted-foreground">Neg: </span>{m.negativePrompt}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs text-muted-foreground pt-1 border-t border-border">
                  {m.seed !== undefined && <div>seed {m.seed}</div>}
                  {m.width && m.height && <div>{m.width} × {m.height}</div>}
                  {m.steps !== undefined && <div>{m.steps} steps</div>}
                  {m.cfg !== undefined && <div>cfg {m.cfg}</div>}
                  {m.sampler && <div>{m.sampler}</div>}
                  <div>{new Date(image.createdAt).toLocaleString()}</div>
                </div>
                {m.prompt === undefined && m.seed === undefined && (
                  <p className="text-xs italic text-muted-foreground">No embedded metadata in this file.</p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm cursor-zoom-out" onClick={() => setLightbox(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local gallery image */}
          <img src={image.url} alt={m.prompt || image.filename} className="h-full w-full object-contain p-6" />
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(false) }}
            className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
            title="Close full size (Esc)"
          >
            <X className="h-5 w-5" /> Close
          </button>
        </div>
      )}
    </>
  )
}
