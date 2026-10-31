'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { markOfferSeen, offerSeen, setupDone } from '@/lib/setup/state'
import { tourPending } from '@/lib/tour'

/**
 * Asked once of people who already had models before the setup existed (the
 * 2.0 update). New installs never see it — the start page sends them to the
 * setup — and it never stacks on the first-run tour.
 */
export default function SetupOffer() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (pathname === '/setup' || tourPending() || setupDone() || offerSeen()) return
    let alive = true
    fetch('/api/models/on-disk', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ hasImageModel?: boolean }>)
      .then((d) => { if (alive && d.hasImageModel) setOpen(true) })
      .catch(() => {})
    return () => { alive = false }
  }, [pathname])

  const answer = (run: boolean) => {
    markOfferSeen()
    setOpen(false)
    if (run) router.push('/setup')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) answer(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New: a setup that picks models for your graphics card</DialogTitle>
          <DialogDescription>
            It looks at your computer, shows every model that fits, and downloads the ones you tick. Your models and pictures stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>No thanks</Button>
          <Button onClick={() => answer(true)}>Run it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
