import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { ROOT } from '../config.ts'
import { db, getSetting, setSetting } from '../db/index.ts'
import { bus } from '../events.ts'
import {
  excludedFolders,
  folderTree,
  getBookmark,
  libraryCounts,
  listBookmarks,
} from '../lib/queries.ts'
import { indexBookmark } from '../lib/search.ts'
import { domainOf, isWebUrl, urlHash } from '../lib/url.ts'
import { isPaused, queueStats, requeue } from '../enrich/worker.ts'
import {
  clearFailedOps,
  extensionStatus,
  failedCount,
  failedOpDetails,
  noteExtensionSeen,
  pendingCount,
  pendingOps,
  queueOp,
  recordResults,
  retryFailedOps,
} from '../lib/ops.ts'
import { applyOpsOffline, chromeIsRunning } from '../chrome/writer.ts'
import { currentProfile, lastSyncError, switchProfile, syncNow } from '../sync/service.ts'
import { findProfiles } from '../chrome/profiles.ts'

const listQuery = z.object({
  folder: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['recent', 'oldest', 'title', 'domain', 'relevance']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const patchBody = z.object({
  notes: z.string().max(20_000).nullable().optional(),
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional(),
  customTitle: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(40).optional(),
})

const batchBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(2000),
  action: z.enum(['hide', 'unhide', 'delete', 'move', 'tag', 'untag', 'favorite', 'unfavorite']),
  folderGuid: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(40).optional(),
})

const createBody = z.object({
  url: z.string().min(3).max(4000),
  title: z.string().max(500).optional(),
  folderGuid: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(40).optional(),
})

const TAG_COLORS = [
  'slate',
  'rose',
  'amber',
  'emerald',
  'sky',
  'violet',
  'fuchsia',
  'lime',
] as const

function upsertUserData(id: number, patch: z.infer<typeof patchBody>): void {
  db.prepare(
    `INSERT INTO user_data (bookmark_id, notes, favorite, hidden, hidden_at, custom_title, updated_at)
     VALUES (@id, @notes, COALESCE(@favorite, 0), COALESCE(@hidden, 0), @hiddenAt, @customTitle, @now)
     ON CONFLICT(bookmark_id) DO UPDATE SET
       notes        = COALESCE(@notes, user_data.notes),
       favorite     = COALESCE(@favorite, user_data.favorite),
       hidden       = COALESCE(@hidden, user_data.hidden),
       hidden_at    = CASE WHEN @hidden IS NULL THEN user_data.hidden_at ELSE @hiddenAt END,
       custom_title = COALESCE(@customTitle, user_data.custom_title),
       updated_at   = @now`,
  ).run({
    id,
    notes: patch.notes ?? null,
    favorite: patch.favorite === undefined ? null : patch.favorite ? 1 : 0,
    hidden: patch.hidden === undefined ? null : patch.hidden ? 1 : 0,
    hiddenAt: patch.hidden ? Date.now() : null,
    customTitle: patch.customTitle ?? null,
    now: Date.now(),
  })

  // COALESCE keeps existing values, so an explicit null needs its own clear.
  if (patch.notes === null)
    db.prepare('UPDATE user_data SET notes = NULL WHERE bookmark_id = ?').run(id)
  if (patch.customTitle === null)
    db.prepare('UPDATE user_data SET custom_title = NULL WHERE bookmark_id = ?').run(id)
}

