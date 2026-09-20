import { db, getSetting, setSetting } from '../db/index.ts'
import type { ParsedTree } from '../chrome/parse.ts'
import { isWebUrl } from '../lib/url.ts'

export interface SyncResult {
  added: number
  updated: number
  removed: number
  resurrected: number
  unchanged: number
  total: number
  folders: number
  skipped: boolean
  durationMs: number
}

interface ExistingBookmark {
  id: number
  chrome_guid: string
  folder_guid: string | null
  url: string
  url_hash: string
  chrome_title: string | null
  position: number
  date_last_used: number | null
  present: number
  source: string
}

const upsertFolder = db.prepare(`
  INSERT INTO folders (chrome_guid, chrome_id, parent_guid, root, name, path, depth, position, date_added, present)
  VALUES (@guid, @chromeId, @parentGuid, @root, @name, @path, @depth, @position, @dateAdded, 1)
  ON CONFLICT(chrome_guid) DO UPDATE SET
    chrome_id   = excluded.chrome_id,
    parent_guid = excluded.parent_guid,
    root        = excluded.root,
    name        = excluded.name,
    path        = excluded.path,
    depth       = excluded.depth,
    position    = excluded.position,
    present     = 1
`)

const insertBookmark = db.prepare(`
  INSERT INTO bookmarks
    (chrome_guid, chrome_id, folder_guid, url, url_hash, domain, chrome_title, position,
     date_added, date_last_used, first_seen, present)
  VALUES
    (@guid, @chromeId, @folderGuid, @url, @urlHash, @domain, @title, @position,
     @dateAdded, @dateLastUsed, @now, 1)
`)

const writeBookmark = db.prepare(`
  UPDATE bookmarks SET
    chrome_guid    = @guid,
    chrome_id      = @chromeId,
    folder_guid    = @folderGuid,
    url            = @url,
    url_hash       = @urlHash,
    domain         = @domain,
    chrome_title   = @title,
    position       = @position,
    date_added     = @dateAdded,
    date_last_used = @dateLastUsed,
    present        = 1,
    removed_at     = NULL
  WHERE id = @id
`)

const enqueue = db.prepare(`
  INSERT INTO enrich_queue (bookmark_id, state, attempts, next_attempt_at, last_error, updated_at)
  VALUES (?, 'pending', 0, 0, NULL, ?)
  ON CONFLICT(bookmark_id) DO UPDATE SET
    state = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL, updated_at = excluded.updated_at
`)

const markSkipped = db.prepare(`
  INSERT INTO enrich_queue (bookmark_id, state, updated_at) VALUES (?, 'skipped', ?)
  ON CONFLICT(bookmark_id) DO UPDATE SET state = 'skipped', updated_at = excluded.updated_at
`)

/**
 * Chrome flushes its Bookmarks file a moment after the extension removes a
 * node, so a sync landing in that gap still sees the deleted bookmark. These
 * tombstones make the import ignore it until Chrome catches up; they expire so
 * that deliberately re-adding the same bookmark later behaves normally.
 */
const TOMBSTONE_TTL_MS = 5 * 60_000

const hasMetadata = db.prepare(
  'SELECT 1 FROM metadata WHERE bookmark_id = ? AND fetched_at IS NOT NULL',
)
const urlOf = db.prepare('SELECT url FROM bookmarks WHERE id = ?')

/**
 * Folds a parsed Chrome tree into the database. Chrome guids are the identity;
 * a bookmark that vanishes from Chrome is archived (present = 0) rather than
 * deleted, and one that comes back with the same URL reclaims its old row, so
 * tags, notes and enrichment survive a delete/re-add round trip.
 */
