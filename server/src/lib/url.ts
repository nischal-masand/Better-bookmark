import crypto from 'node:crypto'

const TRACKING_PARAMS =
  /^(utm_|ga_|mc_|pk_|hsa_|_hs|fbclid$|gclid$|gbraid$|wbraid$|msclkid$|mkt_tok$|igshid$|ref_src$|vero_)/i

/** Only these ever get fetched or rendered as links. */
export function isWebUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw)
}

/**
 * Canonical form used for duplicate detection and for re-attaching app data to a
 * bookmark that was deleted and re-added in Chrome (which assigns a fresh guid).
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
    }
    u.searchParams.sort()
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    let out = u.toString()
    if (out.endsWith('?')) out = out.slice(0, -1)
    if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
    return out
  } catch {
    return raw.trim()
  }
}

export function urlHash(raw: string): string {
  return crypto.createHash('sha1').update(normalizeUrl(raw)).digest('hex')
}

/** Display domain: hostname minus a leading www. Falls back to the scheme for chrome:// etc. */
export function domainOf(raw: string): string {
  try {
    const u = new URL(raw)
    if (!u.hostname) return u.protocol.replace(':', '')
    return u.hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

export function originOf(raw: string): string | null {
  try {
    const u = new URL(raw)
    return isWebUrl(raw) ? u.origin : null
  } catch {
    return null
  }
}

export function hashFor(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 20)
}
