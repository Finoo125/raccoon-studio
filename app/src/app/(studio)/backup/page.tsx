'use client'

import { Archive } from 'lucide-react'
import BackupRestore from '@/components/tools/BackupRestore'

export default function BackupPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
            <Archive className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight leading-none">Backup &amp; Restore</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Your gallery, movie projects, favorites and tags, saved face models, settings and your
              prompt presets &amp; wildcards — one file, and all of it back after a reinstall
            </p>
          </div>
        </header>

        <BackupRestore />
      </div>
    </div>
  )
}
