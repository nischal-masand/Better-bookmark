import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_PATH, ensureDirs } from '../config.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

ensureDirs()

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'))

/**
 * CREATE TABLE IF NOT EXISTS leaves existing tables alone, so columns added
 * after a database was first created have to be applied by hand. Adding a
 * column is the only migration shape this app has needed; anything structural
 * would warrant a real versioned migration list.
 */
function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

addColumn('bookmarks', 'source', "TEXT NOT NULL DEFAULT 'chrome'")
addColumn('metadata', 'link_status', 'TEXT')
addColumn('user_data', 'hidden', 'INTEGER NOT NULL DEFAULT 0')
addColumn('user_data', 'hidden_at', 'INTEGER')
addColumn('bookmarks', 'chrome_id', 'TEXT')
addColumn('folders', 'chrome_id', 'TEXT')

// Rows fetched before link_status existed already carry the answer in their
// error text, so classify them from that rather than re-fetching every site.
// Idempotent: only ever touches rows where link_status is still NULL.
db.exec(`
  UPDATE metadata SET link_status = CASE
    WHEN fetch_error IS NULL                       THEN 'ok'
    WHEN fetch_error LIKE 'HTTP 404%'
      OR fetch_error LIKE 'HTTP 410%'
      OR fetch_error LIKE 'Domain no longer exists%' THEN 'dead'
    WHEN fetch_error LIKE 'HTTP 401%'
      OR fetch_error LIKE 'HTTP 402%'
      OR fetch_error LIKE 'HTTP 403%'
      OR fetch_error LIKE 'HTTP 407%'
      OR fetch_error LIKE 'HTTP 429%'
      OR fetch_error LIKE 'HTTP 451%'              THEN 'blocked'
    ELSE 'unreachable'
  END
  WHERE link_status IS NULL AND fetched_at IS NOT NULL
`)

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
