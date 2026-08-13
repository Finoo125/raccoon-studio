/**
 * Tracks model-file transfers — catalogue downloads and local imports alike —
 * so the "restart ComfyUI" prompt fires **once**, when the last one settles.
 *
 * ComfyUI scans its model folders only at startup, so anything that just landed
 * stays invisible until it restarts. Asking per file would mean eight dialogs
 * after a bulk download; asking when nothing new landed (every file already on
 * disk, or the only transfer was cancelled) would be noise.
 */
export function createTransferTracker(onSettled: () => void) {
  let pending = 0
  let landed = false
  return {
    /** A transfer started. */
    begin() { pending++ },
    /** A transfer finished; `wroteFile` is false for a cancel, an error, or a
     *  file that was already on disk. */
    end(wroteFile: boolean) {
      if (wroteFile) landed = true
      // Clamped: a stray end must not push the count negative, which would
      // swallow the prompt for every transfer after it.
      pending = Math.max(0, pending - 1)
      if (pending === 0 && landed) {
        landed = false
        onSettled()
      }
    },
  }
}
