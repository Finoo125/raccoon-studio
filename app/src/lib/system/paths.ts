import path from 'path'

/**
 * Project root = the directory that contains the `app/` folder (one level above
 * the Next.js cwd). Logs and starter scripts live here, beside `comfyui/`.
 */
export function getProjectRoot(): string {
  return path.resolve(process.cwd(), '..')
}

/** Where application + ComfyUI logs are written. */
export function getLogsDir(): string {
  return process.env.RACCOON_LOGS_DIR ?? path.join(getProjectRoot(), 'logs')
}

/** Where the app's own persisted JSON (settings, queue history, etc.) lives. */
export function getDataDir(): string {
  return process.env.RACCOON_DATA_DIR ?? path.join(getProjectRoot(), 'data')
}

/**
 * Roots a path is allowed to point inside before we'll hand it to the OS file
 * manager. Keeps the open-folder endpoint from being a "reveal any path" hole.
 */
export function getAllowedRoots(): string[] {
  return [
    process.env.COMFYUI_OUTPUT_DIR,
    process.env.COMFYUI_MODELS_DIR,
    getLogsDir(),
    getDataDir(),
    getProjectRoot(),
  ].filter((p): p is string => !!p).map((p) => path.resolve(p))
}

/** True when `target` resolves to a location inside one of the allowed roots. */
export function isInsideAllowedRoot(target: string): boolean {
  const resolved = path.resolve(target)
  return getAllowedRoots().some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  )
}
