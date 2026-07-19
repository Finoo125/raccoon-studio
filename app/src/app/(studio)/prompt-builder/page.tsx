'use client'

import { Suspense } from 'react'
import PromptBuilder from '@/components/prompt-builder/PromptBuilder'
import AddonGuard from '@/components/addons/AddonGuard'

export default function PromptBuilderPage() {
  return (
    <AddonGuard featureId="prompt-builder">
      <Suspense fallback={null}>
        <PromptBuilder />
      </Suspense>
    </AddonGuard>
  )
}
