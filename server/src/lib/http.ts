import { FETCH_TIMEOUT_MS, USER_AGENT } from '../config.ts'

export interface FetchedBody {
  buffer: Buffer
  status: number
  contentType: string
  /** URL after redirects — image and icon URLs must resolve against this. */
  finalUrl: string
  truncated: boolean
}

export class FetchError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the server answered at all. */
    readonly status?: number,
    /** Transport error code (ENOTFOUND, ECONNREFUSED, ...), when it did not. */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

const CAUSE_TEXT: Record<string, string> = {
  ENOTFOUND: 'Domain no longer exists',
  EAI_AGAIN: 'Domain could not be resolved',
  ECONNREFUSED: 'Server refused the connection',
  ECONNRESET: 'Server closed the connection',
  ETIMEDOUT: 'Server did not respond',
  UND_ERR_CONNECT_TIMEOUT: 'Server did not respond',
  UND_ERR_HEADERS_TIMEOUT: 'Server stopped responding mid-request',
  ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR: 'Secure connection was rejected by the server',
  EPROTO: 'Secure connection failed',
  EHOSTUNREACH: 'Host unreachable',
  CERT_HAS_EXPIRED: 'The site’s certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The site’s certificate does not match its domain',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The site’s certificate could not be verified',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The site uses a self-signed certificate',
}

/**
 * `fetch` reports every transport problem as the useless string "fetch failed"
 * and hides the real reason on `cause`, so unwrap it — a dead domain and an
 * expired certificate need very different responses from the reader.
 */
function causeCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  return (err as { cause?: { code?: string } }).cause?.code
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  const code = cause?.code
  if (code && CAUSE_TEXT[code]) return CAUSE_TEXT[code]
  if (code) return `${code}${cause?.message ? ` — ${cause.message}` : ''}`
  return cause?.message ?? err.message
}

/**
 * Downloads a response body with a hard byte ceiling so one enormous asset
 * cannot stall the queue or fill the disk. Aborts the stream once the cap is hit.
 */
export async function fetchLimited(
  url: string,
  opts: { maxBytes: number; accept: string; timeoutMs?: number },
): Promise<FetchedBody> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: opts.accept,
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
      },
    })

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !res.body) {
      throw new FetchError(
        `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
        res.status,
      )
    }

    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      chunks.push(Buffer.from(value))
      if (total >= opts.maxBytes) {
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
    }

    return {
      buffer: Buffer.concat(chunks),
      status: res.status,
      contentType,
      finalUrl: res.url || url,
      truncated,
    }
  } catch (err) {
    if (err instanceof FetchError) throw err
    if (err instanceof Error && err.name === 'AbortError') throw new FetchError('Timed out')
    throw new FetchError(describe(err), undefined, causeCode(err))
  } finally {
    clearTimeout(timeout)
  }
}

/** Decodes an HTML buffer, honouring the charset from the header or a meta tag. */
export function decodeHtml(buffer: Buffer, contentType: string): string {
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  const sniffed = /<meta[^>]+charset=["']?([\w-]+)/i.exec(
    buffer.subarray(0, 4096).toString('latin1'),
  )?.[1]
  const charset = (headerCharset ?? sniffed ?? 'utf-8').toLowerCase()
  if (charset === 'utf-8' || charset === 'utf8') return buffer.toString('utf8')
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}
