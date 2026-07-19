'use client'

import { Wrench } from 'lucide-react'
import FaceModelBuilder from '@/components/tools/FaceModelBuilder'
import BackupRestore from '@/components/tools/BackupRestore'

export default function ToolsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
            <Wrench className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight leading-none">Tools</h1>
            <p className="text-sm text-muted-foreground mt-1.5">Niche utilities that support the studio</p>
          </div>
        </header>

        <FaceModelBuilder />
        <BackupRestore />
      </div>
    </div>
  )
}
