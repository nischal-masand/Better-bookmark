#!/usr/bin/env node
/**
 * Boots the published entry point — bin/better-bookmark.mjs loading the
 * esbuild bundle — and checks it actually serves. The test suites exercise the
 * TypeScript source through tsx; this is the only thing that proves the bundle
 * a user downloads works, and it runs on all three OSes in CI.
 *
 * Uses the checked-in fixture and a scratch data directory, so it needs no
 * Chrome and never touches a real library.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8790 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-smoke-'))
const dataDir = path.join(scratch, 'data')

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  (${detail})`}`)
}

const server = spawn(process.execPath, [path.join(ROOT, 'bin', 'better-bookmark.mjs')], {
  env: {
    ...process.env,
    BB_PORT: String(PORT),
    BB_DATA_DIR: dataDir,
    BB_BOOKMARKS_PATH: path.join(ROOT, 'server', 'test', 'fixtures', 'Bookmarks'),
    BB_PAUSE_ENRICH: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (d) => (output += d))
server.stderr.on('data', (d) => (output += d))

async function waitForStatus() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return null
    try {
      const res = await fetch(`${BASE}/api/status`)
      if (res.ok) {
        const body = await res.json()
        // The initial import runs just after listen(); wait for it to land.
        if (body.bookmarks > 0) return body
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

try {
  const status = await waitForStatus()
  check('bundle boots and answers /api/status', status !== null, 'no response within 30s')

  if (status) {
    check('imports the fixture', status.bookmarks === 14, `got ${status.bookmarks}`)

    const page = await fetch(`${BASE}/`)
    const html = await page.text()
    check('serves the built UI', page.ok && html.includes('<div id="root">'), `HTTP ${page.status}`)

    // Proves the esbuild `define` took: only a packaged run relocates the extension.
    const ops = await (await fetch(`${BASE}/api/ops`)).json()
    const extDir = path.join(dataDir, 'extension')
    check(
      'runs in packaged mode (extension served from the data dir)',
      path.resolve(ops.extensionPath) === path.resolve(extDir),
      ops.extensionPath,
    )
    check(
      'copied the extension there',
      fs.existsSync(path.join(extDir, 'manifest.json')) &&
        fs.existsSync(path.join(extDir, 'background.js')),
    )

    const blocked = await fetch(`${BASE}/api/sync`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    check('rejects cross-origin writes', blocked.status === 403, `HTTP ${blocked.status}`)
  }
} finally {
  server.kill()
  await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)))
  if (failures) console.log(`\n--- server output ---\n${output}`)
  try {
    fs.rmSync(scratch, { recursive: true, force: true })
  } catch {
    // Windows can hold the database briefly after exit; a stray temp dir is harmless.
  }
}

console.log(`\n${failures === 0 ? 'SMOKE TEST PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
