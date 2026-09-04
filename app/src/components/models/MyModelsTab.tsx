'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAddonLock } from '@/lib/addons/useAddonLock'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import LibraryGrid from './LibraryGrid'
import CivitaiBrowse from './CivitaiBrowse'
import type { Transfer } from '@/lib/models/transfers'

type Pane = 'library' | 'civitai'

/**
 * The Patreon-gated tabs of the Models page: **My Models** (what is installed)
 * and **Civitai Browser**.
 *
 * One component serves both so the add-on lock, the locked panel and the
 * dynamic chunk are shared. They used to be sub-panes inside a single tab,
 * which put the installed-model library behind a Civitai sign-in it has no need
 * of — the library reads local disk and nothing else.
 *
 * `useAddonLock` here is cosmetic — it decides what the user sees. The real
 * boundary is `assertEntitled('civitai-browser')` at the top of every
 * `/api/civitai/*` route, because anything decided in the browser can be
 * bypassed from the browser.
 */
export default function MyModelsTab({
  pane,
  activeTransfers = [],
  onStarted,
  justConnected = false,
}: {
  /** Which tab is asking. */
  pane: Pane
  /** Live transfers from the page's poll, so the browser can show progress. */
  activeTransfers?: Transfer[]
  /** A download was registered server-side. The page arms the restart prompt;
   *  the poll settles it. */
  onStarted?: (t: Transfer) => void
  /** The page saw `?civitai=connected`; re-read status now that we are mounted. */
  justConnected?: boolean
}) {
  const { locked, loaded } = useAddonLock('civitai-browser')
  const [connected, setConnected] = useState<boolean | null>(null)
  const [username, setUsername] = useState<string>()
  const [pasted, setPasted] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/civitai/auth/status', { cache: 'no-store' })
      const j = (await res.json()) as { connected?: boolean; username?: string }
      setConnected(!!j.connected)
      setUsername(j.username)
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    // Only the Civitai tab needs a session — asking on the library tab would
    // spend a token refresh on a pane that never calls Civitai.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches, then sets connected/username
    if (loaded && !locked && pane === 'civitai') void refreshStatus()
  }, [loaded, locked, pane, refreshStatus])

  // The sign-in RESULT is read by the page, not here — this component is
  // `next/dynamic` and only mounts on the My Models tab, so a callback landing
  // on the default Catalog tab would report nothing at all. The page switches
  // tabs and toasts, then calls this to re-read status once we are mounted.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches, then sets connected/username
    if (justConnected) void refreshStatus()
  }, [justConnected, refreshStatus])

  const signIn = async () => {
    try {
      // The origin has to come from the browser: the server sees a pod proxy's
      // Host header, not the address the user is actually on. Same reason
      // `resolveWsBase` reads `location` rather than the server's own view.
      const res = await fetch('/api/civitai/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      const j = (await res.json()) as { url?: string; error?: string }
      if (j.url) window.location.href = j.url
      else toast.error(j.error ?? 'Could not start sign-in')
    } catch (e) {
      toast.error(`Could not start sign-in: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const finishPasted = async () => {
    try {
      const res = await fetch('/api/civitai/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: pasted.trim() }),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string }
      if (!j.ok) throw new Error(j.error ?? 'Could not complete sign-in')
      setPasted('')
      toast.success('Connected to Civitai')
      void refreshStatus()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  /** Confirmed, because it revokes upstream: the tokens are dead the moment
   *  this runs and signing back in means another trip through Civitai's consent
   *  screen. Every other destructive action on this page confirms too. */
  const disconnect = async () => {
    try {
      const res = await fetch('/api/civitai/auth/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error(res.statusText)
      toast.success('Disconnected from Civitai')
    } catch (e) {
      toast.error(`Could not disconnect: ${e instanceof Error ? e.message : String(e)}`)
    }
    void refreshStatus()
  }

  // Entitlements have not answered yet — render nothing rather than flashing the
  // locked state at someone who owns the add-on.
  if (!loaded) return null

  if (locked) {
    return (
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] px-6 py-10 text-center">
        <Lock className="h-6 w-6 text-primary mx-auto mb-3" />
        <h2 className="font-heading font-bold text-lg">
          {pane === 'library' ? 'My Models' : 'The Civitai Browser'} is a Patreon add-on
        </h2>
        <p className="text-sm text-muted-foreground mt-2 mb-4">
          Browse Civitai and manage everything installed, without leaving the studio.
        </p>
        <Button size="sm" onClick={() => { window.location.href = '/add-ons' }}>See add-ons</Button>
      </div>
    )
  }

  // Everything below is the Civitai tab. The library reads local disk and needs
  // no account, so it must not sit behind the connect gate.
  if (pane === 'library') return <LibraryGrid />

  if (connected === null) return null

  if (!connected) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <KeyRound className="h-6 w-6 text-primary mx-auto mb-3" />
        <h2 className="font-heading font-bold text-lg">Connect your Civitai account</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-5 max-w-md mx-auto">
          Sign in with Discord, Google, GitHub or Reddit to browse and download models straight
          into ComfyUI. Raccoon Studio never sees your password.
        </p>
        <Button size="sm" onClick={() => void signIn()}>Sign in with Civitai</Button>

        <details className="mt-6 text-left max-w-xl mx-auto">
          <summary className="text-xs text-muted-foreground cursor-pointer">
            Sign-in did not come back?
          </summary>
          <p className="text-xs text-muted-foreground mt-2">
            On a pod or over your network, Civitai returns you through raccoon-unlock, which sends
            you back here. If that page shows an error instead, copy the address it landed on and
            paste it below.
          </p>
          <div className="flex gap-2 mt-2">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="http://localhost:3000/api/civitai/auth/callback?code=…"
              className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-xs font-mono"
            />
            <Button size="sm" variant="outline" className="h-8" onClick={() => void finishPasted()}>
              Finish
            </Button>
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Connected{username ? ` as ${username}` : ''}
        </span>
        <Button
          size="sm" variant="ghost" className="h-7 text-xs ml-auto"
          onClick={() => setConfirmOff(true)}
        >
          Disconnect
        </Button>
      </div>

      <CivitaiBrowse activeTransfers={activeTransfers} onStarted={onStarted} />

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Disconnect from Civitai?"
        description={
          'This revokes Raccoon Studio’s access on Civitai’s side. Browsing and downloads ' +
          'stop working until you sign in again, which needs another trip through their consent screen.'
        }
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => { setConfirmOff(false); void disconnect() }}
      />
    </div>
  )
}
