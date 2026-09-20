import { MAX_HTML_BYTES } from '../config.ts'
import { db, getSetting } from '../db/index.ts'
import { decodeHtml, fetchLimited, FetchError } from '../lib/http.ts'
import { indexBookmark } from '../lib/search.ts'
import { isWebUrl, originOf } from '../lib/url.ts'
import { classifyFailure } from '../lib/linkStatus.ts'
import { extractMeta } from './fetchMeta.ts'
import { extractReadable } from './readable.ts'
import { storeFavicon, storeThumbnail } from './images.ts'

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

interface BookmarkRow {
  id: number
  url: string
  domain: string
  chrome_title: string | null
}

const upsertMetadata = db.prepare(`
  INSERT INTO metadata
    (bookmark_id, title, description, site_name, favicon_path, thumb_path, thumb_source,
     accent_color, http_status, content_type, reading_time, fetched_at, fetch_error, link_status)
  VALUES
    (@bookmarkId, @title, @description, @siteName, @faviconPath, @thumbPath, @thumbSource,
     @accentColor, @httpStatus, @contentType, @readingTime, @fetchedAt, @fetchError, @linkStatus)
  ON CONFLICT(bookmark_id) DO UPDATE SET
    title = excluded.title, description = excluded.description, site_name = excluded.site_name,
    favicon_path = COALESCE(excluded.favicon_path, metadata.favicon_path),
    thumb_path = excluded.thumb_path, thumb_source = excluded.thumb_source,
    accent_color = COALESCE(excluded.accent_color, metadata.accent_color),
    http_status = excluded.http_status, content_type = excluded.content_type,
    reading_time = excluded.reading_time, fetched_at = excluded.fetched_at,
    fetch_error = excluded.fetch_error, link_status = excluded.link_status
`)

const upsertContent = db.prepare(`
  INSERT INTO content (bookmark_id, text, excerpt, word_count)
  VALUES (@bookmarkId, @text, @excerpt, @wordCount)
  ON CONFLICT(bookmark_id) DO UPDATE SET
    text = excluded.text, excerpt = excluded.excerpt, word_count = excluded.word_count
`)

/** Near-white and near-black theme colours are page chrome, not a brand accent. */
function usableAccent(value: string | null): string | null {
  if (!value) return null
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!hex) return null
  let body = hex[1]!.toLowerCase()
  if (body.length === 3)
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(body.slice(0, 2), 16)
  const g = parseInt(body.slice(2, 4), 16)
  const b = parseInt(body.slice(4, 6), 16)
  const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
  if (lightness > 236 || lightness < 20) return null
  return `#${body}`
}

