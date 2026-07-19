'use client'

import { Search, Heart, RefreshCw, FolderOpen, X, PanelLeft, Images, Clapperboard, CheckSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGalleryStore } from '@/lib/gallery/store'

interface Props {
  onRefresh: () => void
  loading: boolean
}

export default function GalleryToolbar({ onRefresh, loading }: Props) {
  const { filters, setFilter, images, imagesDir, scannedAt, sidebarCollapsed, toggleSidebar, mediaMode, setMediaMode, selecting, setSelecting } =
    useGalleryStore()

  const hasDateFilter = !!filters.dateFrom || !!filters.dateTo

  const distinct = (vals: (string | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort()
  const allTags = distinct(images.flatMap((i) => i.tags ?? []))
  const allModels = distinct(images.map((i) => i.metadata.model))
  const allSamplers = distinct(images.map((i) => i.metadata.sampler))
  const allDims = distinct(images.map((i) => (i.metadata.width && i.metadata.height ? `${i.metadata.width}x${i.metadata.height}` : undefined)))

  const openImagesFolder = async () => {
    if (!imagesDir) {
      toast.error('Images folder is not configured')
      return
    }
    const res = await fetch('/api/system/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: imagesDir }),
    })
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: 'Failed' }))) as { error?: string }
      toast.error(error ?? 'Could not open folder')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
      {/* Folder sidebar toggle */}
      <Button
        variant={sidebarCollapsed ? 'outline' : 'default'}
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Show folders' : 'Hide folders'}
        aria-label={sidebarCollapsed ? 'Show folders' : 'Hide folders'}
      >
        <PanelLeft className="h-3.5 w-3.5" />
      </Button>

      {/* Multi-select toggle */}
      <Button
        variant={selecting ? 'default' : 'outline'}
        size="sm"
        className="h-8 px-3 gap-1.5 shrink-0"
        onClick={() => setSelecting(!selecting)}
        title="Toggle multi-select"
      >
        <CheckSquare className="h-3.5 w-3.5" /> Select
      </Button>

      {/* Images / Videos mode toggle */}
      <div className="flex shrink-0 rounded-md border border-border p-0.5">
        <button
          onClick={() => setMediaMode('image')}
          className={`flex items-center gap-1.5 rounded px-2.5 h-7 text-xs font-medium transition-colors ${
            mediaMode === 'image' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={mediaMode === 'image'}
        >
          <Images className="h-3.5 w-3.5" /> Images
        </button>
        <button
          onClick={() => setMediaMode('video')}
          className={`flex items-center gap-1.5 rounded px-2.5 h-7 text-xs font-medium transition-colors ${
            mediaMode === 'video' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={mediaMode === 'video'}
        >
          <Clapperboard className="h-3.5 w-3.5" /> Videos
        </button>
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search prompts, seeds, models…"
          className="pl-8 h-8 text-sm"
          value={filters.search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter('search', e.target.value ?? '')}
        />
      </div>

      {/* Workflow filter — image presets only; videos are all LTX23 for now */}
      {mediaMode === 'image' && (
        <Select value={filters.workflow || 'all'} onValueChange={(v) => setFilter('workflow', (v ?? '') === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="All presets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All presets</SelectItem>
            <SelectItem value="Anima">Anima</SelectItem>
            <SelectItem value="ERNIE">Ernie Turbo</SelectItem>
            <SelectItem value="ZIT">Z Image Turbo</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Metadata + tag filters — only shown when there are values to pick */}
      {allTags.length > 0 && (
        <FilterSelect value={filters.tag} onChange={(v) => setFilter('tag', v)} placeholder="All tags" options={allTags} />
      )}
      {allModels.length > 0 && (
        <FilterSelect value={filters.model} onChange={(v) => setFilter('model', v)} placeholder="All models" options={allModels} />
      )}
      {allSamplers.length > 0 && (
        <FilterSelect value={filters.sampler} onChange={(v) => setFilter('sampler', v)} placeholder="All samplers" options={allSamplers} />
      )}
      {allDims.length > 0 && (
        <FilterSelect value={filters.dimensions} onChange={(v) => setFilter('dimensions', v)} placeholder="All sizes" options={allDims} />
      )}

      {/* Date range filter */}
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 h-8">
        <span className="text-xs text-muted-foreground">From</span>
        <input
          type="date"
          value={filters.dateFrom}
          max={filters.dateTo || undefined}
          onChange={(e) => setFilter('dateFrom', e.target.value)}
          className="bg-transparent text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={filters.dateTo}
          min={filters.dateFrom || undefined}
          onChange={(e) => setFilter('dateTo', e.target.value)}
          className="bg-transparent text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
        {hasDateFilter && (
          <button
            onClick={() => { setFilter('dateFrom', ''); setFilter('dateTo', '') }}
            className="text-muted-foreground hover:text-foreground"
            title="Clear dates"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sort */}
      <Select value={filters.sortBy} onValueChange={(v) => setFilter('sortBy', v as typeof filters.sortBy)}>
        <SelectTrigger className="h-8 w-32 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="oldest">Oldest</SelectItem>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="random">Random</SelectItem>
        </SelectContent>
      </Select>

      {/* Favorites toggle */}
      <Button
        variant={filters.favoritesOnly ? 'default' : 'outline'}
        size="sm"
        className="h-8 px-3"
        onClick={() => setFilter('favoritesOnly', !filters.favoritesOnly)}
      >
        <Heart className={`h-3.5 w-3.5 mr-1.5 ${filters.favoritesOnly ? 'fill-current' : ''}`} />
        Favorites
      </Button>

      {/* Open images folder */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3 gap-1.5"
        onClick={() => void openImagesFolder()}
        title="Open the images folder"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Folder
      </Button>

      {/* Update / rescan */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3 gap-1.5"
        onClick={onRefresh}
        disabled={loading}
        title="Scan for new images now"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        Update
      </Button>

      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
        {images.length} {mediaMode === 'video' ? 'videos' : 'images'}
        {scannedAt && (
          <span className="hidden lg:inline"> · scanned {new Date(scannedAt).toLocaleTimeString()}</span>
        )}
      </span>
    </div>
  )
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[]
}) {
  return (
    <Select value={value || 'all'} onValueChange={(v) => onChange((v ?? '') === 'all' ? '' : (v ?? ''))}>
      <SelectTrigger className="h-8 w-32 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
