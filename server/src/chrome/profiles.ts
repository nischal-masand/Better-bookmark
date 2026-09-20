import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface ChromeProfile {
  /** Directory name, e.g. 'Default' or 'Profile 1'. */
  dir: string
  /** Human name from Chrome's Local State, falling back to the directory name. */
  label: string
  bookmarksPath: string
  modified: number
}

function userDataDirs(): string[] {
  const home = os.homedir()
  switch (process.platform) {
    case 'win32': {
      const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
      return [path.join(local, 'Google', 'Chrome', 'User Data')]
    }
    case 'darwin':
      return [path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')]
    default:
      return [path.join(home, '.config', 'google-chrome')]
  }
}

function profileLabels(userData: string): Record<string, string> {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'))
    const cache = state?.profile?.info_cache ?? {}
    const out: Record<string, string> = {}
    for (const [dir, info] of Object.entries<any>(cache)) {
      if (typeof info?.name === 'string') out[dir] = info.name
    }
    return out
  } catch {
    return {}
  }
}

/** Every Chrome profile on this machine that actually has a Bookmarks file. */
export function findProfiles(): ChromeProfile[] {
  const found: ChromeProfile[] = []
  for (const userData of userDataDirs()) {
    if (!fs.existsSync(userData)) continue
    const labels = profileLabels(userData)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(userData, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const bookmarksPath = path.join(userData, entry.name, 'Bookmarks')
      if (!fs.existsSync(bookmarksPath)) continue
      found.push({
        dir: entry.name,
        label: labels[entry.name] ?? entry.name,
        bookmarksPath,
        modified: fs.statSync(bookmarksPath).mtimeMs,
      })
    }
  }
  // Default first, then most recently written.
  return found.sort((a, b) =>
    a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : b.modified - a.modified,
  )
}

export function resolveProfile(preferredDir?: string): ChromeProfile | null {
  if (process.env.BB_BOOKMARKS_PATH) {
    const p = process.env.BB_BOOKMARKS_PATH
    if (fs.existsSync(p)) {
      return {
        dir: 'custom',
        label: 'Custom path',
        bookmarksPath: p,
        modified: fs.statSync(p).mtimeMs,
      }
    }
  }
  const profiles = findProfiles()
  if (preferredDir) {
    const match = profiles.find((p) => p.dir === preferredDir)
    if (match) return match
  }
  return profiles[0] ?? null
}
