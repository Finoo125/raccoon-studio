/**
 * True when the studio is served from a hosted pod rather than the user's own
 * machine. Set by `runpod/entrypoint.sh`; absent on every desktop install, so
 * the desktop behaviour is unchanged by construction rather than by a check
 * someone has to remember.
 *
 * What it turns off is anything that acts on the *server's* desktop, because
 * there isn't one: a hosted pod is a headless container, and "open containing
 * folder" there spawns a file manager into the void. Things that merely manage
 * the install — Start/Stop/Repair — still work on a pod and stay.
 *
 * **Read it at build time too.** In the App Router `process.env` is only
 * evaluated per request while a route renders *dynamically*; a statically
 * rendered layout bakes the value in at `next build`. Rather than force the
 * whole app dynamic for one boolean, `runpod/boot.sh` exports this before it
 * builds, so the flag is right whichever way Next resolves it. Route handlers
 * are always dynamic and read it live.
 */
export const isKiosk = (): boolean => process.env.RACCOON_KIOSK === '1'
