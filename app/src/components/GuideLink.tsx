'use client'

import { ArrowUpRight, BookOpenText } from 'lucide-react'
import { useUiMode } from '@/lib/ui-mode'
import { GUIDE_TITLES, guideHref } from '@/lib/portal'

const TIP = 'Opens this guide on the Raccoon Portal in a new tab (log in with Patreon or DeviantArt)'

/** The page's guide, named, beside the Simple | Advanced switch (same height). Hidden while PORTAL_URL is empty. */
export function GuideChip({ slug, className = '' }: { slug: string; className?: string }) {
  const href = guideHref(slug)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={TIP}
      className={`group inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-primary/35 bg-gradient-to-r from-primary/20 via-primary/[0.07] to-transparent px-2.5 text-xs font-semibold text-[#ffa64d] transition-all hover:border-primary/60 hover:from-primary/30 hover:shadow-[0_0_14px_-2px_rgba(245,129,30,0.45)] ${className}`}
    >
      <BookOpenText className="h-3.5 w-3.5" />
      <span className="whitespace-nowrap">{GUIDE_TITLES[slug] ?? 'Guide'}</span>
      <ArrowUpRight className="-ml-0.5 h-3 w-3 opacity-50 transition-all group-hover:-translate-y-px group-hover:translate-x-px group-hover:opacity-100" />
    </a>
  )
}

/** "New here?" on an empty canvas, in Simple only: where a beginner looks when they don't know what to do yet. */
export function GuideInvite({ slug }: { slug: string }) {
  const simple = useUiMode() === 'simple'
  const href = guideHref(slug)
  if (!simple || !href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={TIP}
      className="group relative flex w-full max-w-md items-center gap-3.5 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.16] via-card/80 to-card/60 p-3.5 pr-4 text-left backdrop-blur-sm transition-all hover:border-primary/55 hover:shadow-[0_0_30px_-8px_rgba(245,129,30,0.55)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#ffa64d] text-primary-foreground shadow-[0_0_18px_-4px_rgba(245,129,30,0.7)] transition-transform group-hover:scale-105">
        <BookOpenText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffa64d]">New here?</span>
        <span className="block font-heading text-base font-semibold leading-snug text-foreground">{GUIDE_TITLES[slug]}</span>
        <span className="block text-xs text-muted-foreground">A short guide with pictures, step by step.</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#ffa64d]" />
    </a>
  )
}
