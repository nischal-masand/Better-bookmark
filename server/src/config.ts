import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Repo root — server/src/config.ts -> ../../ */
export const ROOT = path.resolve(here, '..', '..')
export const DATA_DIR = process.env.BB_DATA_DIR ?? path.join(ROOT, 'data')
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs')
export const ICONS_DIR = path.join(DATA_DIR, 'icons')
export const DB_PATH = path.join(DATA_DIR, 'bookmarks.db')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')

export const PORT = Number(process.env.BB_PORT ?? 8765)
/** Loopback only. This app is never exposed to the network. */
export const HOST = '127.0.0.1'

/**
 * Serve the built UI whenever there is one, rather than keying off NODE_ENV.
 * That way `node server/src/index.ts` just works from a shortcut or a scheduled
 * task with no environment to set up. `npm run dev` sets BB_API_ONLY so Vite
 * stays the one serving the client during development.
 */
export const SERVE_WEB =
  process.env.BB_API_ONLY !== '1' && fs.existsSync(path.join(WEB_DIST, 'index.html'))

/** Enrichment fetches are the only outbound traffic; keep them polite and bounded. */
export const FETCH_CONCURRENCY = 4
export const FETCH_TIMEOUT_MS = 12_000
export const MAX_HTML_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_ENRICH_ATTEMPTS = 3
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

export const THUMB_WIDTH = 640
export const ICON_SIZE = 64

/**
 * How often to re-stat the Bookmarks file. This is not a fallback of last
 * resort: on Windows the fs watcher regularly misses Chrome's atomic rename,
 * so the poll is what actually bounds how stale the library can get. It is a
 * single stat call, so a few seconds costs nothing.
 */
export const POLL_INTERVAL_MS = 3_000

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, THUMBS_DIR, ICONS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
