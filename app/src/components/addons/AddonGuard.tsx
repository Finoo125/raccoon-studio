'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAddonStore } from '@/lib/addons/store'

/**
 * UX guard for an add-on page: once entitlements have loaded, if this feature is
 * locked, send the user to the Add-ons page. The real security boundary is the
 * server-side assertEntitled() on the add-on API routes (Task 8).
 */
export default function AddonGuard({
  featureId,
  children,
}: {
  featureId: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const loaded = useAddonStore((s) => s.loaded)
  const unlocked = useAddonStore((s) => s.unlocked)
  const load = useAddonStore((s) => s.load)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const locked = loaded && !unlocked.includes(featureId)
  useEffect(() => {
    if (locked) router.replace('/add-ons')
  }, [locked, router])

  if (!loaded || locked) return null
  return <>{children}</>
}
