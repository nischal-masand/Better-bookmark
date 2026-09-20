import { db } from '../db/index.ts'
import type { LinkStatus } from './linkStatus.ts'
import { BM25_WEIGHTS, parseQuery } from './search.ts'

export interface BookmarkDTO {
  id: number
  url: string
  domain: string
  title: string
  description: string | null
  siteName: string | null
  favicon: string | null
  thumb: string | null
  accent: string | null
  folderGuid: string | null
  folderName: string | null
  folderPath: string | null
  dateAdded: number | null
  favorite: boolean
  hidden: boolean
  notes: string | null
  readingTime: number | null
  error: string | null
  linkStatus: LinkStatus | null
  httpStatus: number | null
  archived: boolean
  local: boolean
  fetched: boolean
  tags: Array<{ id: number; name: string; color: string }>
  snippet?: string
}

export interface ListOptions {
  folder?: string
  tag?: string
  q?: string
  sort?: 'recent' | 'oldest' | 'title' | 'domain' | 'relevance'
  limit?: number
  offset?: number
}

export interface ListResult {
  items: BookmarkDTO[]
  total: number
}

interface Row {
  id: number
  url: string
  domain: string
  title: string | null
  description: string | null
  site_name: string | null
  favicon_path: string | null
  thumb_path: string | null
  accent_color: string | null
  folder_guid: string | null
  folder_name: string | null
  folder_path: string | null
  date_added: number | null
  favorite: number | null
  hidden: number | null
  notes: string | null
  reading_time: number | null
  fetch_error: string | null
  link_status: LinkStatus | null
  http_status: number | null
  fetched_at: number | null
  present: number
  source: string
  snippet?: string | null
}

const SELECT_FIELDS = `
  b.id, b.url, b.domain, b.date_added, b.folder_guid, b.present, b.source,
  COALESCE(u.custom_title, m.title, b.chrome_title, b.url) AS title,
  m.description, m.site_name, m.favicon_path, m.thumb_path, m.accent_color,
  m.reading_time, m.fetch_error, m.fetched_at, m.link_status, m.http_status,
  u.favorite, u.notes, u.hidden,
  f.name AS folder_name, f.path AS folder_path
`

const FROM_CLAUSE = `
  FROM bookmarks b
  LEFT JOIN metadata  m ON m.bookmark_id = b.id
  LEFT JOIN user_data u ON u.bookmark_id = b.id
  LEFT JOIN folders   f ON f.chrome_guid = b.folder_guid
`

/**
 * A bookmark inside an excluded folder, or inside any of its descendants, is
 * out of the library entirely. Comparing live paths rather than the path stored
 * at exclusion time means renaming a folder in Chrome keeps it excluded.
 */
const NOT_IN_EXCLUDED_FOLDER = `
  NOT EXISTS (
    SELECT 1 FROM folder_exclusions fx
    JOIN folders ef ON ef.chrome_guid = fx.folder_guid
    WHERE f.path = ef.path OR f.path LIKE ef.path || '/%'
  )
`

const NOT_HIDDEN = 'COALESCE(u.hidden, 0) = 0'

function buildFilters(opts: ListOptions) {
  const parsed = parseQuery(opts.q ?? '')
  const where: string[] = []
  const params: unknown[] = []

  const flags = new Set(parsed.flags)
  const wantsHidden = flags.has('hidden')

  if (flags.has('archived') || flags.has('removed')) where.push('b.present = 0')
  else where.push('b.present = 1')

  // Hidden bookmarks and excluded folders are invisible everywhere except the
  // one view whose whole job is to let you put them back.
  if (wantsHidden) {
    where.push(`(COALESCE(u.hidden, 0) = 1 OR NOT (${NOT_IN_EXCLUDED_FOLDER}))`)
  } else {
    where.push(NOT_HIDDEN)
    where.push(NOT_IN_EXCLUDED_FOLDER)
  }

  if (flags.has('favorite') || flags.has('starred')) where.push('u.favorite = 1')
  if (flags.has('untagged'))
    where.push('NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)')
  if (flags.has('local')) where.push("b.source = 'local'")
  if (flags.has('unfetched')) where.push('m.fetched_at IS NULL')
  if (flags.has('broken') || flags.has('error')) where.push('m.fetch_error IS NOT NULL')
  for (const status of ['dead', 'blocked', 'unreachable'] as const) {
    if (flags.has(status)) {
      where.push('m.link_status = ?')
      params.push(status)
    }
  }

  // Folder filter covers the folder and everything nested under it.
  const folderPaths = [...parsed.folders]
  if (opts.folder) {
    const row = db.prepare('SELECT path FROM folders WHERE chrome_guid = ?').get(opts.folder) as
      { path: string } | undefined
    if (row) folderPaths.push(row.path)
  }
  for (const path of folderPaths) {
    where.push("(f.path = ? COLLATE NOCASE OR f.path LIKE ? ESCAPE '\\')")
    params.push(path, `${path.replace(/[%_\\]/g, '\\$&')}/%`)
  }

  for (const site of parsed.sites) {
    where.push('(b.domain = ? COLLATE NOCASE OR b.domain LIKE ?)')
    params.push(site, `%.${site}`)
  }

  const tagNames = [...parsed.tags]
  if (opts.tag) tagNames.push(opts.tag)
  for (const name of tagNames) {
    where.push(`EXISTS (
      SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id = b.id AND t.name = ? COLLATE NOCASE
    )`)
    params.push(name)
  }

  return { parsed, where, params }
}

