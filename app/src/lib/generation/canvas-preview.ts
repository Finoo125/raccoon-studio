/**
 * Stable `AnimatePresence` key for the studio image canvas.
 *
 * Live sampling previews ("the noise") arrive as a stream of frames, each a
 * brand-new `URL.createObjectURL` blob URL. If the canvas keys its animated
 * child on that URL, every frame remounts the element and replays the entrance
 * spring — so under `mode="wait"` the frames can't keep up and the noise
 * flickers or never becomes visible (worst on fast generations). The video
 * canvas already avoids this by using a constant key while previewing.
 *
 * Return a constant key while the displayed media IS the live preview, so the
 * `<img src>` updates in place; key on the URL only for the settled result, so
 * its entrance animation plays exactly once.
 */
export function canvasMediaKey(
  displayUrl: string | undefined,
  livePreviewUrl: string | undefined,
): string {
  if (!displayUrl) return 'placeholder'
  if (livePreviewUrl && displayUrl === livePreviewUrl) return 'live-preview'
  return displayUrl
}