export function isDomainSkipped(domain: string): boolean {
  const list = getSetting('skip_domains', '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return list.some((entry) => domain === entry || domain.endsWith(`.${entry}`))
}

/**
 * Fetches one bookmark's page and stores what it finds. The only network calls
 * are to the bookmarked site itself and to asset URLs that page declares — never
 * to a third-party metadata or favicon service.
 */
export async function enrichBookmark(bookmarkId: number): Promise<void> {
  const bookmark = db
    .prepare('SELECT id, url, domain, chrome_title FROM bookmarks WHERE id = ?')
    .get(bookmarkId) as BookmarkRow | undefined
  if (!bookmark) throw new Error('Bookmark not found')
  if (!isWebUrl(bookmark.url)) throw new FetchError('Not an http(s) URL')
  if (isDomainSkipped(bookmark.domain)) throw new FetchError('Domain is on the skip list')

  const origin = originOf(bookmark.url)
  const rootIcon = origin ? [`${origin}/favicon.ico`] : []

  let res
  try {
    res = await fetchLimited(bookmark.url, { maxBytes: MAX_HTML_BYTES, accept: HTML_ACCEPT })
  } catch (err) {
    // A page can refuse us (403, 429, a bot wall) and still serve /favicon.ico.
    // Grabbing it means the card gets the site's mark and colour instead of a
    // bare monogram, so a blocked link still looks like the site it points at.
    const icon = await storeFavicon(bookmark.domain, rootIcon)
    if (icon) {
      db.prepare(
        `INSERT INTO metadata (bookmark_id, favicon_path, accent_color)
         VALUES (?, ?, ?)
         ON CONFLICT(bookmark_id) DO UPDATE SET
           favicon_path = excluded.favicon_path,
           accent_color = COALESCE(metadata.accent_color, excluded.accent_color)`,
      ).run(bookmarkId, icon.urlPath, icon.accent)
    }
    throw err
  }

  const isHtml = /text\/html|application\/xhtml|text\/plain|application\/xml/i.test(res.contentType)

  if (!isHtml) {
    // PDFs, images, downloads: record what it is, still give the card an icon.
    const icon = await storeFavicon(bookmark.domain, rootIcon)
    upsertMetadata.run({
      bookmarkId,
      title: bookmark.chrome_title || bookmark.url,
      description: null,
      siteName: bookmark.domain,
      faviconPath: icon?.urlPath ?? null,
      thumbPath: null,
      thumbSource: 'none',
      accentColor: icon?.accent ?? null,
      httpStatus: res.status,
      contentType: res.contentType.split(';')[0] ?? null,
      readingTime: null,
      fetchedAt: Date.now(),
      fetchError: null,
      linkStatus: 'ok',
    })
    indexBookmark(bookmarkId)
    return
  }

  const html = decodeHtml(res.buffer, res.contentType)
  const meta = extractMeta(html, res.finalUrl)
  const readable = extractReadable(meta.document)

  const [thumb, icon] = await Promise.all([
    meta.imageUrl ? storeThumbnail(meta.imageUrl) : Promise.resolve(null),
    storeFavicon(bookmark.domain, [...meta.iconUrls, ...rootIcon]),
  ])

  upsertMetadata.run({
    bookmarkId,
    title: meta.title ?? readable.title ?? bookmark.chrome_title ?? bookmark.url,
    description: meta.description ?? readable.excerpt,
    siteName: meta.siteName ?? bookmark.domain,
    faviconPath: icon?.urlPath ?? null,
    thumbPath: thumb?.urlPath ?? null,
    thumbSource: thumb ? (meta.imageSource ?? 'og') : 'none',
    accentColor: usableAccent(meta.themeColor) ?? icon?.accent ?? thumb?.accent ?? null,
    httpStatus: res.status,
    contentType: res.contentType.split(';')[0] ?? null,
    readingTime: readable.readingTime,
    fetchedAt: Date.now(),
    fetchError: null,
    linkStatus: 'ok',
  })

  upsertContent.run({
    bookmarkId,
    text: readable.text,
    excerpt: readable.excerpt,
    wordCount: readable.wordCount,
  })

  indexBookmark(bookmarkId)
}

/** Records a failure so the card can show it, classify it and offer a retry. */
export function recordFailure(bookmarkId: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  const status = err instanceof FetchError ? err.status : undefined
  const code = err instanceof FetchError ? err.code : undefined
  const bookmark = db
    .prepare('SELECT chrome_title, domain, url FROM bookmarks WHERE id = ?')
    .get(bookmarkId) as { chrome_title: string | null; domain: string; url: string } | undefined
  upsertMetadata.run({
    bookmarkId,
    title: bookmark?.chrome_title || bookmark?.url || null,
    description: null,
    siteName: bookmark?.domain ?? null,
    faviconPath: null,
    thumbPath: null,
    thumbSource: 'none',
    accentColor: null,
    httpStatus: status ?? null,
    contentType: null,
    readingTime: null,
    fetchedAt: Date.now(),
    fetchError: message.slice(0, 300),
    linkStatus: classifyFailure(status, code),
  })
  indexBookmark(bookmarkId)
}
