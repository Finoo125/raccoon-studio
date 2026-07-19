'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { AlertTriangle, Play, Square, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useConnectionStore } from '@/lib/comfyui/connection'

type Status = 'checking' | 'online' | 'offline' | 'starting' | 'restarting' | 'updating'

// Per-status chip styling for the segmented control.
const STATUS_DISPLAY: Record<Status, { text: string; label: string; dot?: string }> = {
  checking:   { text: 'text-muted-foreground', label: '…' },
  online:     { text: 'text-green-500',   label: 'Online',      dot: 'bg-green-500' },
  offline:    { text: 'text-destructive', label: 'Offline',     dot: 'bg-destructive' },
  starting:   { text: 'text-amber-500',   label: 'Starting…' },
  restarting: { text: 'text-sky-500',     label: 'Restarting…' },
  updating:   { text: 'text-sky-500',     label: 'Updating…' },
}

interface DetectResult {
  url: string | null
  online: boolean
  phase: 'idle' | 'starting' | 'updating' | 'restarting' | 'error'
  phaseMessage: string | null
  updateAvailable: boolean | null
  hasStartScript: boolean
  hasPid: boolean
  hasComfyUIDir: boolean
}

export default function ComfyUIStatus({ className }: { className?: string }) {
  const [status, setStatus] = useState<Status>('checking')
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null)
  const [hasStartScript, setHasStartScript] = useState(false)
  const [hasPid, setHasPid] = useState(false)
  const [hasComfyUIDir, setHasComfyUIDir] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'start' | 'stop' | 'update' | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const { setWsBase } = useConnectionStore()
  const prevStatusRef = useRef<Status>('checking')
  const logEndRef = useRef<HTMLDivElement>(null)
  // Poll cadence: relaxed while idle, faster while booting/updating ComfyUI.
  const IDLE_POLL_MS = 30000
  const BOOT_POLL_MS = 3000
  const phaseActive = status === 'starting' || status === 'restarting' || status === 'updating'
  const pollMs = phaseActive ? BOOT_POLL_MS : IDLE_POLL_MS

  const transition = useCallback((next: Status) => {
    const prev = prevStatusRef.current
    if (next === 'online' && (prev === 'starting' || prev === 'restarting' || prev === 'updating')) {
      // auto-collapse logs 2s after coming online
      window.setTimeout(() => setLogsOpen(false), 2000)
    }
    prevStatusRef.current = next
    setStatus(next)
  }, [])

  const detect = useCallback(async () => {
    try {
      const r = await fetch('/api/comfyui-control/detect', { cache: 'no-store' })
      const d = (await r.json()) as DetectResult
      setHasStartScript(d.hasStartScript)
      setHasPid(d.hasPid)
      setHasComfyUIDir(d.hasComfyUIDir)
      setUpdateAvailable(d.updateAvailable)
      setPhaseMessage(d.phaseMessage)
      if (d.online && d.url) setWsBase(d.url)
      // The server tracks the lifecycle phase, so a reload mid-boot or
      // mid-update lands back in the right state instead of online/offline.
      if (d.phase === 'updating') transition('updating')
      else if (d.phase === 'restarting') transition('restarting')
      else if (d.phase === 'starting') transition('starting')
      else transition(d.online ? 'online' : 'offline')
    } catch {
      // Our own API is unreachable — keep the current state, except on first
      // load where we'd otherwise render nothing forever.
      if (prevStatusRef.current === 'checking') transition('offline')
    }
  }, [setWsBase, transition])

  // Visibility-aware polling: pause when the tab is hidden — but only while
  // idle. During start/update/restart we keep polling regardless, otherwise
  // switching away mid-update freezes the UI at "Updating…" until the user
  // comes back. Catch up immediately when the tab becomes visible again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null }
    }
    const start = () => {
      stop()
      timer = setInterval(() => void detect(), pollMs)
    }
    const shouldPoll = () => phaseActive || document.visibilityState === 'visible'
    const onVisibility = () => {
      if (shouldPoll()) {
        void detect()
        start()
      } else {
        stop()
      }
    }

    // Initial check on mount; detect() awaits before any setState, so this is
    // not a synchronous render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detect()
    if (shouldPoll()) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [detect, pollMs, phaseActive])

  // Follow the server boot/update log over SSE while something is in flight.
  // No onerror handler: EventSource auto-reconnects on its own, and the logs
  // route replays recent lines on (re)connect, so transient drops heal — the
  // onopen reset keeps the replay from duplicating lines already shown.
  useEffect(() => {
    if (status !== 'starting' && status !== 'restarting' && status !== 'updating') return
    const es = new EventSource('/api/comfyui-control/logs')
    es.onopen = () => setLogLines([])
    es.onmessage = (e) => {
      const line = JSON.parse(e.data as string) as string
      setLogLines((prev) => [...prev.slice(-299), line])
      // Surface failures prominently — the collapsible log panel is easy to miss.
      if (line.startsWith('[error]')) {
        toast.error(line.replace(/^\[error\]\s*/, ''))
      } else if (line.includes('Update reported errors')) {
        toast.warning('ComfyUI update reported errors — check the update log')
      }
    }
    return () => es.close()
  }, [status])

  // Scroll log to bottom on new lines
  useEffect(() => {
    if (logsOpen) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines, logsOpen])

  const handleStart = async () => {
    setBusy('start')
    setLogLines([])
    setLogsOpen(true)
    try {
      const res = await fetch('/api/comfyui-control/start', { method: 'POST' })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: 'Start failed' }))) as { error?: string }
        setLogLines((prev) => [...prev, `[error] ${error ?? 'Start failed'}`])
        toast.error(error ?? 'Start failed')
        await detect()
        return
      }
      transition('starting')
    } catch {
      transition('offline')
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async () => {
    if (!confirm('Stop ComfyUI? Any running jobs will be cancelled.')) return
    setBusy('stop')
    try {
      // The server kills the whole process group and only answers once the
      // process is actually gone (or escalation failed) — may take a few seconds.
      const res = await fetch('/api/comfyui-control/stop', { method: 'POST' })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: 'Stop failed' }))) as { error?: string }
        setLogLines((prev) => [...prev, `[error] ${error ?? 'Stop failed'}`])
        setLogsOpen(true)
      } else {
        setLogsOpen(false)
        setLogLines([])
      }
    } catch {
      // fall through to re-detect
    } finally {
      // No optimistic state — ask the server what actually happened.
      await detect()
      setBusy(null)
    }
  }

  const handleUpdate = async () => {
    if (!confirm('Update ComfyUI now? This stops ComfyUI, runs ComfyUI-Manager "update all", then restarts it.')) return
    setBusy('update')
    setLogLines([])
    setLogsOpen(true)
    try {
      const res = await fetch('/api/comfyui-control/update', { method: 'POST' })
      if (!res.ok) {
        // e.g. 409 while a previous update/restart is still in flight — show
        // the reason and let detect report the real state, don't paint offline.
        const { error } = (await res.json().catch(() => ({ error: 'Update failed' }))) as { error?: string }
        setLogLines((prev) => [...prev, `[error] ${error ?? 'Update failed'}`])
        toast.error(error ?? 'Update failed')
        await detect()
        return
      }
      transition('updating')
    } catch {
      transition('offline')
    } finally {
      setBusy(null)
    }
  }

  if (status === 'checking') return null

  // Dedicated controls sit to the LEFT of the status pill and are always present
  // so the user can drive the ComfyUI instance regardless of the current state.
  const canStart = status === 'offline' && hasStartScript && busy === null
  const canStop = hasPid && (status === 'online' || status === 'starting' || status === 'restarting') && busy === null
  // Only offer the Update button when the server-side git check actually
  // found ComfyUI core or a custom node behind its upstream.
  const showUpdate = hasComfyUIDir && updateAvailable === true

  const isTransitional = status === 'starting' || status === 'restarting' || status === 'updating'
  const sd = STATUS_DISPLAY[status]

  return (
    <div className={cn('relative', className)}>
      {/* One segmented control: status chip + contextual Start/Stop + Update */}
      <div className="inline-flex items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-card/60 text-xs">
        <span
          className={cn('flex items-center gap-1.5 px-2.5 py-1.5 font-medium', sd.text)}
          title={status === 'offline' ? (phaseMessage ?? undefined) : undefined}
        >
          {isTransitional ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          ) : status === 'offline' ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sd.dot)} />
          )}
          <span className="hidden lg:inline">{sd.label}</span>
        </span>

        {canStart && (
          <button
            onClick={() => void handleStart()}
            disabled={!canStart}
            className="flex items-center gap-1 px-2.5 py-1.5 font-medium transition-colors hover:bg-muted disabled:opacity-40"
            title={hasStartScript ? 'Start ComfyUI' : 'COMFYUI_START_SCRIPT not configured'}
          >
            <Play className="h-3 w-3" />
            <span className="hidden lg:inline">Start</span>
          </button>
        )}

        {(canStop || busy === 'stop') && (
          <button
            onClick={() => void handleStop()}
            disabled={!canStop && busy !== 'stop'}
            className="flex items-center gap-1 px-2.5 py-1.5 font-medium transition-colors hover:bg-muted disabled:opacity-40"
            title="Stop ComfyUI"
          >
            {busy === 'stop' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            <span className="hidden lg:inline">Stop</span>
          </button>
        )}

        {showUpdate && (
          <button
            onClick={() => void handleUpdate()}
            disabled={busy !== null}
            className="flex items-center gap-1 px-2.5 py-1.5 font-medium text-action transition-colors hover:bg-muted disabled:opacity-40"
            title="Update ComfyUI (ComfyUI-Manager: update all + restart)"
          >
            <RefreshCw className="h-3 w-3" />
            <span className="hidden xl:inline">Update</span>
          </button>
        )}

        {isTransitional && (
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="flex items-center px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted"
            title="Toggle log"
          >
            {logsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* ── Boot/update log panel — floats as overlay, never affects layout ── */}
      {logsOpen && logLines.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-md border border-border bg-black/95 text-[10px] font-mono leading-relaxed text-green-400 px-2 py-1.5 h-48 overflow-y-auto shadow-lg">
          {logLines.map((line, i) => (
            <div key={i} className="break-all whitespace-pre-wrap">{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  )
}
