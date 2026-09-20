/**
 * Exercises the Chrome write-back protocol end to end against the real route
 * handlers, with a stand-in for the extension.
 *
 * Runs against a scratch COPY and never touches Chrome -- see harness.ts.
 */
import fs from 'node:fs'
import { setupScratch } from './harness.ts'
import Fastify from 'fastify'

const { scratch, fixture } = setupScratch('bb-ops-')

const { db } = await import('../src/db/index.ts')
const { apiRoutes } = await import('../src/routes/api.ts')
const { syncNow } = await import('../src/sync/service.ts')

const app = Fastify()
await app.register(apiRoutes)
await syncNow()

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  )
}

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
}

const countBookmarks = () =>
  (db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE present = 1').get() as { n: number }).n
const isHidden = (id: number) =>
  ((
    db.prepare('SELECT hidden FROM user_data WHERE bookmark_id = ?').get(id) as
      { hidden: number } | undefined
  )?.hidden ?? 0) === 1
const exists = (id: number) => Boolean(db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').get(id))

/**
 * Stands in for the companion extension: drains the queue and reports back,
 * with `chromeBookmarks` playing the part of Chrome's own tree.
 */
const chromeBookmarks = new Map<string, { id: string; url?: string; parentId: string }>()
for (const row of db
  .prepare(
    'SELECT chrome_id AS id, url, folder_guid FROM bookmarks WHERE present = 1 AND chrome_id IS NOT NULL',
  )
  .all() as Array<{ id: string; url: string; folder_guid: string }>) {
  chromeBookmarks.set(row.id, { id: row.id, url: row.url, parentId: row.folder_guid })
}

/** Mimics Chrome writing its Bookmarks file out after a change. */
function flushChromeFile(removedGuids: string[]) {
  if (removedGuids.length === 0) return
  const gone = new Set(removedGuids)
  const json = JSON.parse(fs.readFileSync(fixture, 'utf8'))
  const strip = (node: any) => {
    if (!Array.isArray(node.children)) return
    node.children = node.children.filter((child: any) => !gone.has(child.guid))
    for (const child of node.children) strip(child)
  }
  for (const key of ['bookmark_bar', 'other', 'synced']) strip(json.roots[key])
  fs.writeFileSync(fixture, JSON.stringify(json, null, 2))
}

async function runExtension(behaviour: 'succeed' | 'fail' = 'succeed', flushFile = true) {
  const { body } = await call('GET', '/api/ext/ops?v=test')
  const removed: string[] = []
  const results = body.ops.map(
    (op: { id: number; op: string; chromeId: string; guid: string; url: string; payload: any }) => {
      if (behaviour === 'fail') return { id: op.id, ok: false, error: 'Simulated Chrome failure' }
      const node = chromeBookmarks.get(op.chromeId)
      if (op.op === 'delete') {
        // The real extension verifies the URL before removing anything.
        if (node && node.url !== op.url) return { id: op.id, ok: false, error: 'URL mismatch' }
        chromeBookmarks.delete(op.chromeId)
        removed.push(op.guid)
        return { id: op.id, ok: true }
      }
      if (op.op === 'move') {
        if (!node) return { id: op.id, ok: false, error: 'Bookmark not found in Chrome' }
        node.parentId = String(op.payload.parentGuid)
        return { id: op.id, ok: true }
      }
      return { id: op.id, ok: false, error: 'Unknown op' }
    },
  )
  const report = (await call('POST', '/api/ext/results', { version: 'test', results })).body
  if (flushFile) flushChromeFile(removed)
  return report
}

// ---------------------------------------------------------------- delete
console.log('\n-- deleting a Chrome bookmark')
const before = countBookmarks()
const target = db
  .prepare("SELECT id, url FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 1")
  .get() as {
  id: number
  url: string
}

const del = await call('DELETE', `/api/bookmarks/${target.id}`)
check(
  'delete is queued, not applied immediately',
  [del.body.deleted, del.body.queued],
  [false, true],
)
check('bookmark is hidden right away', isHidden(target.id), true)
check('row survives until Chrome confirms', exists(target.id), true)
check('one op is pending', (await call('GET', '/api/ops')).body.pending, 1)

await runExtension()
check('row is destroyed once Chrome confirms', exists(target.id), false)
check('visible count dropped by one', countBookmarks(), before - 1)
check('queue is empty', (await call('GET', '/api/ops')).body.pending, 0)

// ---------------------------------------------------------------- failure
console.log('\n-- a delete Chrome refuses')
const doomed = db
  .prepare("SELECT id FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 1")
  .get() as {
  id: number
}
await call('DELETE', `/api/bookmarks/${doomed.id}`)
for (let attempt = 0; attempt < 3; attempt++) await runExtension('fail')

check('row is intact after a failed delete', exists(doomed.id), true)
check('and is un-hidden rather than lost', isHidden(doomed.id), false)
check('failure is reported', (await call('GET', '/api/ops')).body.failed, 1)
await call('POST', '/api/ops/clear')
check('failures can be cleared', (await call('GET', '/api/ops')).body.failed, 0)

// ---------------------------------------------------------------- batch move
console.log('\n-- batch move')
const folder = db
  .prepare(
    'SELECT chrome_guid AS guid, chrome_id FROM folders WHERE depth = 1 AND present = 1 LIMIT 1',
  )
  .get() as { guid: string; chrome_id: string }
const movers = (
  db
    .prepare(
      "SELECT id, chrome_id FROM bookmarks WHERE present = 1 AND source = 'chrome' AND folder_guid != ? LIMIT 3",
    )
    .all(folder.guid) as Array<{ id: number; chrome_id: string }>
).map((r) => r)

const moved = await call('POST', '/api/bookmarks/batch', {
  ids: movers.map((m) => m.id),
  action: 'move',
  folderGuid: folder.guid,
})
check('three moves applied locally', moved.body.applied, 3)
check('three ops queued for Chrome', moved.body.queued, 3)
check(
  'local folder updated at once',
  db
    .prepare(
      `SELECT COUNT(*) n FROM bookmarks WHERE folder_guid = ? AND id IN (${movers.map(() => '?').join(',')})`,
    )
    .get(folder.guid, ...movers.map((m) => m.id)),
  { n: 3 },
)

await runExtension()
check(
  'Chrome received all three moves',
  movers.every((m) => chromeBookmarks.get(m.chrome_id)?.parentId === folder.guid),
  true,
)
check('queue drained', (await call('GET', '/api/ops')).body.pending, 0)

// ---------------------------------------------------------------- batch hide/delete
console.log('\n-- batch hide and batch delete')
const batch = (
  db
    .prepare("SELECT id FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 5")
    .all() as Array<{
    id: number
  }>
).map((r) => r.id)

const hidden = await call('POST', '/api/bookmarks/batch', { ids: batch, action: 'hide' })
check('five hidden', hidden.body.applied, 5)
check('hiding queues nothing for Chrome', hidden.body.queued, 0)
check('all five report hidden', batch.every(isHidden), true)

await call('POST', '/api/bookmarks/batch', { ids: batch, action: 'unhide' })
check('and can be unhidden', batch.some(isHidden), false)

const countBefore = countBookmarks()
const deleted = await call('POST', '/api/bookmarks/batch', { ids: batch, action: 'delete' })
check('five deletes queued', deleted.body.queued, 5)
await runExtension()
check('all five gone after Chrome confirms', batch.some(exists), false)
check('count dropped by five', countBookmarks(), countBefore - 5)

// ---------------------------------------------------------------- local
console.log('\n-- a locally added bookmark needs no Chrome round trip')
const local = await call('POST', '/api/bookmarks', { url: 'https://example.com/ops-test' })
check('created', local.status, 201)
const localDelete = await call('DELETE', `/api/bookmarks/${local.body.id}`)
check(
  'deleted outright, nothing queued',
  [localDelete.body.deleted, localDelete.body.queued],
  [true, false],
)
check('queue still empty', (await call('GET', '/api/ops')).body.pending, 0)

// ---------------------------------------------------------------- resurrection
console.log('\n-- a deleted bookmark does not come back on the next sync')
const survivors = countBookmarks()
await syncNow(true)
check('forced re-sync leaves deletions alone', countBookmarks(), survivors)

// ---------------------------------------------------------------- the race
console.log('\n-- syncing before Chrome has flushed the deletion to disk')
const racer = db
  .prepare("SELECT id FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 1")
  .get() as {
  id: number
}
await call('DELETE', `/api/bookmarks/${racer.id}`)
// Chrome confirms the delete, but has not rewritten its Bookmarks file yet.
await runExtension('succeed', false)
check('row is gone locally', exists(racer.id), false)

const beforeRace = countBookmarks()
await syncNow(true)
check('the stale file does not resurrect it', countBookmarks(), beforeRace)
check('and it stays gone', exists(racer.id), false)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
await app.close()
db.close()
try {
  fs.rmSync(scratch, { recursive: true, force: true })
} catch {
  console.log(`(scratch directory left behind: ${scratch})`)
}
process.exit(failures === 0 ? 0 : 1)
