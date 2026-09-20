import { db } from '../db/index.ts'
import { bus } from '../events.ts'

export type OpKind = 'delete' | 'move'

export interface PendingOp {
  id: number
  op: OpKind
  /** Chrome node id — what chrome.bookmarks.remove/move actually addresses. */
  chromeId: string | null
  /** Stable identity, used to re-find the node if the id went stale. */
  guid: string | null
  /** Checked against the live node before anything destructive happens. */
  url: string | null
  payload: Record<string, unknown>
}

export interface OpResult {
  id: number
  ok: boolean
  error?: string
}

const MAX_OP_ATTEMPTS = 3

/** Anything newer than this and we treat the extension as connected. */
const EXTENSION_TIMEOUT_MS = 90_000

let extensionLastSeen = 0
let extensionVersion: string | null = null

export function noteExtensionSeen(version?: string): void {
  extensionLastSeen = Date.now()
  if (version) extensionVersion = version
}

export function extensionStatus(): {
  connected: boolean
  lastSeen: number | null
  version: string | null
} {
  return {
    connected: Date.now() - extensionLastSeen < EXTENSION_TIMEOUT_MS,
    lastSeen: extensionLastSeen || null,
    version: extensionVersion,
  }
}

const insertOp = db.prepare(`
  INSERT INTO bookmark_ops (op, bookmark_id, chrome_guid, chrome_id, url, payload, created_at)
  VALUES (@op, @bookmarkId, @guid, @chromeId, @url, @payload, @now)
`)

interface BookmarkRef {
  id: number
  chrome_guid: string
  chrome_id: string | null
  url: string
  source: string
}

/**
 * Queues a change for Chrome. Locally added bookmarks have no Chrome node, so
 * they produce no op — the caller applies those directly.
 */
export function queueOp(
  bookmarkId: number,
  op: OpKind,
  payload: Record<string, unknown> = {},
): number | null {
  const row = db
    .prepare('SELECT id, chrome_guid, chrome_id, url, source FROM bookmarks WHERE id = ?')
    .get(bookmarkId) as BookmarkRef | undefined
  if (!row || row.source !== 'chrome') return null

  const info = insertOp.run({
    op,
    bookmarkId,
    guid: row.chrome_guid,
    chromeId: row.chrome_id,
    url: row.url,
    payload: JSON.stringify(payload),
    now: Date.now(),
  })
  bus.emitEvent({ type: 'ops', pending: pendingCount() })
  return Number(info.lastInsertRowid)
}

export function pendingOps(limit = 100): PendingOp[] {
  const rows = db
    .prepare(
      `SELECT id, op, chrome_id, chrome_guid, url, payload FROM bookmark_ops
       WHERE state = 'pending' ORDER BY id LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number
    op: OpKind
    chrome_id: string | null
    chrome_guid: string | null
    url: string | null
    payload: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    op: row.op,
    chromeId: row.chrome_id,
    guid: row.chrome_guid,
    url: row.url,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {},
  }))
}

export function pendingCount(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM bookmark_ops WHERE state = 'pending'").get() as {
      n: number
    }
  ).n
}

export function failedCount(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM bookmark_ops WHERE state = 'failed'").get() as {
      n: number
    }
  ).n
}

/**
 * Applies the extension's report.
 *
 * A delete is only finalised here, once Chrome has confirmed the node is gone —
 * until then the bookmark is merely hidden. Deleting our row up front would
 * mean a failed op silently resurrects the bookmark on the next file sync,
 * stripped of its tags and notes.
 */
export const recordResults = db.transaction((results: OpResult[]) => {
  const now = Date.now()
  let applied = 0

  for (const result of results) {
    const op = db
      .prepare('SELECT id, op, bookmark_id, attempts FROM bookmark_ops WHERE id = ?')
      .get(result.id) as
      { id: number; op: OpKind; bookmark_id: number | null; attempts: number } | undefined
    if (!op || !result) continue

    if (result.ok) {
      db.prepare(
        "UPDATE bookmark_ops SET state = 'done', applied_at = ?, error = NULL WHERE id = ?",
      ).run(now, op.id)
      if (op.op === 'delete' && op.bookmark_id) {
        const row = db
          .prepare('SELECT chrome_guid FROM bookmarks WHERE id = ?')
          .get(op.bookmark_id) as { chrome_guid: string } | undefined
        if (row) {
          db.prepare(
            'INSERT OR REPLACE INTO deleted_guids (chrome_guid, deleted_at) VALUES (?, ?)',
          ).run(row.chrome_guid, now)
        }
        db.prepare('DELETE FROM bookmarks_fts WHERE bookmark_id = ?').run(op.bookmark_id)
        db.prepare('DELETE FROM bookmarks WHERE id = ?').run(op.bookmark_id)
      }
      applied++
      continue
    }

    const attempts = op.attempts + 1
    const exhausted = attempts >= MAX_OP_ATTEMPTS
    db.prepare(
      `UPDATE bookmark_ops SET attempts = ?, state = ?, error = ?, applied_at = ? WHERE id = ?`,
    ).run(
      attempts,
      exhausted ? 'failed' : 'pending',
      result.error?.slice(0, 300) ?? 'Unknown error',
      now,
      op.id,
    )

    // A delete that will not happen must not leave the bookmark hidden, or it
    // vanishes from the library while still sitting in Chrome.
    if (exhausted && op.op === 'delete' && op.bookmark_id) {
      db.prepare('UPDATE user_data SET hidden = 0 WHERE bookmark_id = ?').run(op.bookmark_id)
    }
  }

  return applied
})

export function retryFailedOps(): number {
  const info = db
    .prepare(
      "UPDATE bookmark_ops SET state = 'pending', attempts = 0, error = NULL WHERE state = 'failed'",
    )
    .run()
  if (info.changes) bus.emitEvent({ type: 'ops', pending: pendingCount() })
  return info.changes
}

export function clearFailedOps(): number {
  const rows = db
    .prepare("SELECT bookmark_id AS id FROM bookmark_ops WHERE state = 'failed'")
    .all() as Array<{
    id: number | null
  }>
  for (const row of rows) {
    if (row.id) db.prepare('UPDATE user_data SET hidden = 0 WHERE bookmark_id = ?').run(row.id)
  }
  return db.prepare("DELETE FROM bookmark_ops WHERE state = 'failed'").run().changes
}

export function failedOpDetails(): Array<{
  id: number
  op: string
  url: string | null
  error: string | null
}> {
  return db
    .prepare(
      "SELECT id, op, url, error FROM bookmark_ops WHERE state = 'failed' ORDER BY id DESC LIMIT 50",
    )
    .all() as Array<{ id: number; op: string; url: string | null; error: string | null }>
}
