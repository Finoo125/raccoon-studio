export async function register() {
  // Kick off the ComfyUI update-availability check once at server startup so
  // the header's Update button is correctly shown/hidden from the first page
  // load (detect polls keep it fresh afterwards).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { maybeRefreshUpdateCheck } = await import('@/lib/comfyui/update-check')
    maybeRefreshUpdateCheck()
  }
}
