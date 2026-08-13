'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  Package, Wand2, Clapperboard, Images, LayoutGrid, Puzzle, Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { TOUR_KEY, TOUR_EVENT, tourPending } from '@/lib/tour'

interface TourStep {
  title: string
  body: string
  Icon: LucideIcon
  /** Route to show behind the dialog while this step is up. Omitted on the
   *  welcome step so the tour doesn't yank the user off wherever they landed
   *  before they've agreed to take it. */
  href?: string
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to Raccoon Studio',
    body: 'A quick lap around the place — six stops, under a minute. You can skip it now or replay it later from Settings.',
    Icon: Sparkles,
  },
  {
    title: 'Models — start here',
    body: 'Nothing generates without a model. Pick a family, hit Download, and the row fills in as it lands. Krea2 Turbo is the everyday all-rounder; Anima, Pony and Illustrious are the anime ones. Video models live further down the same page.',
    Icon: Package,
    href: '/models',
  },
  {
    title: 'Generate Image',
    body: 'Pick a model preset — only the ones you have downloaded are selectable — write a prompt, and hit Generate. LoRAs, face swap, img2img and the upscale/detailer stages are in the panels underneath.',
    Icon: Wand2,
    href: '/generate',
  },
  {
    title: 'Generate Video',
    body: 'Turn a prompt or a still into a clip. LTX 2.3 does silent video with a Director timeline for multi-shot scenes; MiniMax H3 renders video with its own synced audio. Both need their models downloaded first.',
    Icon: Clapperboard,
    href: '/generate-videos',
  },
  {
    title: 'Gallery',
    body: 'Every render lands here with the settings that made it. Tag and compare them, or send one straight back into Generate as a base image to keep iterating.',
    Icon: Images,
    href: '/gallery',
  },
  {
    title: 'Utilities',
    body: 'The Utilities menu holds Tools (build a reusable face model), Backup & Restore for everything you have made, Logs for when a render misbehaves, and Settings for paths and connection config.',
    Icon: LayoutGrid,
    href: '/tools',
  },
  {
    title: 'Patreon',
    body: 'Supporter add-ons — the Director timeline, Photo Editing and more — unlock with a membership key you paste on this page. Everything else stays free and local.',
    Icon: Puzzle,
    href: '/add-ons',
  },
]

/**
 * First-run walkthrough of the menus, one step per surface, navigating to each
 * page as it describes it (the dialog's backdrop is near-transparent, so the
 * real page is visible behind the copy).
 *
 * Skippable at every step, and recorded as done either way — finishing and
 * skipping both mean "don't ask again". Settings can re-open it via TOUR_EVENT.
 */
export default function GuidedTour() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const router = useRouter()

  useEffect(() => {
    // Deferred a tick rather than opened straight from the effect: the page gets
    // to paint first (so the tour lands on top of a real studio, not a blank
    // one), and a synchronous setState here is a cascading render.
    const t = setTimeout(() => { if (tourPending()) setOpen(true) }, 0)
    const replay = () => { setStep(0); setOpen(true) }
    window.addEventListener(TOUR_EVENT, replay)
    return () => { clearTimeout(t); window.removeEventListener(TOUR_EVENT, replay) }
  }, [])

  const finish = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem(TOUR_KEY, '1') } catch { /* quota or unavailable */ }
  }, [])

  const go = (next: number) => {
    setStep(next)
    const href = STEPS[next].href
    if (href) router.push(href)
  }

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const { Icon } = current

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish() }}>
      {/* Rings whatever carries this step's route as `data-tour` — the nav item
          it describes, plus any in-page anchor tagged with the same route. The
          rule is injected rather than toggled onto the element, so it cannot
          leave a stray class behind on a component the tour doesn't own.
          Deliberately no z-index lift: the (now invisible) backdrop still has to
          swallow the click, or the user navigates and the tour loses its place.
          Gated on `open` because this sits outside the portal — Dialog.Root
          renders its children whether or not it is open, so without the guard
          the last step's ring stays burned into the page after Close. */}
      {open && current.href && (
        <style>{`
          [data-tour="${current.href}"] {
            border-radius: 0.5rem;
            box-shadow:
              0 0 0 2px var(--primary),
              0 0 22px 5px color-mix(in oklch, var(--primary) 45%, transparent);
            animation: raccoon-tour-ring 1.8s ease-in-out infinite;
          }
          @keyframes raccoon-tour-ring {
            0%, 100% { box-shadow: 0 0 0 2px var(--primary), 0 0 14px 2px color-mix(in oklch, var(--primary) 35%, transparent); }
            50%      { box-shadow: 0 0 0 2px var(--primary), 0 0 28px 7px color-mix(in oklch, var(--primary) 60%, transparent); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-tour="${current.href}"] { animation: none; }
          }
        `}</style>
      )}
      <DialogContent
        // Clear backdrop: the whole point is to read the page underneath. And
        // parked at the bottom, out of the way of the page's own content — the
        // nav being pointed at is at the top.
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        className="top-auto bottom-6 translate-y-0 shadow-2xl sm:max-w-md"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-lg">{current.title}</DialogTitle>
          </div>
          <DialogDescription className="leading-relaxed">{current.body}</DialogDescription>
        </DialogHeader>

        {/* Progress dots — cheaper to read at a glance than "step 3 of 7". */}
        <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-primary' : 'w-1.5 bg-border'}`}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="lg" onClick={finish}>
            {last ? 'Close' : 'Skip tour'}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="lg" onClick={() => go(step - 1)}>Back</Button>
            )}
            <Button
              size="lg"
              onClick={() => {
                if (!last) return go(step + 1)
                finish()
                router.push('/models')
              }}
            >
              {last ? 'Get models' : step === 0 ? 'Show me around' : 'Next'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