const ORDER_BY: Record<NonNullable<ListOptions['sort']>, string> = {
  recent: 'b.date_added DESC, b.id DESC',
  oldest: 'b.date_added ASC, b.id ASC',
  title: 'title COLLATE NOCASE ASC',
  domain: 'b.domain COLLATE NOCASE ASC, title COLLATE NOCASE ASC',
  relevance: 'rank ASC',
}

function attachTags(rows: Row[]): Map<number, BookmarkDTO['tags']> {
  const map = new Map<number, BookmarkDTO['tags']>()
  if (rows.length === 0) return map
  const placeholders = rows.map(() => '?').join(',')
  const tagRows = db
    .prepare(
      `SELECT bt.bookmark_id AS id, t.id AS tagId, t.name, t.color
       FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.bookmark_id IN (${placeholders})
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(...rows.map((r) => r.id)) as Array<{
    id: number
    tagId: number
    name: string
    color: string
  }>
  for (const row of tagRows) {
    const list = map.get(row.id) ?? []
    list.push({ id: row.tagId, name: row.name, color: row.color })
    map.set(row.id, list)
  }
  return map
}

function toDTO(row: Row, tags: BookmarkDTO['tags']): BookmarkDTO {
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    title: row.title ?? row.url,
    description: row.description,
    siteName: row.site_name,
    favicon: row.favicon_path,
    thumb: row.thumb_path,
    accent: row.accent_color,
    folderGuid: row.folder_guid,
    folderName: row.folder_name,
    folderPath: row.folder_path,
    dateAdded: row.date_added,
    favorite: row.favorite === 1,
    hidden: row.hidden === 1,
    notes: row.notes,
    readingTime: row.reading_time,
    error: row.fetch_error,
    linkStatus: row.link_status,
    httpStatus: row.http_status,
    archived: row.present === 0,
    local: row.source === 'local',
    fetched: row.fetched_at !== null,
    tags,
    ...(row.snippet ? { snippet: row.snippet } : {}),
  }
}

export function listBookmarks(opts: ListOptions): ListResult {
  const { parsed, where, params } = buildFilters(opts)
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 1000)
  const offset = Math.max(opts.offset ?? 0, 0)

  if (parsed.match) {
    const ftsJoin = 'JOIN bookmarks_fts fts ON fts.bookmark_id = b.id'
    const sort = opts.sort && opts.sort !== 'relevance' ? ORDER_BY[opts.sort] : ORDER_BY.relevance
    const weights = BM25_WEIGHTS.join(', ')
    const sql = `
      SELECT ${SELECT_FIELDS},
             bm25(bookmarks_fts, ${weights}) AS rank,
             -- Sentinels rather than <mark>: the client renders the highlight as
             -- elements, so indexed page text can never inject markup.
             snippet(bookmarks_fts, -1, char(1), char(2), '…', 14) AS snippet
      ${FROM_CLAUSE} ${ftsJoin}
      WHERE ${where.join(' AND ')} AND bookmarks_fts MATCH ?
      ORDER BY ${sort}
      LIMIT ? OFFSET ?
    `
    const countSql = `
      SELECT COUNT(*) AS n ${FROM_CLAUSE} ${ftsJoin}
      WHERE ${where.join(' AND ')} AND bookmarks_fts MATCH ?
    `
    const rows = db.prepare(sql).all(...params, parsed.match, limit, offset) as Row[]
    const total = (db.prepare(countSql).get(...params, parsed.match) as { n: number }).n
    const tags = attachTags(rows)
    return { items: rows.map((row) => toDTO(row, tags.get(row.id) ?? [])), total }
  }

  const sort = ORDER_BY[opts.sort && opts.sort !== 'relevance' ? opts.sort : 'recent']
  const sql = `
    SELECT ${SELECT_FIELDS} ${FROM_CLAUSE}
    WHERE ${where.join(' AND ')}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `
  const rows = db.prepare(sql).all(...params, limit, offset) as Row[]
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n ${FROM_CLAUSE} WHERE ${where.join(' AND ')}`)
      .get(...params) as {
      n: number
    }
  ).n
  const tags = attachTags(rows)
  return { items: rows.map((row) => toDTO(row, tags.get(row.id) ?? [])), total }
}

