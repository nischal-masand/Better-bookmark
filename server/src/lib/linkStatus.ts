export type LinkStatus = 'ok' | 'blocked' | 'dead' | 'unreachable'

/** HTTP codes that mean the page is genuinely gone, not merely refusing us. */
const DEAD_STATUS = new Set([404, 410])

/** The server answered and is healthy — it just will not serve a robot. */
const BLOCKED_STATUS = new Set([401, 402, 403, 407, 429, 451])

/** DNS said the name does not exist: nothing is coming back from this one. */
const DEAD_CODES = new Set(['ENOTFOUND'])

/**
 * Sorts a failed fetch into something actionable.
 *
 * The distinction that matters is `dead` versus `blocked`: a 404 means the
 * bookmark is worthless and should be cleaned up, while a 403 usually means a
 * perfectly good page behind a bot wall. Lumping them together as "broken"
 * would make the cleanup view untrustworthy, so anything ambiguous — timeouts,
 * TLS failures, 5xx — lands in `unreachable` and is never presented as dead.
 */
export function classifyFailure(status?: number, code?: string): LinkStatus {
  if (status !== undefined) {
    if (DEAD_STATUS.has(status)) return 'dead'
    if (BLOCKED_STATUS.has(status)) return 'blocked'
    return 'unreachable'
  }
  if (code && DEAD_CODES.has(code)) return 'dead'
  return 'unreachable'
}

export const LINK_STATUS_LABELS: Record<LinkStatus, string> = {
  ok: 'Reachable',
  blocked: 'Blocked by the site',
  dead: 'Dead link',
  unreachable: 'Could not be reached',
}
