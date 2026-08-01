/**
 * Turn a failed model download into a message that names what could not be
 * reached.
 *
 * Node reports a refused or timed-out connection as `connect ETIMEDOUT
 * 75.126.135.131:443` — the IP it dialled, never the host it resolved. For a
 * model download that is the one fact that matters: every URL in the catalogue
 * is HuggingFace, so a support report carrying a bare IP cannot distinguish
 * "HuggingFace is blocked on this network" from a dead link in our catalogue.
 * (Seen 2026-08-01: a user's ETIMEDOUT named a SoftLayer address, while every
 * real HF host is on AWS — their DNS was not returning HuggingFace at all. That
 * took a manual `Resolve-DnsName` to establish, and the message should have
 * said it.)
 *
 * The host reported is whichever hop failed, which is itself worth knowing:
 * `huggingface.co` is the redirect, `us.aws.cdn.hf.co` is where the bytes live,
 * and a network can block one without the other.
 */
export function describeDownloadError(err: unknown, targetUrl: string): string {
  // `address` is on Node's SystemError but not on the ErrnoException type, and
  // it is the IP the bare message would otherwise be the only record of.
  const sysErr = err as { code?: string; address?: string } | null
  const code = sysErr?.code
  const message = err instanceof Error ? err.message : String(err)
  if (!code || !CONNECTION_CODES.has(code)) return message

  let host = 'the download host'
  try { host = new URL(targetUrl).host } catch { /* keep the fallback */ }
  const address = sysErr?.address
  const where = address && address !== host ? ` (${code} connecting to ${address})` : ` (${code})`
  return (
    `Could not reach ${host}${where}. The download link is fine — this machine ` +
    `could not open a connection. A firewall, VPN, or an ISP/region block on ` +
    `${host} is the usual cause.`
  )
}

// Failures to *establish* a connection, as opposed to an HTTP error or a disk
// problem. ENOTFOUND/EAI_AGAIN are DNS and already name the host, but they land
// here too so the advice is attached to them as well.
const CONNECTION_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPROTO',
  'ECONNABORTED',
])
