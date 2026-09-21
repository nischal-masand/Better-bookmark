#!/usr/bin/env node
/**
 * The `npx better-bookmark` entry point.
 *
 * Everything here runs *before* the server bundle is loaded, and deliberately
 * stays on syntax that old Node versions can still parse — otherwise the
 * "you need a newer Node" message would itself be the thing that fails to run.
 * No top-level await, no modern operators.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIN_NODE = [20, 11]
const ENTRY = new URL('../dist/server/index.js', import.meta.url)
const PKG = new URL('../package.json', import.meta.url)

function fail(message) {
  process.stderr.write('\n' + message + '\n\n')
  process.exit(1)
}

/** True when the running Node is at least `min`, compared numerically. */
function nodeIsRecentEnough(min) {
  const parts = process.versions.node.split('.')
  const major = Number(parts[0])
  const minor = Number(parts[1])
  if (major !== min[0]) return major > min[0]
  return minor >= min[1]
}

function readVersion() {
  try {
    return JSON.parse(readFileSync(PKG, 'utf8')).version
  } catch {
    return 'unknown'
  }
}

const HELP = `
  Better Bookmark — a local, private bookmark manager that mirrors your Chrome bookmarks.

  Usage
    npx better-bookmark [options]

  Options
    -p, --port <n>    Port to listen on (default 8765). Same as BB_PORT.
    -v, --version     Print the version and exit.
    -h, --help        Show this message.

  The UI is served at http://127.0.0.1:8765 — loopback only, so nothing else on
  your network can reach it. Ctrl+C stops it.

  Environment
    BB_PORT            8765            Port to listen on.
    BB_DATA_DIR        see below       Where the database and cached images live.
    BB_BOOKMARKS_PATH  auto-detected   Point at a specific Chrome Bookmarks file.
    BB_PAUSE_ENRICH    —               1 disables all outbound fetching.
    BB_API_ONLY        —               1 serves only the API, leaving the UI to Vite.

  Where your data lives
    Windows   %APPDATA%\\better-bookmark
    macOS     ~/Library/Application Support/better-bookmark
    Linux     ~/.local/share/better-bookmark

    Run from a clone of the repository instead and it is ./data in the project.
    Either way it is one SQLite file plus cached thumbnails and icons: copy the
    folder to back it up, delete it for a clean slate.

  https://github.com/nischal-masand/Better-bookmark
`

function parseArgs(argv) {
  const opts = { help: false, version: false, port: null }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '-h' || arg === '--help') {
      opts.help = true
      continue
    }
    if (arg === '-v' || arg === '-V' || arg === '--version') {
      opts.version = true
      continue
    }

    let value = null
    if (arg === '-p' || arg === '--port') {
      value = argv[++i]
    } else if (arg.indexOf('--port=') === 0) {
      value = arg.slice('--port='.length)
    } else {
      fail(
        'Unknown option: ' + arg + '\n' + 'Run `npx better-bookmark --help` to see what it takes.',
      )
    }

    const port = Number(value)
    if (!value || !Number.isInteger(port) || port < 0 || port > 65535) {
      fail('--port wants a number between 0 and 65535, not ' + JSON.stringify(value) + '.')
    }
    opts.port = port
  }

  return opts
}

function main() {
  if (!nodeIsRecentEnough(MIN_NODE)) {
    fail(
      'Better Bookmark needs Node ' +
        MIN_NODE.join('.') +
        ' or newer. This is Node ' +
        process.versions.node +
        '.\n\n' +
        'Install a current release from https://nodejs.org (or switch with nvm, fnm\n' +
        'or volta), then run `npx better-bookmark` again.',
    )
  }

  const opts = parseArgs(process.argv.slice(2))

  if (opts.help) {
    process.stdout.write(HELP)
    return Promise.resolve()
  }
  if (opts.version) {
    process.stdout.write(readVersion() + '\n')
    return Promise.resolve()
  }

  // The server reads its configuration at import time, so this has to land in
  // the environment before the bundle is loaded — not after.
  if (opts.port !== null) process.env.BB_PORT = String(opts.port)

  if (!existsSync(ENTRY)) {
    fail(
      'Better Bookmark is not built — ' +
        fileURLToPath(ENTRY) +
        ' is missing.\n\n' +
        'If you are running from a checkout of the repository, build it first:\n\n' +
        '  npm install\n' +
        '  npm run build\n\n' +
        'If you installed this from npm, the install did not complete; try again\n' +
        'with `npm cache clean --force && npx better-bookmark`.',
    )
  }

  // The bundle ships with a sourcemap; without this Node ignores it, and a stack
  // trace pasted into a bug report points at line 40,000 of one giant file.
  if (typeof process.setSourceMapsEnabled === 'function') process.setSourceMapsEnabled(true)

  return import(ENTRY.href)
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err))
})
