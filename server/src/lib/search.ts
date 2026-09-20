import { db } from '../db/index.ts'

/** Column order must match the bookmarks_fts declaration. */
export const BM25_WEIGHTS = [10, 3, 2, 1, 8] as const

const deleteRow = db.prepare('DELETE FROM bookmarks_fts WHERE bookmark_id = ?')
const insertRow = db.prepare(
  'INSERT INTO bookmarks_fts (title, description, url, text, notes, bookmark_id) VALUES (?, ?, ?, ?, ?, ?)',
)
const readRow = db.prepare(`
  SELECT b.url,
         COALESCE(u.custom_title, m.title, b.chrome_title, '') AS title,
         COALESCE(m.description, c.excerpt, '')                AS description,
         COALESCE(c.text, '')                                  AS text,
         COALESCE(u.notes, '')                                 AS notes
  FROM bookmarks b
  LEFT JOIN metadata  m ON m.bookmark_id = b.id
  LEFT JOIN content   c ON c.bookmark_id = b.id
  LEFT JOIN user_data u ON u.bookmark_id = b.id
  WHERE b.id = ?
`)

/** Rebuilds one bookmark's search row from whatever the DB currently holds. */
export const indexBookmark = db.transaction((bookmarkId: number) => {
  const row = readRow.get(bookmarkId) as
    { url: string; title: string; description: string; text: string; notes: string } | undefined
  deleteRow.run(bookmarkId)
  if (!row) return
  insertRow.run(row.title, row.description, row.url, row.text, row.notes, bookmarkId)
})

export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when the query has no free text. */
  match: string | null
  tags: string[]
  sites: string[]
  folders: string[]
  flags: string[]
}

const FILTER_RE = /\b(tag|site|folder|is):("[^"]+"|\S+)/gi

/**
 * Splits `rust tag:reading is:favorite` into a MATCH expression plus structured
 * filters. Every free-text token is quoted, so punctuation in a URL or a stray
 * quote can never produce an FTS5 syntax error.
 */
export function parseQuery(raw: string): ParsedQuery {
  const tags: string[] = []
  const sites: string[] = []
  const folders: string[] = []
  const flags: string[] = []

  const text = raw.replace(FILTER_RE, (_full, key: string, value: string) => {
    const clean = value.replace(/^"|"$/g, '').toLowerCase()
    if (key.toLowerCase() === 'tag') tags.push(clean)
    else if (key.toLowerCase() === 'site') sites.push(clean)
    else if (key.toLowerCase() === 'folder') folders.push(clean)
    else flags.push(clean)
    return ' '
  })

  const tokens = text
    .split(/\s+/)
    .map((token) => token.replace(/["*()]/g, '').trim())
    .filter((token) => token.length > 0)

  const match = tokens.length
    ? tokens
        .map((token, i) => (i === tokens.length - 1 ? `"${token}"*` : `"${token}"`))
        .join(' AND ')
    : null

  return { match, tags, sites, folders, flags }
}
