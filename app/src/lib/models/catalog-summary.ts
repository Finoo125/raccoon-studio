/**
 * The Advanced Models row's status and its ONE size (fixes 2 and 6 of the
 * 2026-10-11 review): ready = every required file is on disk; the size is what
 * is still missing when something required is (downloadable or imported by hand —
 * LTX has two of the latter), else what is on disk. A row made only of extras is
 * ready once any one of them is there. `fetch` = the row indices the button downloads:
 * the missing required files until the row is ready (what the size shows), the extras
 * after — never both at once, so one click never queues 100 GB the row did not mention.
 */
export function rowSummary(rows: { optional?: boolean; sizeMb: number; installed: boolean; downloadable?: boolean }[]) {
  const required = rows.filter((r) => !r.optional)
  const installedRequired = required.filter((r) => r.installed).length
  const ready = required.length > 0 ? installedRequired === required.length : rows.some((r) => r.installed)
  const missingOptional = rows.filter((r) => r.optional && !r.installed).length
  const sizeIsDownload = !ready
  const sizeMb = sizeIsDownload
    ? (required.length > 0 ? required : rows).filter((r) => !r.installed).reduce((n, r) => n + r.sizeMb, 0)
    : rows.filter((r) => r.installed).reduce((n, r) => n + r.sizeMb, 0)
  const wanted = (r: { optional?: boolean }) => required.length === 0 || (ready ? !!r.optional : !r.optional)
  const fetch = rows.flatMap((r, i) => (!r.installed && r.downloadable !== false && wanted(r) ? [i] : []))
  return { ready, installedRequired, required: required.length, missingOptional, sizeMb, sizeIsDownload, fetch }
}