export function getBookmark(id: number): (BookmarkDTO & { excerpt: string | null }) | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_FIELDS}, c.excerpt ${FROM_CLAUSE} LEFT JOIN content c ON c.bookmark_id = b.id WHERE b.id = ?`,
    )
    .get(id) as (Row & { excerpt: string | null }) | undefined
  if (!row) return null
  const tags = attachTags([row])
  return { ...toDTO(row, tags.get(row.id) ?? []), excerpt: row.excerpt }
}

export interface FolderNode {
  guid: string
  name: string
  path: string
  root: string
  depth: number
  count: number
  totalCount: number
  excluded: boolean
  children: FolderNode[]
}

/**
 * Folder tree with direct and nested counts, in Chrome's own order.
 * `includeExcluded` is for the settings screen, which has to show excluded
 * folders in order to offer them back.
 */
export function folderTree(includeExcluded = false): FolderNode[] {
  const folders = db
    .prepare(
      `SELECT chrome_guid, parent_guid, root, name, path, depth, position
       FROM folders WHERE present = 1 ORDER BY depth, position`,
    )
    .all() as Array<{
    chrome_guid: string
    parent_guid: string | null
    root: string
    name: string
    path: string
    depth: number
    position: number
  }>

  const excluded = new Set(
    (
      db.prepare('SELECT folder_guid FROM folder_exclusions').all() as Array<{
        folder_guid: string
      }>
    ).map((r) => r.folder_guid),
  )

  // Counts must agree with what the grid will actually show.
  const counts = new Map<string, number>()
  for (const row of db
    .prepare(
      `SELECT b.folder_guid AS guid, COUNT(*) AS n
       FROM bookmarks b
       LEFT JOIN user_data u ON u.bookmark_id = b.id
       WHERE b.present = 1 AND ${NOT_HIDDEN}
       GROUP BY b.folder_guid`,
    )
    .all() as Array<{ guid: string | null; n: number }>) {
    if (row.guid) counts.set(row.guid, row.n)
  }

  const nodes = new Map<string, FolderNode>()
  for (const f of folders) {
    nodes.set(f.chrome_guid, {
      guid: f.chrome_guid,
      name: f.name,
      path: f.path,
      root: f.root,
      depth: f.depth,
      count: counts.get(f.chrome_guid) ?? 0,
      totalCount: 0,
      excluded: excluded.has(f.chrome_guid),
      children: [],
    })
  }

  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodes.get(f.chrome_guid)!
    const parent = f.parent_guid ? nodes.get(f.parent_guid) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const total = (node: FolderNode): number => {
    node.totalCount = node.count + node.children.reduce((sum, child) => sum + total(child), 0)
    return node.totalCount
  }
  for (const root of roots) total(root)

  if (includeExcluded) return roots

  // Drop excluded folders and everything under them.
  const prune = (list: FolderNode[]): FolderNode[] =>
    list
      .filter((node) => !node.excluded)
      .map((node) => ({ ...node, children: prune(node.children) }))
  return prune(roots)
}

/** Flat list of excluded folders for the settings screen. */
export function excludedFolders(): Array<{
  guid: string
  name: string
  path: string
  count: number
}> {
  return db
    .prepare(
      `SELECT fx.folder_guid AS guid, f.name, f.path,
              (SELECT COUNT(*) FROM bookmarks b
               LEFT JOIN folders bf ON bf.chrome_guid = b.folder_guid
               WHERE b.present = 1 AND (bf.path = f.path OR bf.path LIKE f.path || '/%')) AS count
       FROM folder_exclusions fx
       JOIN folders f ON f.chrome_guid = fx.folder_guid
       ORDER BY f.path`,
    )
    .all() as Array<{ guid: string; name: string; path: string; count: number }>
}

/** Counts for the sidebar, all respecting hiding and folder exclusions. */
export function libraryCounts() {
  return db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE b.present = 1 AND visible) AS visible,
         COUNT(*) FILTER (WHERE b.present = 1 AND visible AND u.favorite = 1) AS favorites,
         COUNT(*) FILTER (WHERE b.present = 1 AND visible AND m.link_status = 'dead') AS dead,
         COUNT(*) FILTER (WHERE b.present = 1 AND visible AND m.link_status = 'blocked') AS blocked,
         COUNT(*) FILTER (WHERE b.present = 1 AND visible AND m.link_status = 'unreachable') AS unreachable,
         COUNT(*) FILTER (WHERE b.present = 1 AND NOT visible) AS hidden,
         COUNT(*) FILTER (WHERE b.present = 0) AS archived,
         COUNT(*) FILTER (WHERE b.present = 1 AND visible AND b.source = 'local') AS local
       FROM (
         SELECT b.*, (COALESCE(u.hidden, 0) = 0 AND ${NOT_IN_EXCLUDED_FOLDER}) AS visible
         FROM bookmarks b
         LEFT JOIN user_data u ON u.bookmark_id = b.id
         LEFT JOIN folders f ON f.chrome_guid = b.folder_guid
       ) b
       LEFT JOIN user_data u ON u.bookmark_id = b.id
       LEFT JOIN metadata  m ON m.bookmark_id = b.id`,
    )
    .get() as {
    visible: number
    favorites: number
    dead: number
    blocked: number
    unreachable: number
    hidden: number
    archived: number
    local: number
  }
}
