import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DATA_DIR } from '../config.ts'
import { computeChecksum } from './checksum.ts'
import { pendingOps, recordResults, type OpResult } from '../lib/ops.ts'

const run = promisify(execFile)

interface RawNode {
  id?: string
  guid?: string
  name?: string
  type?: string
  url?: string
  children?: RawNode[]
}

export interface OfflineResult {
  applied: number
  failed: number
  backup: string | null
}

/**
 * Chrome holds its bookmarks in memory and rewrites the file on its own
 * schedule, so writing while it runs is pointless at best and destructive at
 * worst — whatever we wrote is simply overwritten on the next save.
 */
export async function chromeIsRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'])
      return /chrome\.exe/i.test(stdout)
    }
    const { stdout } = await run('pgrep', [
      '-x',
      process.platform === 'darwin' ? 'Google Chrome' : 'chrome',
    ])
    return stdout.trim().length > 0
  } catch {
    // pgrep exits non-zero when nothing matches, and tasklist can be missing.
    return false
  }
}

function indexTree(json: { roots: Record<string, RawNode> }) {
  const nodes = new Map<string, { node: RawNode; parent: RawNode | null }>()
  const walk = (node: RawNode, parent: RawNode | null) => {
    if (node.guid) nodes.set(node.guid, { node, parent })
    for (const child of node.children ?? []) walk(child, node)
  }
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    const root = json.roots[key]
    if (root) walk(root, null)
  }
  return nodes
}

function detach(entry: { node: RawNode; parent: RawNode | null }): boolean {
  if (!entry.parent?.children) return false
  const index = entry.parent.children.indexOf(entry.node)
  if (index < 0) return false
  entry.parent.children.splice(index, 1)
  return true
}

/**
 * Applies every queued change straight to Chrome's Bookmarks file.
 *
 * This is the path for when the companion extension is not installed. It only
 * runs with Chrome closed, backs the file up first, re-signs it with Chrome's
 * own checksum and verifies the result before replacing the original.
 */
export async function applyOpsOffline(
  bookmarksPath: string,
  /** Tests write to a scratch copy, where a running Chrome is irrelevant. */
  options: { skipRunningCheck?: boolean } = {},
): Promise<OfflineResult> {
  const ops = pendingOps(1000)
  if (ops.length === 0) return { applied: 0, failed: 0, backup: null }

  if (!options.skipRunningCheck && (await chromeIsRunning())) {
    throw new Error(
      'Chrome is running. Close it completely and try again — Chrome keeps bookmarks in memory and would overwrite these changes.',
    )
  }

  const original = fs.readFileSync(bookmarksPath, 'utf8')
  const json = JSON.parse(original) as { roots: Record<string, RawNode>; checksum?: string }
  const nodes = indexTree(json)

  const results: OpResult[] = []
  let changed = 0

  for (const op of ops) {
    const entry = op.guid ? nodes.get(op.guid) : undefined

    if (op.op === 'delete') {
      if (!entry) {
        results.push({ id: op.id, ok: true }) // already absent: the goal is met
        continue
      }
      // Never delete on a stale guid alone — the URL has to agree.
      if (op.url && entry.node.url && entry.node.url !== op.url) {
        results.push({
          id: op.id,
          ok: false,
          error: 'The bookmark in Chrome no longer matches this URL',
        })
        continue
      }
      if (detach(entry)) {
        changed++
        results.push({ id: op.id, ok: true })
      } else {
        results.push({ id: op.id, ok: false, error: 'Could not remove it from its folder' })
      }
      continue
    }

    if (op.op === 'move') {
      const parentGuid = op.payload.parentGuid as string | undefined
      const target = parentGuid ? nodes.get(parentGuid) : undefined
      if (!entry) {
        results.push({ id: op.id, ok: false, error: 'Bookmark not found in Chrome' })
        continue
      }
      if (!target) {
        results.push({ id: op.id, ok: false, error: 'Destination folder not found in Chrome' })
        continue
      }
      detach(entry)
      target.node.children ??= []
      target.node.children.push(entry.node)
      entry.parent = target.node
      changed++
      results.push({ id: op.id, ok: true })
      continue
    }

    results.push({ id: op.id, ok: false, error: `Unsupported operation "${op.op}"` })
  }

  let backup: string | null = null

  if (changed > 0) {
    json.checksum = computeChecksum(json.roots)
    const serialised = JSON.stringify(json, null, 3)

    // Parse what we are about to write before touching anything.
    const verification = JSON.parse(serialised) as {
      roots: Record<string, RawNode>
      checksum: string
    }
    if (computeChecksum(verification.roots) !== verification.checksum) {
      throw new Error('Refusing to write: the rewritten bookmarks failed their own checksum.')
    }

    const backupDir = path.join(DATA_DIR, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    backup = path.join(
      backupDir,
      `Bookmarks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    )
    fs.writeFileSync(backup, original, 'utf8')

    // Write beside the target and rename, so a crash mid-write cannot truncate
    // the real file — the same trick Chrome itself uses.
    const temp = `${bookmarksPath}.bb-tmp`
    fs.writeFileSync(temp, serialised, 'utf8')
    fs.renameSync(temp, bookmarksPath)

    // Chrome recomputes ids from this file; a stale .bak would undo the edit.
    const chromeBak = `${bookmarksPath}.bak`
    if (fs.existsSync(chromeBak)) fs.rmSync(chromeBak, { force: true })
  }

  recordResults(results)

  return {
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    backup,
  }
}
