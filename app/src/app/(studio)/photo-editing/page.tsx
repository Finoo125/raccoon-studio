'use client'

import { Suspense } from 'react'
import PhotoEditor from '@/components/photo-edit/PhotoEditor'
import AddonGuard from '@/components/addons/AddonGuard'

export default function PhotoEditingPage() {
  return (
    <AddonGuard featureId="photo-editor">
      <Suspense fallback={null}>
        <PhotoEditor />
      </Suspense>
    </AddonGuard>
  )
}
