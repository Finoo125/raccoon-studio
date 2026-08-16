'use client'

import { create } from 'zustand'

interface ConnectionState {
  wsBase: string
  setWsBase(url: string): void
}

/**
 * Where the *browser* should open ComfyUI's WebSocket.
 *
 * The argument comes from /api/comfyui-control/detect, which is a **server-side**
 * view: it reports 127.0.0.1:8188 no matter where the browser is. That is right
 * when the browser is on the same machine and wrong everywhere else — opened
 * from another machine on the LAN, or from a RunPod pod, the browser dials
 * *its own* loopback, so live previews, generation progress and the Crystools
 * meters silently never arrive (and worse, could attach to a different ComfyUI
 * running on the viewer's box). HTTP is unaffected because it goes through the
 * Next proxy, which is why this reads as "ComfyUI is broken" rather than as a
 * URL bug.
 *
 * Anything non-local therefore goes same-origin, at the path the RunPod proxy
 * publishes. A Next route handler cannot upgrade a WebSocket, so same-origin
 * only works when something that can sits in front — the pod's proxy does; a
 * desktop install reached over the LAN does not, and there it fails visibly
 * instead of connecting to the wrong machine.
 */
export const resolveWsBase = (detected: string, loc?: { protocol: string; hostname: string; host: string }): string => {
  const l = loc ?? (typeof location === 'undefined' ? null : location)
  const toWs = (u: string) => u.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws'
  if (!l) return toWs(detected)
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(l.hostname)) return toWs(detected)
  return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/comfy-ws`
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  wsBase: 'ws://127.0.0.1:8188/ws',
  setWsBase(url) {
    set({ wsBase: resolveWsBase(url) })
  },
}))