const setTags = db.transaction((bookmarkId: number, names: string[]) => {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const ids: number[] = []
  for (const name of wanted) {
    const existing = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as
      { id: number } | undefined
    if (existing) {
      ids.push(existing.id)
      continue
    }
    const color =
      TAG_COLORS[
        Math.abs([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % TAG_COLORS.length
      ]!
    ids.push(
      Number(
        db
          .prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)')
          .run(name, color, Date.now()).lastInsertRowid,
      ),
    )
  }
  db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(bookmarkId)
  const link = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
  for (const id of ids) link.run(bookmarkId, id)
})

/** FTS5 is a virtual table, so ON DELETE CASCADE does not reach it. */
const destroyBookmark = db.transaction((id: number) => {
  db.prepare('DELETE FROM bookmarks_fts WHERE bookmark_id = ?').run(id)
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
})

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/bookmarks', (req) => listBookmarks(listQuery.parse(req.query)))

  app.get('/api/bookmarks/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const bookmark = getBookmark(id)
    if (!bookmark) return reply.code(404).send({ error: 'Not found' })
    return bookmark
  })

  /** Adds a bookmark that exists only in this app — Chrome is never written to. */
  app.post('/api/bookmarks', (req, reply) => {
    const body = createBody.parse(req.body)
    const url = body.url.trim().match(/^[a-z]+:\/\//i)
      ? body.url.trim()
      : `https://${body.url.trim()}`
    if (!isWebUrl(url)) return reply.code(400).send({ error: 'Only http(s) links can be added.' })

    const hash = urlHash(url)
    const duplicate = db
      .prepare('SELECT id FROM bookmarks WHERE url_hash = ? AND present = 1')
      .get(hash) as { id: number } | undefined
    if (duplicate) {
      return reply
        .code(409)
        .send({ error: 'That link is already in your library.', id: duplicate.id })
    }

    const now = Date.now()
    const info = db
      .prepare(
        `INSERT INTO bookmarks
           (chrome_guid, folder_guid, url, url_hash, domain, chrome_title, position,
            date_added, date_last_used, first_seen, present, source)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 1, 'local')`,
      )
      .run(
        `local:${crypto.randomUUID()}`,
        body.folderGuid ?? null,
        url,
        hash,
        domainOf(url),
        body.title ?? null,
        now,
        now,
      )

    const id = Number(info.lastInsertRowid)
    if (body.tags?.length) setTags(id, body.tags)
    indexBookmark(id)
    requeue(id)
    return reply.code(201).send(getBookmark(id))
  })

  app.patch('/api/bookmarks/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Not found' })

    const patch = patchBody.parse(req.body)
    upsertUserData(id, patch)
    if (patch.tags) setTags(id, patch.tags)
    indexBookmark(id)
    return getBookmark(id)
  })

  /**
   * Deletes the bookmark from Chrome as well.
   *
   * A Chrome-owned bookmark is hidden immediately so it leaves the UI at once,
   * and a delete op is queued for the extension. The row is only destroyed once
   * Chrome confirms the node is gone (see ops.recordResults); deleting it here
   * would mean a failed op silently restores the bookmark on the next file
   * sync, stripped of its tags and notes.
   */
  app.delete('/api/bookmarks/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const row = db.prepare('SELECT source FROM bookmarks WHERE id = ?').get(id) as
      { source: string } | undefined
    if (!row) return reply.code(404).send({ error: 'Not found' })

    if (row.source === 'local') {
      destroyBookmark(id)
      return { deleted: true, queued: false, extension: extensionStatus().connected }
    }

    upsertUserData(id, { hidden: true })
    queueOp(id, 'delete')
    return { deleted: false, queued: true, extension: extensionStatus().connected }
  })

  /** One action across a multi-selection. Chrome-side effects are queued as ops. */
  app.post('/api/bookmarks/batch', (req, reply) => {
    const body = batchBody.parse(req.body)
    const rows = db
      .prepare(
        `SELECT id, source, folder_guid FROM bookmarks WHERE id IN (${body.ids.map(() => '?').join(',')})`,
      )
      .all(...body.ids) as Array<{ id: number; source: string; folder_guid: string | null }>
    if (rows.length === 0) return reply.code(404).send({ error: 'No matching bookmarks' })

    let queued = 0
    let applied = 0

    const run = db.transaction(() => {
      for (const row of rows) {
        switch (body.action) {
          case 'hide':
            upsertUserData(row.id, { hidden: true })
            applied++
            break
          case 'unhide':
            upsertUserData(row.id, { hidden: false })
            applied++
            break
          case 'favorite':
          case 'unfavorite':
            upsertUserData(row.id, { favorite: body.action === 'favorite' })
            applied++
            break
          case 'delete':
            if (row.source === 'local') {
              destroyBookmark(row.id)
            } else {
              upsertUserData(row.id, { hidden: true })
              if (queueOp(row.id, 'delete')) queued++
            }
            applied++
            break
          case 'move': {
            if (body.folderGuid === undefined) break
            const target = body.folderGuid
              ? (db
                  .prepare('SELECT chrome_guid, chrome_id FROM folders WHERE chrome_guid = ?')
                  .get(body.folderGuid) as
                  { chrome_guid: string; chrome_id: string | null } | undefined)
              : undefined
            if (body.folderGuid && !target) break
            // Applied locally at once; the next file sync confirms it, and
            // Chrome's file stays the source of truth either way.
            db.prepare('UPDATE bookmarks SET folder_guid = ? WHERE id = ?').run(
              body.folderGuid ?? null,
              row.id,
            )
            if (row.source === 'chrome' && target) {
              if (
                queueOp(row.id, 'move', {
                  parentId: target.chrome_id,
                  parentGuid: target.chrome_guid,
                })
              )
                queued++
            }
            applied++
            break
          }
          case 'tag':
          case 'untag': {
            const names = body.tags ?? []
            if (names.length === 0) break
            const current = (
              db
                .prepare(
                  'SELECT t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = ?',
                )
                .all(row.id) as Array<{ name: string }>
            ).map((t) => t.name)
            const lower = new Set(names.map((n) => n.toLowerCase()))
            const next =
              body.action === 'tag'
                ? [...new Set([...current, ...names])]
                : current.filter((name) => !lower.has(name.toLowerCase()))
            setTags(row.id, next)
            indexBookmark(row.id)
            applied++
            break
          }
        }
      }
    })
    run()

    return { applied, queued, extension: extensionStatus().connected }
  })

  app.post('/api/bookmarks/:id/refetch', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Not found' })
    requeue(id)
    return { ok: true }
  })

  /** Bulk cleanup for the Dead links view. */
  app.post('/api/bookmarks/hide-dead', () => {
    const ids = db
      .prepare(
        `SELECT b.id FROM bookmarks b
         JOIN metadata m ON m.bookmark_id = b.id
         LEFT JOIN user_data u ON u.bookmark_id = b.id
         WHERE b.present = 1 AND m.link_status = 'dead' AND COALESCE(u.hidden, 0) = 0`,
      )
      .all() as Array<{ id: number }>
    const hideAll = db.transaction((rows: Array<{ id: number }>) => {
      for (const row of rows) upsertUserData(row.id, { hidden: true })
    })
    hideAll(ids)
    return { hidden: ids.length }
  })

  app.get('/api/folders', (req) => {
    const includeExcluded = (req.query as { includeExcluded?: string }).includeExcluded === '1'
    return folderTree(includeExcluded)
  })

  app.get('/api/exclusions', () => excludedFolders())

  app.put('/api/folders/:guid/exclusion', (req, reply) => {
    const guid = (req.params as { guid: string }).guid
    if (!db.prepare('SELECT 1 FROM folders WHERE chrome_guid = ?').get(guid))
      return reply.code(404).send({ error: 'Folder not found' })
    db.prepare(
      'INSERT OR REPLACE INTO folder_exclusions (folder_guid, excluded_at) VALUES (?, ?)',
    ).run(guid, Date.now())
    return { excluded: true }
  })

  app.delete('/api/folders/:guid/exclusion', (req) => {
    const guid = (req.params as { guid: string }).guid
    db.prepare('DELETE FROM folder_exclusions WHERE folder_guid = ?').run(guid)
    return { excluded: false }
  })

  app.get('/api/tags', () =>
    db
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(bt.bookmark_id) AS count
         FROM tags t
         LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
         LEFT JOIN bookmarks b ON b.id = bt.bookmark_id AND b.present = 1
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
      )
      .all(),
  )

  app.patch('/api/tags/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const body = z
      .object({ name: z.string().min(1).max(60).optional(), color: z.string().max(20).optional() })
      .parse(req.body)
    if (!db.prepare('SELECT id FROM tags WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'Not found' })
    if (body.name) db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(body.name, id)
    if (body.color) db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(body.color, id)
    return db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id)
  })

  app.delete('/api/tags/:id', (req) => {
    const id = Number((req.params as { id: string }).id)
    const affected = db
      .prepare('SELECT bookmark_id AS id FROM bookmark_tags WHERE tag_id = ?')
      .all(id) as Array<{ id: number }>
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
    for (const row of affected) indexBookmark(row.id)
    return { ok: true }
  })

  app.post('/api/sync', async (req) => {
    const force = (req.query as { force?: string }).force === '1'
    return syncNow(force)
  })

  app.get('/api/status', () => {
    const counts = libraryCounts()
    const extra = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM folders WHERE present = 1) AS folders,
           (SELECT COUNT(*) FROM tags)                      AS tags,
           (SELECT COUNT(DISTINCT domain) FROM bookmarks WHERE present = 1) AS domains,
           (SELECT COUNT(*) FROM metadata WHERE thumb_path IS NOT NULL)     AS thumbnails,
           (SELECT COUNT(*) FROM metadata WHERE fetch_error IS NOT NULL)    AS errors`,
      )
      .get() as object
    const profile = currentProfile()
    return {
      bookmarks: counts.visible,
      favorites: counts.favorites,
      dead: counts.dead,
      blocked: counts.blocked,
      unreachable: counts.unreachable,
      hiddenCount: counts.hidden,
      archived: counts.archived,
      local: counts.local,
      ...extra,
      queue: queueStats(),
      ops: { pending: pendingCount(), failed: failedCount() },
      extension: extensionStatus(),
      paused: isPaused(),
      lastSyncAt: Number(getSetting('last_sync_at', '0')) || null,
      syncError: lastSyncError(),
      profile: profile
        ? { dir: profile.dir, label: profile.label, path: profile.bookmarksPath }
        : null,
      profiles: findProfiles().map((p) => ({ dir: p.dir, label: p.label })),
    }
  })

  app.get('/api/settings', () => ({
    paused: isPaused(),
    skipDomains: getSetting('skip_domains', ''),
    profile: currentProfile()?.dir ?? null,
  }))

  app.patch('/api/settings', async (req) => {
    const body = z
      .object({
        paused: z.boolean().optional(),
        skipDomains: z.string().max(5000).optional(),
        profile: z.string().max(100).optional(),
      })
      .parse(req.body)
    if (body.paused !== undefined) setSetting('enrich_paused', body.paused ? '1' : '0')
    if (body.skipDomains !== undefined) setSetting('skip_domains', body.skipDomains)
    if (body.profile) {
      switchProfile(body.profile)
      await syncNow(true)
    }
    return { ok: true }
  })

  // ---------------------------------------------------------------- extension
  // The companion extension is the only thing that writes to Chrome. It polls
  // this queue and applies each op through the chrome.bookmarks API.

  app.get('/api/ext/ops', (req) => {
    noteExtensionSeen((req.query as { v?: string }).v)
    return { ops: pendingOps() }
  })

  app.post('/api/ext/results', (req) => {
    const body = z
      .object({
        version: z.string().max(40).optional(),
        results: z
          .array(
            z.object({
              id: z.number().int().positive(),
              ok: z.boolean(),
              error: z.string().max(400).optional(),
            }),
          )
          .max(500),
      })
      .parse(req.body)
    noteExtensionSeen(body.version)
    const applied = recordResults(body.results)
    bus.emitEvent({ type: 'ops', pending: pendingCount() })
    return { applied, pending: pendingCount() }
  })

  /** Chrome's own bookmark events, relayed so a change lands here instantly. */
  app.post('/api/ext/changed', async (req) => {
    noteExtensionSeen((req.body as { version?: string } | undefined)?.version)
    await syncNow().catch(() => undefined)
    return { ok: true }
  })

  app.get('/api/ext/hello', (req) => {
    noteExtensionSeen((req.query as { v?: string }).v)
    return { ok: true, app: 'better-bookmark', pending: pendingCount() }
  })

  app.get('/api/ops', () => ({
    pending: pendingCount(),
    failed: failedCount(),
    failures: failedOpDetails(),
    extension: extensionStatus(),
    // Shown verbatim in the install instructions, so it has to be the real path.
    extensionPath: path.join(ROOT, 'extension'),
  }))

  /** Whether the no-extension path is usable right now. */
  app.get('/api/ops/offline', async () => ({
    chromeRunning: await chromeIsRunning(),
    pending: pendingCount(),
  }))

  /**
   * Writes the queued changes straight into Chrome's Bookmarks file. Only
   * possible with Chrome closed; see chrome/writer.ts for the safeguards.
   */
  app.post('/api/ops/offline', async (_req, reply) => {
    const profile = currentProfile()
    if (!profile) return reply.code(400).send({ error: 'No Chrome profile is selected.' })
    try {
      const result = await applyOpsOffline(profile.bookmarksPath)
      await syncNow(true).catch(() => undefined)
      bus.emitEvent({ type: 'ops', pending: pendingCount() })
      return result
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/ops/retry', () => ({ retried: retryFailedOps() }))
  app.post('/api/ops/clear', () => ({ cleared: clearFailedOps() }))

  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write('retry: 3000\n\n')

    const unsubscribe = bus.onEvent((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
