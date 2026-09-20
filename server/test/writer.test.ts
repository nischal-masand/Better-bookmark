/**
 * Proves the no-extension write path produces a Bookmarks file Chrome accepts.
 *
 * Runs entirely on a scratch COPY; the real Chrome profile is never written to.
 * See harness.ts.
 */
import fs from 'node:fs'
import { setupScratch, REAL_PROFILE } from './harness.ts'
import Fastify from 'fastify'

const { scratch, fixture } = setupScratch('bb-writer-')

const { db } = await import('../src/db/index.ts')
const { apiRoutes } = await import('../src/routes/api.ts')
const { syncNow } = await import('../src/sync/service.ts')
const { computeChecksum } = await import('../src/chrome/checksum.ts')
const { applyOpsOffline } = await import('../src/chrome/writer.ts')

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

const readFixture = () => JSON.parse(fs.readFileSync(fixture, 'utf8'))
const guidsInFile = () => {
  const found = new Set<string>()
  const walk = (node: any) => {
    if (node.guid) found.add(node.guid)
    for (const child of node.children ?? []) walk(child)
  }
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(readFixture().roots[key])
  return found
}

// ---------------------------------------------------------------- checksum
console.log('\n-- checksum')
// Only a genuinely Chrome-written file can prove our implementation matches
// Chromium's. The fixture's checksum came from this same function, so checking
// it against the fixture would be circular and prove nothing.
if (REAL_PROFILE) {
  check(
    "matches Chrome's own stored checksum",
    computeChecksum(readFixture().roots),
    readFixture().checksum,
  )
} else {
  console.log("SKIP  matches Chrome's own stored checksum  (needs BB_TEST_REAL_PROFILE=1)")
}

// ---------------------------------------------------------------- delete
console.log('\n-- deleting through the file')
const victims = db
  .prepare(
    "SELECT id, chrome_guid AS guid, url FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 3",
  )
  .all() as Array<{ id: number; guid: string; url: string }>

for (const victim of victims) await call('DELETE', `/api/bookmarks/${victim.id}`)
check('three deletes queued', (await call('GET', '/api/ops')).body.pending, 3)

const beforeGuids = guidsInFile()
check(
  'all three are still in the file',
  victims.every((v) => beforeGuids.has(v.guid)),
  true,
)

const result = await applyOpsOffline(fixture, { skipRunningCheck: true })
check('all three applied', [result.applied, result.failed], [3, 0])
check('a backup was written', Boolean(result.backup && fs.existsSync(result.backup)), true)

const afterGuids = guidsInFile()
check(
  'none of them remain in the file',
  victims.some((v) => afterGuids.has(v.guid)),
  false,
)
check('nothing else was removed', afterGuids.size, beforeGuids.size - 3)
check('the rewritten file still parses', typeof readFixture().roots, 'object')
check('and carries a valid checksum', computeChecksum(readFixture().roots), readFixture().checksum)
check(
  'rows are gone locally too',
  victims.some((v) => Boolean(db.prepare('SELECT 1 FROM bookmarks WHERE id = ?').get(v.id))),
  false,
)
check('queue drained', (await call('GET', '/api/ops')).body.pending, 0)

// ---------------------------------------------------------------- re-import
console.log('\n-- re-importing the rewritten file')
const visible = (
  db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE present = 1').get() as { n: number }
).n
await syncNow(true)
check(
  'a fresh sync agrees with what we wrote',
  (db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE present = 1').get() as { n: number }).n,
  visible,
)

// ---------------------------------------------------------------- move
console.log('\n-- moving through the file')
const folder = db
  .prepare('SELECT chrome_guid AS guid FROM folders WHERE depth = 1 AND present = 1 LIMIT 1')
  .get() as { guid: string }
const movers = db
  .prepare(
    "SELECT id, chrome_guid AS guid FROM bookmarks WHERE present = 1 AND source = 'chrome' AND folder_guid != ? LIMIT 2",
  )
  .all(folder.guid) as Array<{ id: number; guid: string }>

await call('POST', '/api/bookmarks/batch', {
  ids: movers.map((m) => m.id),
  action: 'move',
  folderGuid: folder.guid,
})
const moveResult = await applyOpsOffline(fixture, { skipRunningCheck: true })
check('both moves applied', [moveResult.applied, moveResult.failed], [2, 0])

const parentOf = (guid: string): string | null => {
  let found: string | null = null
  const walk = (node: any, parentGuid: string | null) => {
    if (node.guid === guid) found = parentGuid
    for (const child of node.children ?? []) walk(child, node.guid)
  }
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(readFixture().roots[key], null)
  return found
}
check(
  'both sit in the destination folder in the file',
  movers.every((m) => parentOf(m.guid) === folder.guid),
  true,
)
check(
  'checksum still valid after the move',
  computeChecksum(readFixture().roots),
  readFixture().checksum,
)
check('no bookmark was lost', guidsInFile().size, afterGuids.size)

// ---------------------------------------------------------------- guard
console.log('\n-- safety')
const stale = db
  .prepare("SELECT id FROM bookmarks WHERE present = 1 AND source = 'chrome' LIMIT 1")
  .get() as {
  id: number
}
await call('DELETE', `/api/bookmarks/${stale.id}`)
// Point the queued op at a URL that no longer matches the node in the file.
db.prepare(
  "UPDATE bookmark_ops SET url = 'https://example.com/not-the-same' WHERE state = 'pending'",
).run()
const guarded = await applyOpsOffline(fixture, { skipRunningCheck: true })
check('a URL mismatch refuses to delete', [guarded.applied, guarded.failed], [0, 1])
check('the bookmark is still in the file', guidsInFile().size, afterGuids.size)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
await app.close()
db.close()
try {
  fs.rmSync(scratch, { recursive: true, force: true })
} catch {
  console.log(`(scratch directory left behind: ${scratch})`)
}
process.exit(failures === 0 ? 0 : 1)