function applyTree(tree: ParsedTree, now: number): SyncResult {
  const started = Date.now()
  let added = 0
  let updated = 0
  let resurrected = 0
  let unchanged = 0

  for (const folder of tree.folders) upsertFolder.run(folder)

  db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_folders (guid TEXT PRIMARY KEY)')
  db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_bookmarks (guid TEXT PRIMARY KEY)')
  db.exec('DELETE FROM seen_folders; DELETE FROM seen_bookmarks;')
  const seenFolder = db.prepare('INSERT OR IGNORE INTO seen_folders VALUES (?)')
  const seenBookmark = db.prepare('INSERT OR IGNORE INTO seen_bookmarks VALUES (?)')
  for (const folder of tree.folders) seenFolder.run(folder.guid)
  for (const bookmark of tree.bookmarks) seenBookmark.run(bookmark.guid)
  // `total` should report what was imported, not what the stale file contained.

  const byGuid = new Map<string, ExistingBookmark>()
  const archivedByHash = new Map<string, ExistingBookmark[]>()
  for (const row of db.prepare('SELECT * FROM bookmarks').all() as ExistingBookmark[]) {
    byGuid.set(row.chrome_guid, row)
    // Only Chrome-sourced rows can be reclaimed; a locally added bookmark that
    // happens to share a URL is a separate thing and must not be hijacked.
    if (row.present === 0 && row.source === 'chrome') {
      const list = archivedByHash.get(row.url_hash) ?? []
      list.push(row)
      archivedByHash.set(row.url_hash, list)
    }
  }

  db.prepare('DELETE FROM deleted_guids WHERE deleted_at < ?').run(now - TOMBSTONE_TTL_MS)
  const tombstoned = new Set(
    (
      db.prepare('SELECT chrome_guid FROM deleted_guids').all() as Array<{ chrome_guid: string }>
    ).map((row) => row.chrome_guid),
  )

  const needsEnrich: number[] = []
  const claimed = new Set<number>()

  for (const bm of tree.bookmarks) {
    // Deleted through this app; Chrome has not rewritten its file yet.
    if (tombstoned.has(bm.guid)) continue

    const params = { ...bm, now }
    const existing = byGuid.get(bm.guid)

    if (existing) {
      const changed =
        existing.url !== bm.url ||
        existing.folder_guid !== bm.folderGuid ||
        existing.chrome_title !== bm.title ||
        existing.position !== bm.position ||
        existing.date_last_used !== bm.dateLastUsed ||
        existing.present !== 1
      if (changed) {
        writeBookmark.run({ ...params, id: existing.id })
        updated++
        if (existing.url !== bm.url) needsEnrich.push(existing.id)
      } else {
        unchanged++
      }
      if (!hasMetadata.get(existing.id)) needsEnrich.push(existing.id)
      continue
    }

    // A guid we have never seen. Chrome assigns a fresh one when a bookmark is
    // deleted and re-added, so look for an archived row with the same URL first.
    const candidate = (archivedByHash.get(bm.urlHash) ?? []).find((row) => !claimed.has(row.id))
    if (candidate) {
      claimed.add(candidate.id)
      writeBookmark.run({ ...params, id: candidate.id })
      byGuid.set(bm.guid, { ...candidate, chrome_guid: bm.guid, present: 1 })
      resurrected++
      if (!hasMetadata.get(candidate.id)) needsEnrich.push(candidate.id)
      continue
    }

    const info = insertBookmark.run(params)
    added++
    needsEnrich.push(Number(info.lastInsertRowid))
  }

  const removeInfo = db
    .prepare(
      `UPDATE bookmarks SET present = 0, removed_at = ?
       WHERE present = 1 AND source = 'chrome'
         AND chrome_guid NOT IN (SELECT guid FROM seen_bookmarks)`,
    )
    .run(now)
  db.prepare(
    `UPDATE folders SET present = 0
     WHERE present = 1 AND chrome_guid NOT IN (SELECT guid FROM seen_folders)`,
  ).run()

  for (const id of new Set(needsEnrich)) {
    const row = urlOf.get(id) as { url: string } | undefined
    if (row && isWebUrl(row.url)) enqueue.run(id, now)
    else markSkipped.run(id, now)
  }

  return {
    added,
    updated,
    removed: removeInfo.changes,
    resurrected,
    unchanged,
    total: tree.bookmarks.length,
    folders: tree.folders.length,
    skipped: false,
    durationMs: Date.now() - started,
  }
}

const applyTreeTxn = db.transaction(applyTree)

/** Returns a no-op result when the file is byte-identical to the last import. */
export function reconcile(tree: ParsedTree, force = false): SyncResult {
  const now = Date.now()
  if (!force && getSetting('last_fingerprint', '') === tree.fingerprint) {
    return {
      added: 0,
      updated: 0,
      removed: 0,
      resurrected: 0,
      unchanged: tree.bookmarks.length,
      total: tree.bookmarks.length,
      folders: tree.folders.length,
      skipped: true,
      durationMs: 0,
    }
  }

  const logId = db.prepare('INSERT INTO sync_log (started_at) VALUES (?)').run(now).lastInsertRowid
  try {
    const result = applyTreeTxn(tree, now)
    setSetting('last_fingerprint', tree.fingerprint)
    setSetting('last_sync_at', String(Date.now()))
    db.prepare(
      'UPDATE sync_log SET finished_at = ?, added = ?, updated = ?, removed = ?, resurrected = ? WHERE id = ?',
    ).run(Date.now(), result.added, result.updated, result.removed, result.resurrected, logId)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare('UPDATE sync_log SET finished_at = ?, error = ? WHERE id = ?').run(
      Date.now(),
      message,
      logId,
    )
    throw err
  }
}
