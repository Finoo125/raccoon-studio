'use client'

import { useCallback, useReducer, useRef, useState } from 'react'
import {
  parseSseBuffer,
  enhanceReducer,
  initialEnhanceState,
  type EnhanceState,
} from './cinematic'

const ENHANCE_URL = '/api/comfyui/rvn/generate_stream'
const KILL_URL = '/api/comfyui/rvn/kill'
const BACKEND_URL = '/api/comfyui/rvn/set_backend'

/** The controls an enhance/refine call carries (camelCase app-side). */
export interface EnhanceArgs {
  /** Ollama model name. */
  model: string
  /**
   * The task the doctrine writes for — not always the mode the user picked.
   * `fl2v`/`l2v` are H3's first-and-last-frame and last-frame tasks, derived by
   * `h3Task` from which image slots are filled. A node-side doctrine that has
   * never heard of a tag falls through to t2v, so this can grow safely.
   */
  videoMode: 't2v' | 'i2v' | 'fl2v' | 'l2v' | 'ref2v' | 'director'
  /**
   * What the vision pass gets to look at. One image for i2v; in Director mode a
   * list — every shot's picture, in play order — because the brief describes a
   * whole timeline and one frame of it anchors nothing.
   */
  imageB64: string | string[]
  /**
   * Reference mode only: how many of each reference type are attached. The H3
   * ref2va doctrine names exactly these and no others — told about a type that
   * is not there, the model invents a role for a reference H3 never receives.
   */
  refCounts?: { images: number; videos: number; audios: number }
  environment: string
  scenario: string
  camera: string
  music: string
  pov: boolean
  povGender: 'female' | 'male'
  dialogueTier: 'none' | 'standard' | 'talkative'
  energy: number
  userIntent: string
  durationS: number
  /**
   * Which video workflow the prompt is for. Selects the doctrine server-side
   * (`generation_core.doctrine_for`): 'minimax-h3' gets H3's Base multi-shot
   * format, anything else keeps the LTX shot-script brain.
   */
  videoModel?: string
}

/** Map the app-side args to the node route's snake_case body. */
function toBody(args: EnhanceArgs): Record<string, unknown> {
  return {
    model_file: 'None',
    mmproj_file: 'None (text-only)',
    video_mode: args.videoMode,
    image_b64: args.imageB64,
    ref_counts: args.refCounts,
    environment: args.environment,
    scenario: args.scenario,
    camera_move: args.camera,
    music: args.music,
    pov: args.pov,
    pov_gender: args.povGender,
    dialogue_tier: args.dialogueTier,
    intensity: args.energy,
    user_intent: args.userIntent,
    duration_s: args.durationS,
    video_model: args.videoModel,
  }
}

export interface UseCinematicEnhance extends EnhanceState {
  isStreaming: boolean
  enhance: (args: EnhanceArgs) => void
  refine: (args: EnhanceArgs, instruction: string, previousPrompt: string) => void
  stop: () => void
  kill: () => Promise<void>
}

export function useCinematicEnhance(): UseCinematicEnhance {
  const [state, dispatch] = useReducer(enhanceReducer, initialEnhanceState)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback((body: Record<string, unknown>, model: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    dispatch({ type: 'reset' })
    setIsStreaming(true)

    ;(async () => {
      try {
        // Point the node at the app's Ollama before generating. Best-effort:
        // a failure here surfaces as an error on the stream call right after.
        try {
          const res = await fetch('/api/settings').then((r) => r.json())
          await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              backend: 'Ollama',
              server_url: res?.settings?.ollamaBaseUrl ?? 'http://127.0.0.1:11434',
              remote_model: model,
            }),
            signal: ac.signal,
          })
        } catch {
          /* handled by the stream call below */
        }

        const res = await fetch(ENHANCE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          dispatch({ type: 'error', msg: `Enhance failed (HTTP ${res.status})` })
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = parseSseBuffer(buffer)
          buffer = rest
          for (const ev of events) {
            dispatch(ev)
            if (ev.type === 'done' || ev.type === 'error') {
              reader.cancel()
              return
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          dispatch({ type: 'error', msg: e instanceof Error ? e.message : String(e) })
        }
      } finally {
        setIsStreaming(false)
        if (abortRef.current === ac) abortRef.current = null
      }
    })()
  }, [])

  const enhance = useCallback((args: EnhanceArgs) => {
    run(toBody(args), args.model)
  }, [run])

  const refine = useCallback((args: EnhanceArgs, instruction: string, previousPrompt: string) => {
    // The node's refine contract: the instruction rides in user_intent, the
    // prompt being revised in prior_prompt.
    run({ ...toBody(args), user_intent: instruction, refine: true, prior_prompt: previousPrompt }, args.model)
  }, [run])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const kill = useCallback(async () => {
    abortRef.current?.abort()
    try {
      await fetch(KILL_URL, { method: 'POST' })
    } catch {
      /* best-effort unload */
    }
  }, [])

  return { ...state, isStreaming, enhance, refine, stop, kill }
}
