'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useEditorStore } from './editor-store'
import { selectProjectName, selectSettings } from './editor-selectors'

interface ExportJob {
  status: 'running' | 'done' | 'error'
  progress: number
  outputPath: string
  error?: string
}

export default function ExportDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useEditorStore(selectSettings)
  const projectName = useEditorStore(selectProjectName)
  const [width, setWidth] = useState(settings.width)
  const [height, setHeight] = useState(settings.height)
  const [fps, setFps] = useState(settings.fps)
  const [filename, setFilename] = useState(projectName)
  const [job, setJob] = useState<ExportJob | null>(null)
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/movies/${projectId}/export`, { cache: 'no-store' })
          const data = (await res.json()) as { job: ExportJob | null }
          if (!data.job) return
          setJob(data.job)
          if (data.job.status === 'done') {
            setPolling(false)
            toast.success(`Movie exported to ${data.job.outputPath}`)
          } else if (data.job.status === 'error') {
            setPolling(false)
          }
        } catch { /* keep polling */ }
      })()
    }, 1000)
    return () => clearInterval(id)
  }, [polling, projectId])

  const start = async () => {
    try {
      const res = await fetch(`/api/movies/${projectId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: { width, height, fps, filename } }),
      })
      const data = (await res.json()) as { job?: ExportJob; error?: string }
      if (!res.ok || !data.job) {
        toast.error(data.error ?? 'Failed to start export')
        return
      }
      setJob(data.job)
      setPolling(true)
    } catch {
      toast.error('Failed to start export')
    }
  }

  const running = job?.status === 'running'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="export-width" className="text-[10px] text-muted-foreground">Width</Label>
            <Input
              id="export-width" type="number" min={16} step={2} value={width}
              onChange={(e) => setWidth(Number(e.target.value))} disabled={running}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="export-height" className="text-[10px] text-muted-foreground">Height</Label>
            <Input
              id="export-height" type="number" min={16} step={2} value={height}
              onChange={(e) => setHeight(Number(e.target.value))} disabled={running}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="export-fps" className="text-[10px] text-muted-foreground">FPS</Label>
            <Input
              id="export-fps" type="number" min={1} max={120} value={fps}
              onChange={(e) => setFps(Number(e.target.value))} disabled={running}
            />
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="export-filename" className="text-[10px] text-muted-foreground">Filename</Label>
          <Input
            id="export-filename" value={filename}
            onChange={(e) => setFilename(e.target.value)} disabled={running}
          />
        </div>

        {job && (
          <div className="grid gap-2">
            <Progress value={Math.round(job.progress * 100)} />
            {job.status === 'done' && (
              <p className="text-xs text-muted-foreground break-all">
                Saved to {job.outputPath}
              </p>
            )}
            {job.status === 'error' && (
              <pre className="text-[10px] text-destructive bg-destructive/10 rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                {job.error ?? 'Export failed'}
              </pre>
            )}
          </div>
        )}

        <DialogFooter>
          <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button size="lg" onClick={() => void start()} disabled={running || !filename.trim()}>
            {running ? 'Exporting…' : 'Start export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
