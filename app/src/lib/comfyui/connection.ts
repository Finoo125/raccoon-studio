'use client'

import { create } from 'zustand'

interface ConnectionState {
  wsBase: string
  setWsBase(url: string): void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  wsBase: 'ws://127.0.0.1:8188',
  setWsBase(url) {
    set({ wsBase: url.replace(/^http/, 'ws') })
  },
}))
