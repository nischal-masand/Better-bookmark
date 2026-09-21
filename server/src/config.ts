import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * True when running from the bundle `npx better-bookmark` fetches, which the
 * build stamps in with esbuild's `define`. In a checkout nothing sets it.
 */
export const PACKAGED = process.env.BB_PACKAGED === '1'

/**
 * Package root, found by climbing until a package.json claims to be ours.
 * The number of hops differs between a checkout (server/src/config.ts) and the
 * bundle (dist/server/index.js), and npm is free to nest the install deeper
 * still, so looking for the marker is the only thing that holds in both.
 */
function findPackageRoot(start: string): string {
  let dir = start
  for (let depth = 0; depth < 16; depth += 1) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string }
        if (pkg.name === 'better-bookmark') return dir
      } catch {
        // Some other package's unreadable manifest is not a reason to stop climbing.
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Could not find the better-bookmark package root above ${start}. ` +
      'The install looks incomplete — reinstall the package.',
  )
}

export const ROOT = findPackageRoot(here)

/**
 * Where the library actually lives: database, thumbnails, icons.
 *
 * A checkout keeps it in `data/` next to the source, which is easy to find and
 * easy to wipe deliberately. A packaged run must not, because `npx` runs us out
 * of npm's cache and npm prunes that cache on its own schedule — a database
 * written beside the code would take every bookmark, tag and note with it the
 * day npm decided to reclaim the space, with no warning and nothing to restore
 * from. So packaged installs write to the per-user data directory the OS
 * promises to keep.
 */
function defaultDataDir(): string {
  if (!PACKAGED) return path.join(ROOT, 'data')

  const home = os.homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    return path.join(appData, 'better-bookmark')
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'better-bookmark')
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return path.join(dataHome, 'better-bookmark')
}

export const DATA_DIR = process.env.BB_DATA_DIR ?? defaultDataDir()
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs')
export const ICONS_DIR = path.join(DATA_DIR, 'icons')
export const DB_PATH = path.join(DATA_DIR, 'bookmarks.db')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')

/**
 * The bundle has no source tree beside it, so the build copies schema.sql in
 * next to the bundled entrypoint rather than leaving it where the source keeps it.
 */
export const SCHEMA_PATH = PACKAGED
  ? path.join(ROOT, 'dist', 'server', 'schema.sql')
  : path.join(ROOT, 'server', 'src', 'db', 'schema.sql')

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

/**
 * The folder users point Chrome's "Load unpacked" at.
 *
 * Chrome reads an unpacked extension from its folder on every launch, so that
 * folder has to outlive the process that told the user about it. In a checkout
 * that is simply `extension/`. A packaged run has the same problem as the
 * database: the bundled copy sits in npm's cache, and the day npm prunes it the
 * extension silently stops loading. So packaged installs hand Chrome a copy in
 * the data directory instead.
 */
export const EXTENSION_DIR = PACKAGED
  ? path.join(DATA_DIR, 'extension')
  : path.join(ROOT, 'extension')

/**
 * Refreshes the data-directory copy of the extension from the installed
 * package. Runs at every boot, so upgrading the package upgrades the extension
 * too — Chrome picks up the new files the next time it reloads it.
 */
export function syncPackagedExtension(): void {
  if (!PACKAGED) return
  try {
    fs.cpSync(path.join(ROOT, 'extension'), EXTENSION_DIR, { recursive: true, force: true })
  } catch (err) {
    // A stale extension copy is survivable; refusing to start is not.
    console.warn(
      `[extension] could not refresh ${EXTENSION_DIR}:`,
      err instanceof Error ? err.message : err,
    )
  }
}
