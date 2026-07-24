'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Wand2, Clapperboard, Images, Film, Package, ScrollText, ExternalLink, SlidersHorizontal, Puzzle, PencilRuler, Settings, Wrench, LayoutGrid, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import ComfyUIStatus from '@/components/ComfyUIStatus'
import QueueProvider from '@/components/queue/QueueProvider'
import SystemMonitor from '@/components/SystemMonitor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQueueStore } from '@/lib/comfyui/queue'
import { navGroups, type FeatureDef } from '@/lib/features/registry'
import { useAddonStore } from '@/lib/addons/store'
import { Fragment, useEffect, useState } from 'react'
import QueuePanel from '@/components/queue/QueuePanel'

const ICONS: Record<string, LucideIcon> = {
  Wand2, Clapperboard, Images, SlidersHorizontal, Film, Package, ScrollText, Puzzle, PencilRuler, Wrench, Settings,
}

/**
 * Below this viewport width the nav drops its labels and runs icon-only. The
 * top bar's side clusters (logo, system meters, queue, ComfyUI status) take a
 * fixed ~720px, so labelled tabs stop fitting well before the items do —
 * previously they were silently clipped by the nav's own overflow scroll.
 * Measured: the labelled row needs ~1800px; the margin covers the ComfyUI
 * status chip's wider states ("Starting…", Stop/Update buttons).
 */
const LABELS_AT = 'min-[1850px]:inline'

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeCount = useQueueStore((s) =>
    s.jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  )

  const [queueOpen, setQueueOpen] = useState(false)

  const unlocked = useAddonStore((s) => s.unlocked)
  const loadAddons = useAddonStore((s) => s.load)
  useEffect(() => { void loadAddons() }, [loadAddons])

  const groups = navGroups(unlocked)

  return (
    <div className="relative z-10 flex flex-col h-screen text-foreground overflow-hidden">
      {/* Top bar — three-track grid (logo · nav · controls) so the grouped nav
          stays centered and never overlaps the side clusters. Sizing is rem-based
          so it scales with the root font-size on Full HD / 2K / 4K panels. */}
      <header className="relative h-[4.5rem] grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3 px-5 border-b border-border bg-card/80 backdrop-blur-xl shrink-0">
        {/* Logo (left) — links to the Generate Image page */}
        <Link
          href="/generate"
          aria-label="Raccoon Studio — Generate Image"
          className="flex items-center gap-3 shrink-0 justify-self-start rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Image
            src="/logo-mascot.png"
            alt="Raccoon Studio"
            width={36}
            height={36}
            className="shrink-0 object-contain animate-ember w-9 h-9"
            priority
          />
          <span className="font-heading font-semibold italic uppercase text-lg hidden sm:block tracking-tight leading-none">
            Raccoon{' '}
            <span className="text-primary">Studio</span>
          </span>
        </Link>

        {/* Nav — clustered into visual groups (create · studio · manage) with a
            divider between groups. Centered in the middle grid track; shrinks +
            scrolls horizontally only when truly cramped. */}
        <nav className="flex items-center justify-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
          {groups.map((g, gi) => (
            <Fragment key={g.group}>
              {gi > 0 && (
                <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 rounded-full bg-border" />
              )}
              <div className="flex items-center gap-1.5">
                {/* 'manage' collapses into one dropdown — see registry.ts. */}
                {g.group === 'manage' ? (
                  <ManageMenu items={g.items} pathname={pathname} />
                ) : (
                  g.items.map(({ href, label, icon }) => (
                    <NavLink
                      key={href}
                      href={href}
                      label={label}
                      Icon={ICONS[icon]}
                      active={pathname === href || pathname.startsWith(`${href}/`)}
                    />
                  ))
                )}
                {/* The Add-ons store link lives at the tail of the paid cluster. */}
                {g.group === 'studio' && (
                  <NavLink href="/add-ons" label="Add-ons" Icon={Puzzle} active={pathname === '/add-ons'} />
                )}
              </div>
            </Fragment>
          ))}
        </nav>

        {/* Right side — system meters + queue count + ComfyUI access/status */}
        <div className="flex items-center gap-2.5 shrink-0 justify-self-end">
          {/* Live CPU / RAM / VRAM (ComfyUI-Crystools) */}
          <SystemMonitor className="hidden md:flex" />
          <div className="w-px h-7 bg-border shrink-0 hidden md:block" />

          <button
            onClick={() => setQueueOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Queue & history"
          >
            {activeCount > 0 ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-action animate-pulse" />
                {activeCount} generating
              </>
            ) : (
              <>Queue</>
            )}
          </button>

          {/* Open the ComfyUI web backend (binds 127.0.0.1:8188) in a new tab */}
          <button
            onClick={() => window.open(`http://${window.location.hostname}:8188`, '_blank', 'noopener,noreferrer')}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open the ComfyUI web interface in a new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ComfyUI</span>
          </button>

          <ComfyUIStatus className="mx-0 mt-0" />
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      <QueueProvider />
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} />
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

/** The orange active pill, shared (via layoutId) by every nav item. */
function ActivePill() {
  return (
    <motion.span
      layoutId="nav-active"
      className="absolute inset-0 rounded-lg bg-gradient-to-b from-[#ffa64d] to-[#f5811e] shadow-[0_6px_18px_-6px_rgba(245,129,30,0.42)]"
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    />
  )
}

const navItemClass = (active: boolean) =>
  cn(
    'relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
    active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
  )

/** A single top-bar nav item: animated active pill + icon + label, with
 *  high-res scaling. Shared by registry features and the Add-ons store link.
 *  `title` carries the name when the label is collapsed on narrow screens. */
function NavLink({
  href, label, Icon, active,
}: { href: string; label: string; Icon?: LucideIcon; active: boolean }) {
  return (
    <Link href={href} title={label} aria-label={label} className={navItemClass(active)}>
      {active && <ActivePill />}
      {Icon && <Icon className="relative h-4 w-4 shrink-0" />}
      <span className={cn('relative hidden whitespace-nowrap', LABELS_AT)}>{label}</span>
    </Link>
  )
}

/** The 'manage' cluster (Tools · Models · Logs · Settings) as one dropdown. */
function ManageMenu({ items, pathname }: { items: FeatureDef[]; pathname: string }) {
  const [open, setOpen] = useState(false)
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const active = items.some((i) => isActive(i.href))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger title="Manage" aria-label="Manage" className={navItemClass(active)}>
        {active && <ActivePill />}
        <LayoutGrid className="relative h-4 w-4 shrink-0" />
        <span className={cn('relative hidden whitespace-nowrap', LABELS_AT)}>Manage</span>
        <ChevronDown className="relative h-3.5 w-3.5 shrink-0 opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0.5 p-1.5">
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon]
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                isActive(href) ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {label}
            </Link>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
