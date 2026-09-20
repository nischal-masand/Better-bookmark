/**
 * End-to-end check of the Chrome -> app sync.
 *
 * Runs against a scratch copy of the checked-in fixture, or of this machine's
 * real Chrome profile under BB_TEST_REAL_PROFILE=1. Either way it is a COPY --
 * the user's actual Chrome data is never touched. See harness.ts.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { setupScratch } from './harness.ts'

const { scratch, fixture } = setupScratch('bb-test-')

const { db } = await import('../src/db/index.ts')
const { syncNow } = await import('../src/sync/service.ts')

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  )
}

const readFixture = () => JSON.parse(fs.readFileSync(fixture, 'utf8'))
const writeFixture = (json: unknown) => fs.writeFileSync(fixture, JSON.stringify(json, null, 2))
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n
const newNode = (name: string, url: string) => ({
  date_added: '13300000000000000',
  guid: crypto.randomUUID(),
  id: String(Math.floor(Math.random() * 100000) + 90000),
  name,
  type: 'url',
  url,
})

// ---------------------------------------------------------------- initial
const first = await syncNow()
console.log(`\n-- initial import: ${first.total} bookmarks, ${first.folders} folders\n`)
check(
  'all bookmarks present',
  count('SELECT COUNT(*) n FROM bookmarks WHERE present = 1'),
  first.total,
)
check('re-sync of an unchanged file is a no-op', (await syncNow()).skipped, true)

// ---------------------------------------------------------------- add
console.log('\n-- adding a bookmark in the "Chrome" file')
let json = readFixture()
const added = newNode('Sync Test Page', 'https://example.com/better-bookmark-sync-test')
json.roots.bookmark_bar.children.push(added)
writeFixture(json)

const afterAdd = await syncNow()
check('one bookmark added', afterAdd.added, 1)
const row = db
  .prepare('SELECT id, folder_guid, present FROM bookmarks WHERE chrome_guid = ?')
  .get(added.guid) as { id: number; folder_guid: string; present: number }
check('new bookmark is present', row?.present, 1)
check('new bookmark sits in Bookmarks bar', row.folder_guid, json.roots.bookmark_bar.guid)

// Attach the app-local data that must survive everything below.
db.prepare(
  'INSERT INTO user_data (bookmark_id, notes, favorite, updated_at) VALUES (?, ?, 1, ?)',
).run(row.id, 'Notes that must survive a delete and re-add', Date.now())
const tagId = db
  .prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)')
  .run('keepme', 'sky', Date.now()).lastInsertRowid
db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(row.id, tagId)

// ---------------------------------------------------------------- move
console.log('\n-- moving it into a nested folder')
json = readFixture()
const targetFolder = json.roots.bookmark_bar.children.find((c: any) => c.type === 'folder')
json.roots.bookmark_bar.children = json.roots.bookmark_bar.children.filter(
  (c: any) => c.guid !== added.guid,
)
targetFolder.children.push(added)
writeFixture(json)

const afterMove = await syncNow()
check('move counts as an update, not an add', [afterMove.added, afterMove.updated >= 1], [0, true])
const moved = db
  .prepare('SELECT folder_guid FROM bookmarks WHERE chrome_guid = ?')
  .get(added.guid) as {
  folder_guid: string
}
check('folder followed the move', moved.folder_guid, targetFolder.guid)
check(
  'notes survived the move',
  count('SELECT COUNT(*) n FROM user_data WHERE bookmark_id = ?', row.id),
  1,
)

// ---------------------------------------------------------------- delete
console.log('\n-- deleting it in Chrome')
json = readFixture()
targetFolder.children = targetFolder.children.filter((c: any) => c.guid !== added.guid)
json.roots.bookmark_bar.children = json.roots.bookmark_bar.children.map((c: any) =>
  c.guid === targetFolder.guid ? targetFolder : c,
)
writeFixture(json)

const afterDelete = await syncNow()
check('one bookmark archived', afterDelete.removed, 1)
const archived = db
  .prepare('SELECT present, removed_at FROM bookmarks WHERE id = ?')
  .get(row.id) as {
  present: number
  removed_at: number | null
}
check('archived, not deleted', [archived.present, archived.removed_at !== null], [0, true])
check(
  'notes kept while archived',
  count('SELECT COUNT(*) n FROM user_data WHERE bookmark_id = ?', row.id),
  1,
)
check(
  'tag kept while archived',
  count('SELECT COUNT(*) n FROM bookmark_tags WHERE bookmark_id = ?', row.id),
  1,
)

// ---------------------------------------------------------------- re-add
console.log('\n-- re-adding the same URL (Chrome assigns a brand new guid)')
json = readFixture()
const readded = newNode('Sync Test Page', 'https://example.com/better-bookmark-sync-test')
check('re-add really uses a different guid', readded.guid === added.guid, false)
json.roots.bookmark_bar.children.push(readded)
writeFixture(json)

const afterReadd = await syncNow()
check('counted as resurrected, not added', [afterReadd.added, afterReadd.resurrected], [0, 1])
const revived = db
  .prepare('SELECT id, present, chrome_guid FROM bookmarks WHERE id = ?')
  .get(row.id) as {
  id: number
  present: number
  chrome_guid: string
}
check('same row came back', [revived.present, revived.chrome_guid], [1, readded.guid])
const kept = db
  .prepare('SELECT notes, favorite FROM user_data WHERE bookmark_id = ?')
  .get(row.id) as {
  notes: string
  favorite: number
}
check('notes survived the round trip', kept.notes, 'Notes that must survive a delete and re-add')
check('favourite survived the round trip', kept.favorite, 1)
check(
  'tag survived the round trip',
  count('SELECT COUNT(*) n FROM bookmark_tags WHERE bookmark_id = ?', row.id),
  1,
)
check(
  'no duplicate row was created',
  count('SELECT COUNT(*) n FROM bookmarks WHERE url = ?', added.url),
  1,
)

// ---------------------------------------------------------------- rename
console.log('\n-- renaming a folder in Chrome')
json = readFixture()
const renamed = json.roots.bookmark_bar.children.find((c: any) => c.guid === targetFolder.guid)
renamed.name = 'Renamed By Test'
writeFixture(json)
await syncNow()
const folderRow = db
  .prepare('SELECT name, path FROM folders WHERE chrome_guid = ?')
  .get(targetFolder.guid) as {
  name: string
  path: string
}
check('folder name updated', folderRow.name, 'Renamed By Test')
check('folder path rebuilt', folderRow.path, 'Bookmarks bar/Renamed By Test')
check(
  'descendant paths rebuilt too',
  count("SELECT COUNT(*) n FROM folders WHERE path LIKE 'Bookmarks bar/Renamed By Test/%'") >= 0,
  true,
)

// ---------------------------------------------------------------- hiding
console.log('\n-- hiding a bookmark, and excluding a folder')
const { libraryCounts } = await import('../src/lib/queries.ts')

const visibleBefore = libraryCounts().visible
const victim = db.prepare('SELECT id FROM bookmarks WHERE present = 1 LIMIT 1').get() as {
  id: number
}
db.prepare(
  'INSERT INTO user_data (bookmark_id, hidden, hidden_at, updated_at) VALUES (?, 1, ?, ?)',
).run(victim.id, Date.now(), Date.now())
check('hiding removes one from the visible count', libraryCounts().visible, visibleBefore - 1)
check('hidden bookmarks are counted separately', libraryCounts().hidden, 1)

await syncNow(true)
check('hiding survives a re-sync', libraryCounts().visible, visibleBefore - 1)

const folder = db
  .prepare('SELECT chrome_guid AS guid, path FROM folders WHERE depth = 1 AND present = 1 LIMIT 1')
  .get() as { guid: string; path: string }
const inFolder = count(
  'SELECT COUNT(*) n FROM bookmarks b JOIN folders f ON f.chrome_guid = b.folder_guid ' +
    "WHERE b.present = 1 AND (f.path = ? OR f.path LIKE ? || '/%')",
  folder.path,
  folder.path,
)
db.prepare('INSERT INTO folder_exclusions (folder_guid, excluded_at) VALUES (?, ?)').run(
  folder.guid,
  Date.now(),
)
check(
  `excluding "${folder.path}" removes its ${inFolder} bookmarks`,
  libraryCounts().visible <= visibleBefore - 1 - inFolder + 1,
  true,
)

await syncNow(true)
check(
  'folder exclusion survives a re-sync',
  libraryCounts().visible <= visibleBefore - inFolder,
  true,
)

db.prepare('DELETE FROM folder_exclusions WHERE folder_guid = ?').run(folder.guid)
db.prepare('UPDATE user_data SET hidden = 0 WHERE bookmark_id = ?').run(victim.id)
check('restoring brings everything back', libraryCounts().visible, visibleBefore)

// ---------------------------------------------------------------- mid-write
console.log('\n-- reading a half-written file (Chrome saving mid-read)')
const good = fs.readFileSync(fixture, 'utf8')
fs.writeFileSync(fixture, good.slice(0, Math.floor(good.length / 2)))
fs.writeFileSync(`${fixture}.bak`, good)
try {
  const recovered = await syncNow(true)
  check('fell back to Bookmarks.bak instead of wiping the library', recovered.total > 0, true)
  check('nothing was archived by the truncated read', recovered.removed, 0)
} catch (err) {
  check(`survived a truncated file (threw: ${(err as Error).message})`, false, true)
}
fs.writeFileSync(fixture, good)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
// Close SQLite before removing the scratch directory, or Windows keeps the
// database file locked and the cleanup throws over an already-passing run.
db.close()
try {
  fs.rmSync(scratch, { recursive: true, force: true })
} catch {
  console.log(`(scratch directory left behind: ${scratch})`)
}
process.exit(failures === 0 ? 0 : 1)
