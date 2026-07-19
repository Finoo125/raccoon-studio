/**
 * Public key used to verify add-on unlock keys. The matching keypair and the
 * minting tool live in the separate, private creator-only repo
 * (Finoo125/raccoon-studio-keys); run `node make-addon-key.mjs --init` there and
 * paste the printed PUBLIC key below (or override at runtime with the
 * ADDON_PUBLIC_KEY env var). The PRIVATE key is never committed to this repo.
 *
 * Until you run --init this is empty; verifyKey then rejects every key, so all
 * add-ons stay locked (safe default).
 */
const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0nbGzFWnuEPPlVizqHWYcDIOJ/FoXLyKnoZb2bZeotc=
-----END PUBLIC KEY-----`

export const ADDON_PUBLIC_KEY: string = process.env.ADDON_PUBLIC_KEY ?? EMBEDDED_PUBLIC_KEY

/** Issued-to ("sub") values to refuse even with a valid signature. */
export const REVOKED_SUBS: string[] = []
