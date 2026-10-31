/** Browser side of the server's model transfers (see transfers.ts): start some, and read where they stand. */
import type { StarterFile } from './starter'
// Type-only: transfers.ts is server code and this import is erased at build.
import type { Transfer } from './transfers'

/** The server's transfer key (`transferKey` in transfers.ts): folder + file name. */
export const fileKey = (f: { folder: string; name: string }) => `${f.folder}/${f.name}`

export interface DownloadSummary {
  /** Every asked-for file finished without error. */
  done: boolean
  failed: Transfer[]
  receivedBytes: number
  totalBytes: number
  /** At least one file was actually written — only then must the engine restart to see it. */
  wroteAny: boolean
}

/** Where a set of downloads stands. A key with no transfer yet counts as not finished. */
export function summarize(transfers: Transfer[], keys: string[]): DownloadSummary {
  const mine = keys.map((k) => transfers.find((t) => t.key === k))
  const failed = mine.filter((t): t is Transfer => !!t && (t.status === 'error' || t.status === 'cancelled'))
  return {
    done: mine.every((t) => t?.status === 'done'),
    failed,
    receivedBytes: mine.reduce((n, t) => n + (t?.receivedBytes ?? 0), 0),
    totalBytes: mine.reduce((n, t) => n + (t?.totalBytes ?? 0), 0),
    wroteAny: mine.some((t) => t?.status === 'done' && !t.alreadyExists),
  }
}

/** Registers each download with the server (answers at once; the bytes keep moving). Returns their keys. */
export async function startDownloads(files: StarterFile[]): Promise<string[]> {
  for (const f of files) {
    const res = await fetch('/api/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: f.url, path: f.folder, name: f.name }),
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText)
  }
  return files.map(fileKey)
}

export async function fetchTransfers(): Promise<Transfer[]> {
  const res = await fetch('/api/models/download', { cache: 'no-store' })
  return ((await res.json()) as { transfers?: Transfer[] }).transfers ?? []
}
