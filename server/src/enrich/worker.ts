import pLimit from 'p-limit'
import { FETCH_CONCURRENCY, MAX_ENRICH_ATTEMPTS } from '../config.ts'
import { db, getSetting } from '../db/index.ts'
import { bus } from '../events.ts'
import { enrichBookmark, recordFailure } from './enrich.ts'

const BATCH_SIZE = 24
const BASE_BACKOFF_MS = 30_000

let running = false
let wakeRequested = false
let retryTimer: NodeJS.Timeout | null = null

/**
 * Hidden bookmarks and excluded folders are skipped outright. Excluding a
 * folder is a privacy instruction as much as a display one: those sites should
 * never be contacted at all, not merely kept off the screen.
 */
const claimBatch = db.prepare(`
  SELECT q.bookmark_id AS id, q.attempts
  FROM enrich_queue q
  JOIN bookmarks b ON b.id = q.bookmark_id
  LEFT JOIN user_data u ON u.bookmark_id = b.id
  LEFT JOIN folders f ON f.chrome_guid = b.folder_guid
  WHERE q.state = 'pending' AND q.next_attempt_at <= ?
    AND b.present = 1
    AND COALESCE(u.hidden, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM folder_exclusions fx
      JOIN folders ef ON ef.chrome_guid = fx.folder_guid
      WHERE f.path = ef.path OR f.path LIKE ef.path || '/%'
    )
  ORDER BY q.next_attempt_at, q.bookmark_id
  LIMIT ?
`)

/** Same visibility rules as claimBatch, counted rather than listed. */
const claimableCount = db.prepare(`
  SELECT COUNT(*) AS n
  FROM enrich_queue q
  JOIN bookmarks b ON b.id = q.bookmark_id
  LEFT JOIN user_data u ON u.bookmark_id = b.id
  LEFT JOIN folders f ON f.chrome_guid = b.folder_guid
  WHERE q.state = 'pending' AND q.next_attempt_at <= ?
    AND b.present = 1
    AND COALESCE(u.hidden, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM folder_exclusions fx
      JOIN folders ef ON ef.chrome_guid = fx.folder_guid
      WHERE f.path = ef.path OR f.path LIKE ef.path || '/%'
    )
`)

const markDone = db.prepare(
  "UPDATE enrich_queue SET state = 'done', last_error = NULL, updated_at = ? WHERE bookmark_id = ?",
)
const markRetry = db.prepare(`
  UPDATE enrich_queue SET attempts = ?, next_attempt_at = ?, last_error = ?, state = ?, updated_at = ?
  WHERE bookmark_id = ?
`)
const nextRetryAt = db.prepare(
  "SELECT MIN(next_attempt_at) AS at FROM enrich_queue WHERE state = 'pending' AND next_attempt_at > ?",
)
const park = db.prepare('UPDATE enrich_queue SET next_attempt_at = ? WHERE bookmark_id = ?')
const parkBatch = db.transaction((rows: Array<{ id: number }>) => {
  const until = Date.now() + 10 * 60_000
  for (const row of rows) park.run(until, row.id)
})

export interface QueueStats {
  pending: number
  done: number
  failed: number
  skipped: number
}

export function queueStats(): QueueStats {
  const rows = db
    .prepare('SELECT state, COUNT(*) AS n FROM enrich_queue GROUP BY state')
    .all() as Array<{
    state: string
    n: number
  }>
  const stats: QueueStats = { pending: 0, done: 0, failed: 0, skipped: 0 }
  for (const row of rows) {
    if (row.state in stats) stats[row.state as keyof QueueStats] = row.n
  }
  // Rows the worker will never claim (hidden, or in an excluded folder) must
  // not show up as work in progress, or the UI spins forever.
  stats.pending = (claimableCount.get(Number.MAX_SAFE_INTEGER) as { n: number }).n
  return stats
}

export function isPaused(): boolean {
  // The env var is for tests and for running the importer with no network at all.
  return process.env.BB_PAUSE_ENRICH === '1' || getSetting('enrich_paused', '0') === '1'
}

async function processOne(id: number, attempts: number): Promise<void> {
  try {
    await enrichBookmark(id)
    markDone.run(Date.now(), id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const nextAttempts = attempts + 1
    const exhausted = nextAttempts >= MAX_ENRICH_ATTEMPTS
    markRetry.run(
      nextAttempts,
      exhausted ? 0 : Date.now() + BASE_BACKOFF_MS * 3 ** attempts,
      message.slice(0, 300),
      exhausted ? 'failed' : 'pending',
      Date.now(),
      id,
    )
    if (exhausted) recordFailure(id, err)
  }
  bus.emitEvent({ type: 'enriched', bookmarkId: id })
}

async function drain(): Promise<void> {
  const limit = pLimit(FETCH_CONCURRENCY)

  for (;;) {
    if (isPaused()) break
    const batch = claimBatch.all(Date.now(), BATCH_SIZE) as Array<{ id: number; attempts: number }>
    if (batch.length === 0) break

    // Take them out of the pending pool for this pass so a concurrent wake
    // cannot hand the same bookmark to a second worker. If the process dies
    // here the rows stay pending and resetStalled() frees them at next boot.
    parkBatch(batch)

    await Promise.all(batch.map((row) => limit(() => processOne(row.id, row.attempts))))

    const stats = queueStats()
    bus.emitEvent({ type: 'queue', pending: stats.pending, failed: stats.failed })
  }
}

/** Runs the queue to empty, then schedules a wake for the earliest backoff. */
export function wakeWorker(): void {
  if (running) {
    wakeRequested = true
    return
  }
  running = true
  void (async () => {
    try {
      do {
        wakeRequested = false
        await drain()
      } while (wakeRequested)
    } catch (err) {
      console.error('[enrich] worker crashed:', err)
    } finally {
      running = false
      scheduleRetry()
    }
  })()
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  const row = nextRetryAt.get(Date.now()) as { at: number | null } | undefined
  if (!row?.at) return
  const delay = Math.max(5_000, Math.min(row.at - Date.now(), 15 * 60_000))
  retryTimer = setTimeout(() => wakeWorker(), delay)
  retryTimer.unref()
}

/** Re-queues a single bookmark on demand (the card's retry action). */
export function requeue(bookmarkId: number): void {
  db.prepare(
    `
    INSERT INTO enrich_queue (bookmark_id, state, attempts, next_attempt_at, last_error, updated_at)
    VALUES (?, 'pending', 0, 0, NULL, ?)
    ON CONFLICT(bookmark_id) DO UPDATE SET
      state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL, updated_at = excluded.updated_at
  `,
  ).run(bookmarkId, Date.now())
  wakeWorker()
}

/** Anything left mid-flight from a previous process is pending again at boot. */
export function resetStalled(): void {
  db.prepare(
    "UPDATE enrich_queue SET next_attempt_at = 0 WHERE state = 'pending' AND next_attempt_at > ?",
  ).run(Date.now())
}
