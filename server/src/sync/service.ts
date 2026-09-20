import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { POLL_INTERVAL_MS } from '../config.ts'
import { getSetting, setSetting } from '../db/index.ts'
import { parseBookmarks, readBookmarksFile } from '../chrome/parse.ts'
import { resolveProfile, type ChromeProfile } from '../chrome/profiles.ts'
import { reconcile, type SyncResult } from './reconcile.ts'
import { bus } from '../events.ts'
import { wakeWorker } from '../enrich/worker.ts'

let activeProfile: ChromeProfile | null = null
let watcher: FSWatcher | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastStat = ''
let inFlight: Promise<SyncResult> | null = null
let lastError: string | null = null

export function currentProfile(): ChromeProfile | null {
  return activeProfile
}

export function lastSyncError(): string | null {
  return lastError
}

function loadProfile(): ChromeProfile | null {
  const preferred = getSetting('chrome_profile', '') || undefined
  activeProfile = resolveProfile(preferred)
  return activeProfile
}

async function runSync(force: boolean): Promise<SyncResult> {
  const profile = activeProfile ?? loadProfile()
  if (!profile)
    throw new Error('No Chrome profile with a Bookmarks file was found on this machine.')

  const raw = await readBookmarksFile(profile.bookmarksPath)
  const tree = parseBookmarks(raw)
  const result = reconcile(tree, force)
  lastError = null

  if (!result.skipped) {
    bus.emitEvent({
      type: 'sync',
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      resurrected: result.resurrected,
    })
  }
  wakeWorker()
  return result
}

/** Serialised so a burst of file events cannot overlap imports. */
export function syncNow(force = false): Promise<SyncResult> {
  const next = (inFlight ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => runSync(force))
    .catch((err) => {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    })
  inFlight = next as Promise<SyncResult>
  return next
}

export function switchProfile(dir: string): ChromeProfile | null {
  setSetting('chrome_profile', dir)
  setSetting('last_fingerprint', '')
  const profile = loadProfile()
  stopWatching()
  if (profile) startWatching()
  return profile
}

function statSignature(filePath: string): string {
  try {
    const s = fs.statSync(filePath)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return ''
  }
}

/**
 * Chrome saves bookmarks by writing a temp file and renaming it over the
 * original. A watcher pointed at the file itself never sees that on Windows —
 * the inode it was watching is simply replaced — so watch the containing
 * directory and filter down to the one filename. The poll is still the
 * guarantee: it is one stat call, and it is what bounds the worst case.
 */
export function startWatching(): void {
  const profile = activeProfile ?? loadProfile()
  if (!profile) return

  lastStat = statSignature(profile.bookmarksPath)

  const dir = path.dirname(profile.bookmarksPath)
  const base = path.basename(profile.bookmarksPath)

  watcher = chokidar.watch(dir, {
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 80 },
    // The Chrome profile directory churns constantly (History, Cookies, …);
    // everything but the Bookmarks file is dropped before it reaches us.
    ignored: (candidate: string) => candidate !== dir && path.basename(candidate) !== base,
  })

  const onChange = () => {
    lastStat = statSignature(profile.bookmarksPath)
    void syncNow().catch((err) => console.error('[sync] watch import failed:', err.message))
  }
  watcher.on('add', onChange)
  watcher.on('change', onChange)
  watcher.on('error', (err) => console.error('[sync] watcher error:', err))

  pollTimer = setInterval(() => {
    const signature = statSignature(profile.bookmarksPath)
    if (signature && signature !== lastStat) {
      lastStat = signature
      void syncNow().catch((err) => console.error('[sync] poll import failed:', err.message))
    }
  }, POLL_INTERVAL_MS)
  pollTimer.unref()
}

export function stopWatching(): void {
  void watcher?.close()
  watcher = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
