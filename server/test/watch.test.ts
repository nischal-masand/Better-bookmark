/**
 * Guards the Windows-specific failure this app hit in development: Chrome
 * replaces the Bookmarks file by renaming a temp file over it, and a watcher
 * pointed at the file never sees that.
 *
 * Runs against a scratch COPY -- see harness.ts.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { setupScratch } from './harness.ts'

const { scratch, fixture } = setupScratch('bb-watch-')

const { db } = await import('../src/db/index.ts')
const { syncNow, startWatching, stopWatching } = await import('../src/sync/service.ts')
const { bus } = await import('../src/events.ts')

await syncNow()
const before = (db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE present = 1').get() as any).n
startWatching()

const saw = new Promise<string>((resolve) => {
  const off = bus.onEvent((e) => {
    if (e.type === 'sync') {
      off()
      resolve(`sync event: +${e.added}`)
    }
  })
  setTimeout(() => {
    off()
    resolve('TIMEOUT - watcher never fired')
  }, 15000)
})

// Write the way Chrome does: temp file, then atomic rename over the original.
const json = JSON.parse(fs.readFileSync(fixture, 'utf8'))
json.roots.bookmark_bar.children.push({
  date_added: '13300000000000000',
  guid: crypto.randomUUID(),
  id: '99999',
  name: 'Watcher Test',
  type: 'url',
  url: 'https://example.com/watcher-test',
})
const tmp = `${fixture}.tmp`
fs.writeFileSync(tmp, JSON.stringify(json))
fs.renameSync(tmp, fixture)
console.log('wrote via temp-file + rename, exactly as Chrome saves')

const started = Date.now()
console.log(await saw, `after ${Date.now() - started}ms`)
const after = (db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE present = 1').get() as any).n
console.log(`bookmarks ${before} -> ${after}`, after === before + 1 ? 'PASS' : 'FAIL')

stopWatching()
db.close()
try {
  fs.rmSync(scratch, { recursive: true, force: true })
} catch {}
process.exit(after === before + 1 ? 0 : 1)
