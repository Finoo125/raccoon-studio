'use client'

import { Suspense, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import GenerationForm from '@/components/generation/GenerationForm'
import StudioCanvas from '@/components/generation/StudioCanvas'
import RecentRail from '@/components/generation/RecentRail'
import GenerateInspector from '@/components/generation/GenerateInspector'

export default function GeneratePage() {
  const [panelOpen, setPanelOpen] = useState(true)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left controls panel */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.aside
              key="panel"
              initial={{ width: '0rem', opacity: 0 }}
              animate={{ width: '37.5rem', opacity: 1 }}
              exit={{ width: '0rem', opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeInOut' }}
              className="border-r border-border bg-card overflow-hidden shrink-0"
            >
              <div className="w-[37.5rem] h-full overflow-y-auto p-5">
                <Suspense fallback={null}>
                  <GenerationForm />
                </Suspense>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Panel toggle — full-height divider rail with grip */}
        <button
          className="group relative w-6 shrink-0 flex flex-col items-center justify-center gap-3 border-r border-border bg-card/40 hover:bg-muted/60 transition-colors"
          onClick={() => setPanelOpen((v) => !v)}
          title={panelOpen ? 'Hide controls' : 'Show controls'}
          aria-label={panelOpen ? 'Hide controls' : 'Show controls'}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:text-primary">
            {panelOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          {!panelOpen && (
            <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground transition-colors group-hover:text-foreground">
              Controls
            </span>
          )}
          {/* Grip dots */}
          <span className="absolute bottom-3 flex flex-col gap-0.5 opacity-40 group-hover:opacity-70 transition-opacity">
            <span className="h-0.5 w-0.5 rounded-full bg-current" />
            <span className="h-0.5 w-0.5 rounded-full bg-current" />
            <span className="h-0.5 w-0.5 rounded-full bg-current" />
          </span>
        </button>

        {/* Canvas */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <StudioCanvas />
        </div>

        {/* Recent images rail */}
        <RecentRail />
      </div>

      {/* Inspector modal (opens when a rail thumbnail is clicked) */}
      <GenerateInspector />
    </div>
  )
}
