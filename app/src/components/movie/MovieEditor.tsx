'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileUp, Magnet, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MovieProject } from '@/types/movie'
import { EditorStoreProvider, useEditorStore } from './editor-store'
import {
  selectCanRedo, selectCanUndo, selectDirty, selectProjectName, selectSaving, selectSnapping,
} from './editor-selectors'
import { useEditorActions } from './editor-actions'
import { useEditorKeyboard } from './useEditorKeyboard'
import { useAutosave } from './useAutosave'
import AssetsPanel from './AssetsPanel'
import ClipPropertiesPanel from './ClipPropertiesPanel'
import ExportDialog from './ExportDialog'
import ExportProjectDialog from './ExportProjectDialog'
import ProgramMonitor from './ProgramMonitor'
import Timeline from './Timeline'

export default function MovieEditor({ project }: { project: MovieProject }) {
  return (
    <EditorStoreProvider project={project}>
      <EditorShell />
    </EditorStoreProvider>
  )
}

function EditorShell() {
  useEditorKeyboard()
  useAutosave()
  const name = useEditorStore(selectProjectName)
  const dirty = useEditorStore(selectDirty)
  const saving = useEditorStore(selectSaving)
  const canUndo = useEditorStore(selectCanUndo)
  const canRedo = useEditorStore(selectCanRedo)
  const snapping = useEditorStore(selectSnapping)
  const projectId = useEditorStore((s) => s.editorModel.projectId)
  const actions = useEditorActions()
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background/80 shrink-0">
        <Button variant="ghost" size="icon-lg" nativeButton={false} render={<Link href="/movie" />} aria-label="Back to projects">
          <ArrowLeft />
        </Button>
        <span className="font-heading font-semibold text-sm truncate">{name}</span>
        <span className="text-xs text-muted-foreground w-16">
          {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon-lg" disabled={!canUndo} onClick={actions.undo} aria-label="Undo">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-lg" disabled={!canRedo} onClick={actions.redo} aria-label="Redo">
            <Redo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={actions.toggleSnapping}
            aria-label="Toggle snapping"
            className={cn(snapping && 'text-primary bg-muted')}
          >
            <Magnet />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button size="lg" variant="outline" onClick={() => setShareOpen(true)}>
            <FileUp data-icon="inline-start" />
            Export project
          </Button>
          <Button size="lg" onClick={() => setExportOpen(true)}>
            <Download data-icon="inline-start" />
            Export video
          </Button>
        </div>
      </div>

      {/* Middle: assets | monitor | properties */}
      <div className="flex flex-1 min-h-0">
        <aside className="w-72 shrink-0 border-r border-border bg-card/40 overflow-hidden">
          <AssetsPanel projectId={projectId} />
        </aside>
        <div className="flex-1 min-w-0">
          <ProgramMonitor />
        </div>
        <aside className="w-72 shrink-0 border-l border-border bg-card/40 overflow-hidden">
          <ClipPropertiesPanel />
        </aside>
      </div>

      {/* Bottom: timeline */}
      <div className="h-[17.5rem] shrink-0 border-t border-border bg-card/40 overflow-hidden">
        <Timeline projectId={projectId} />
      </div>

      <ExportDialog projectId={projectId} open={exportOpen} onOpenChange={setExportOpen} />
      <ExportProjectDialog
        projectId={projectId}
        projectName={name}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}
