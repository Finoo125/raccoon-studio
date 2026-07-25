'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { hasBaseModel } from '@/lib/models/installed'

// ComfyUI is usually still booting when the app first paints, so retry until it
// answers. ponytail: if it never comes online we just stay quiet — the ComfyUI
// status chip already reports that case.
const RETRY_MS = 6000
const MAX_TRIES = 20 // ~2 min, enough for a cold ComfyUI start

/**
 * First-run nudge: a fresh install has no models, and nothing generates without
 * one. Shown whenever ComfyUI reports zero checkpoints *and* zero diffusion
 * models — self-clearing, so it stops appearing once the user downloads one.
 */
export default function FirstRunModels() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let tries = 0

    const check = async () => {
      tries += 1
      try {
        const [ckpt, unet] = await Promise.all([
          fetch('/api/comfyui/object_info/CheckpointLoaderSimple', { cache: 'no-store' }),
          fetch('/api/comfyui/object_info/UNETLoader', { cache: 'no-store' }),
        ])
        if (ckpt.ok && unet.ok) {
          if (!cancelled && !hasBaseModel(await ckpt.json(), await unet.json())) setOpen(true)
          return
        }
      } catch { /* ComfyUI unreachable — fall through to the retry */ }
      if (!cancelled && tries < MAX_TRIES) timer = setTimeout(() => void check(), RETRY_MS)
    }

    void check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Nothing to nudge about while the user is already on the Models page.
  if (pathname === '/models') return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>No models installed yet</DialogTitle>
          <DialogDescription>
            Raccoon Studio needs at least one model before it can generate anything.
            Open the Models page to download one — pick a family, hit download, and
            you&apos;re set.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Later</Button>
          <Button onClick={() => { setOpen(false); router.push('/models') }}>
            Install models
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
