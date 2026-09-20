import fs from 'node:fs'
import crypto from 'node:crypto'
import { domainOf, urlHash } from '../lib/url.ts'

/** Chrome timestamps are microseconds since 1601-01-01 (the WebKit epoch). */
const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000

export function webkitToMs(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n / 1000 - WEBKIT_EPOCH_OFFSET_MS)
}

export interface ParsedFolder {
  guid: string
  /** Chrome's own node id, needed by the chrome.bookmarks write-back API. */
  chromeId: string | null
  parentGuid: string | null
  root: string
  name: string
  path: string
  depth: number
  position: number
  dateAdded: number | null
}

export interface ParsedBookmark {
  guid: string
  chromeId: string | null
  folderGuid: string
  url: string
  urlHash: string
  domain: string
  title: string
  position: number
  dateAdded: number | null
  dateLastUsed: number | null
}

export interface ParsedTree {
  folders: ParsedFolder[]
  bookmarks: ParsedBookmark[]
  /** Content hash, so an unchanged file is a no-op. */
  fingerprint: string
}

interface RawNode {
  guid?: string
  id?: string
  name?: string
  type?: string
  url?: string
  date_added?: string
  date_last_used?: string
  children?: RawNode[]
}

const ROOT_KEYS = ['bookmark_bar', 'other', 'synced'] as const
const ROOT_FALLBACK_NAMES: Record<string, string> = {
  bookmark_bar: 'Bookmarks bar',
  other: 'Other bookmarks',
  synced: 'Mobile bookmarks',
}

/**
 * Reads the Bookmarks file, tolerating a read that lands mid-save. Chrome writes
 * to a temp file and renames, so a read can catch a locked or truncated file.
 */
export async function readBookmarksFile(filePath: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      JSON.parse(raw) // validate before returning
      return raw
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  // Last resort: Chrome's own backup of the previous good state.
  const backup = `${filePath}.bak`
  if (fs.existsSync(backup)) {
    const raw = fs.readFileSync(backup, 'utf8')
    JSON.parse(raw)
    return raw
  }
  throw lastError instanceof Error ? lastError : new Error('Could not read Bookmarks file')
}

export function parseBookmarks(raw: string): ParsedTree {
  const json = JSON.parse(raw)
  const folders: ParsedFolder[] = []
  const bookmarks: ParsedBookmark[] = []

  const walk = (
    node: RawNode,
    root: string,
    parentGuid: string,
    parentPath: string,
    depth: number,
  ) => {
    const children = node.children ?? []
    children.forEach((child, index) => {
      const guid = child.guid ?? `${parentGuid}:${child.id ?? index}`
      const name = child.name ?? ''
      if (child.type === 'folder' || Array.isArray(child.children)) {
        const folderPath = parentPath ? `${parentPath}/${name}` : name
        folders.push({
          guid,
          chromeId: child.id ?? null,
          parentGuid,
          root,
          name,
          path: folderPath,
          depth,
          position: index,
          dateAdded: webkitToMs(child.date_added),
        })
        walk(child, root, guid, folderPath, depth + 1)
      } else if (child.type === 'url' && child.url) {
        bookmarks.push({
          guid,
          chromeId: child.id ?? null,
          folderGuid: parentGuid,
          url: child.url,
          urlHash: urlHash(child.url),
          domain: domainOf(child.url),
          title: name,
          position: index,
          dateAdded: webkitToMs(child.date_added),
          dateLastUsed: webkitToMs(child.date_last_used),
        })
      }
    })
  }

  for (const key of ROOT_KEYS) {
    const rootNode: RawNode | undefined = json?.roots?.[key]
    if (!rootNode) continue
    const guid = rootNode.guid ?? key
    const name = rootNode.name ?? ROOT_FALLBACK_NAMES[key] ?? key
    folders.push({
      guid,
      chromeId: rootNode.id ?? null,
      parentGuid: null,
      root: key,
      name,
      path: name,
      depth: 0,
      position: ROOT_KEYS.indexOf(key),
      dateAdded: webkitToMs(rootNode.date_added),
    })
    walk(rootNode, key, guid, name, 1)
  }

  return {
    folders,
    bookmarks,
    fingerprint: crypto.createHash('sha1').update(raw).digest('hex'),
  }
}
