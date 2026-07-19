'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

/** Dialog for downloading a project as a shareable .rsmovie bundle. */
export default function ExportProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [includeMedia, setIncludeMedia] = useState(true)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export project “{projectName}”</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Downloads a <code>.rsmovie</code> file you can import on any Raccoon Studio instance.
        </p>
        <Label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(e) => setIncludeMedia(e.target.checked)}
            className="size-4 accent-primary"
          />
          Include media files
        </Label>
        {!includeMedia && (
          <p className="text-xs text-muted-foreground">
            Without media, the other instance needs the same files on disk — missing ones
            appear offline.
          </p>
        )}
        <DialogFooter>
          <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            size="lg"
            nativeButton={false}
            render={
              <a
                href={`/api/movies/${projectId}/bundle?media=${includeMedia ? 1 : 0}`}
                download
              />
            }
            onClick={() => onOpenChange(false)}
          >
            <Download data-icon="inline-start" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
