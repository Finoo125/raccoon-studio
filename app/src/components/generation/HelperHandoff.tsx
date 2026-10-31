'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAddonLock } from '@/lib/addons/useAddonLock'
import { HELPER_LINK_ADDON, parseHandoff } from '@/lib/generation/helper-handoff'
import { useStudioStore } from '@/lib/generation/studio-store'

/**
 * Applies a Video Helper link (`?handoff=`) through the same prefill the gallery's "Send to" buttons use.
 * Creator-only (see helper-handoff.ts): on every other install the parameter is dropped and nothing happens.
 *
 * Mounted in the studio layout, so it runs after the page's own mount-time restore from localStorage
 * (child effects first) and the link's values win over the restored session.
 */
export default function HelperHandoff() {
  const { locked, loaded } = useAddonLock(HELPER_LINK_ADDON)
  const setPrefill = useStudioStore((s) => s.setPrefill)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!loaded) return
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('handoff')
    if (!raw) return
    const strip = () => {
      url.searchParams.delete('handoff')
      window.history.replaceState(null, '', url.pathname + url.search)
    }
    if (locked) return strip()
    const handoff = parseHandoff(raw)
    if (!handoff) {
      strip()
      toast.error('That Video Helper link could not be read.')
      return
    }
    // Opened on another page: go to the right one first and apply there, after its form has mounted.
    if (pathname !== handoff.page) return router.replace(`${handoff.page}?handoff=${encodeURIComponent(raw)}`)
    strip()
    setPrefill(handoff.prefill)
    // Visible on purpose: any page can open this address, so the user always sees when a link filled the form.
    toast.success('Filled in by Video Helper. Check it, then press Generate.')
  }, [loaded, locked, pathname, router, setPrefill])

  return null
}
