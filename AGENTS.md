# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, Copilot, Gemini and others) working in this repository. `CLAUDE.md` imports this file, so this is the single source of truth — edit here, not there.

For accounts, the release process, the decisions behind the setup, and troubleshooting, see [`docs/MAINTAINING.md`](docs/MAINTAINING.md).

## Working with the maintainer

- The maintainer prefers **plain-language explanations**. Lead with what happened and what they need to do; explain any unavoidable technical term in a sentence, with an everyday analogy if it helps. Avoid unexplained jargon (PR, CI, OIDC, tarball, bundle) in anything addressed to them.
- Ask before anything public or hard to undo: pushing to `main`, merging, tagging a release, or changing npm/GitHub settings. An npm publish is effectively permanent (unpublishing is restricted after 72 hours).
- Never commit anything from `data/` — it is the maintainer's real bookmark library. See "Data and testing safety" below.
- Account logins, passwords, 2FA and security settings are the maintainer's to perform. Walk them through it; do not attempt it.

## What this is

A local-first bookmark manager. A Fastify server mirrors Chrome's `Bookmarks` file into SQLite, enriches each entry by fetching the page itself (thumbnail, favicon, readable text), and serves a React SPA on `127.0.0.1:8765`. A companion MV3 Chrome extension is the only component that writes back to Chrome.

Three deployables, one repo: `server/` (Node, TypeScript, ESM), `web/` (React 19 + Vite + Tailwind 4), `extension/` (plain JS, no build step).

## Commands

```bash
npm run dev          # API on :8765 (BB_API_ONLY=1) + Vite on :5173 with HMR — use :5173 while working on the UI
npm run build        # Vite -> web/dist, then esbuild -> dist/server/index.js
npm start            # tsx server/src/index.ts (source); serves web/dist if it exists
npm run start:bundle # the published path: bin/better-bookmark.mjs -> dist/server
npm run smoke        # boots the bundle via the CLI against the fixture; needs a build first
npm run typecheck    # both tsconfigs — server and web
npm test             # all four suites, sequentially
npm run format       # Prettier write; format:check for the CI gate
```

Run one suite directly — there is no test framework, each file is a standalone script:

```bash
npx tsx server/test/sync.test.ts
```

`BB_TEST_REAL_PROFILE=1 npm test` runs the suites against a copy of this machine's real Chrome profile instead of the checked-in fixture. Worth doing before a release.

## Architecture

### Sync is one-way by default; writes are a separate, explicit path

The server **reads Chrome's `Bookmarks` file and never writes to it** during normal operation. `sync/service.ts` watches the _containing directory_ rather than the file, because Chrome saves by writing a temp file and renaming over the original — a watcher on the file itself misses that on Windows. A 3s stat poll runs alongside and is what actually bounds staleness; the watcher is the fast path, not the guarantee.

`sync/reconcile.ts` folds a parsed tree into the DB inside one transaction. The rules that matter:

- **Chrome GUIDs are identity.** Renames and moves follow.
- **Disappearing ≠ deleting.** A bookmark absent from Chrome gets `present = 0` and `removed_at`, keeping its tags and notes.
- **Re-adding a URL reclaims the archived row**, even though Chrome assigns a fresh GUID — matched by `url_hash`, and only for `source = 'chrome'` rows so a locally-added bookmark with the same URL is never hijacked.
- **A byte-identical file is skipped** via a SHA-1 fingerprint, unless `force`.
- **`deleted_guids` are tombstones** with a 5-minute TTL. Chrome flushes its file a moment _after_ the extension removes a node, so a sync landing in that gap would otherwise re-import what was just deleted.

### Two write-back paths, one invariant

Deletes and moves are queued into `bookmark_ops` (`lib/ops.ts`) and applied by whichever route is available:

1. **The extension** (`extension/background.js`) polls `/api/ext/ops`, applies each through `chrome.bookmarks`, and reports to `/api/ext/results`. It treats `chrome_id` as a _hint_ and verifies the URL against the live node before anything destructive — node ids are renumbered by a profile rebuild — falling back to a URL search.
2. **"Apply now"** (`chrome/writer.ts`) edits the `Bookmarks` file directly, and only with Chrome fully closed. It backs up first, re-signs with Chrome's own MD5 (`chrome/checksum.ts`), refuses a delete whose URL no longer matches, re-parses before replacing, and writes temp-file-and-rename.

**The invariant across both: a delete hides the row first and only destroys it once Chrome confirms.** Deleting up front would mean a failed op silently resurrects the bookmark on the next sync, stripped of its tags and notes. After `MAX_OP_ATTEMPTS`, a failed delete un-hides so it cannot vanish from the library while still sitting in Chrome.

An extension is required rather than merely convenient: Chrome holds bookmarks in memory and rewrites the file on its own schedule, so anything written underneath it is silently overwritten.

### Enrichment

`enrich/worker.ts` drains `enrich_queue` at `FETCH_CONCURRENCY` (4) with exponential backoff. A claimed batch is "parked" (`next_attempt_at` pushed forward) before processing so a concurrent wake cannot double-hand a bookmark; `resetStalled()` frees anything left mid-flight at boot.

The claim query filters hidden bookmarks and excluded folders. **That is a privacy rule, not a display one** — excluding a folder means those sites are never contacted again. `queueStats().pending` is recomputed through the same filter, or the UI would spin forever on rows the worker will never claim.

### Everything else

- **Events**: `events.ts` is a tiny typed `EventEmitter`; `/api/events` is SSE, consumed by `web/src/hooks/useEvents.ts`. This is how the grid fills in live.
- **Search**: FTS5 over titles, descriptions, URLs, notes and extracted page text. `lib/search.ts` parses `tag:`, `site:`, `folder:`, `is:` filters mixed with free text.
- **API**: all routes live in `routes/api.ts`. `/api/ext/*` is the extension protocol; every call there marks the extension as seen (90s liveness window).

## Conventions and gotchas

**Config is read at module load.** `config.ts` resolves paths and env vars at import time. The test suites therefore set `BB_DATA_DIR` / `BB_BOOKMARKS_PATH` / `BB_PAUSE_ENRICH` **before** `await import('../src/db/index.ts')` — static imports would run config too early. Any new test must follow that shape; `server/test/harness.ts` handles it.

**Local imports carry explicit `.ts` extensions** (`allowImportingTsExtensions`). This is why `tsc` cannot emit and the v1.1 bundle uses esbuild.

**Prettier only, no ESLint.** No semicolons, single quotes, 100 columns. TypeScript is strict enough (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`) that ESLint was judged redundant. `.gitattributes` normalises to LF; `.ps1` stays CRLF.

**Comment the _why_.** The codebase carries a lot of hard-won detail about how Chrome actually behaves — the atomic rename, the memory-held bookmarks, the flush gap, the renumbered node ids. Preserve and extend that; do not strip it to "what" comments.

**better-sqlite3 is synchronous.** No `await` on queries. Close the DB before `fs.rmSync` on a scratch directory or Windows keeps the file locked and cleanup throws over an already-passing run.

**Tests are hand-rolled.** Each file counts failures and ends with `process.exit(failures === 0 ? 0 : 1)`. Keep that contract — CI depends on the exit code.

## Scope boundaries

These are deliberate and load-bearing; changes that weaken them need an explicit decision:

- Binds to `127.0.0.1` only. No network exposure, no accounts, no telemetry.
- The only outbound requests are to the bookmarked sites themselves. No favicon proxy or metadata service — either would be handed the entire bookmark list one URL at a time.
- The API has destructive endpoints, so `server/src/index.ts` rejects cross-origin requests that are not the extension or the app's own page. A web page cannot forge `Origin`, which closes the CSRF hole a loopback server would otherwise leave open. Do not loosen this without replacing it.
- Chrome's file is read-only except via the explicit, guarded "Apply now" path.

## Data and testing safety

`data/` (gitignored) holds the **real user database** plus cached thumbnails and icons. Do not delete, move, or overwrite `data/bookmarks.db`. Point at a scratch directory with `BB_DATA_DIR` when running the app for experiments or screenshots.

Tests always operate on a _copy_ — they never touch a live Chrome profile. The default source is `server/test/fixtures/Bookmarks`, a small checked-in file in Chrome's format, which is what lets CI run with no Chrome installed. Its `checksum` was generated by this project's own `computeChecksum`, so the "matches Chrome's own stored checksum" assertion in `writer.test.ts` would be circular against it and is guarded on `BB_TEST_REAL_PROFILE`. If you change the fixture, recompute that checksum or the app treats the file as corrupt.

## Environment variables

| Variable               | Default                                               | Purpose                                         |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `BB_PORT`              | `8765`                                                | Port to listen on                               |
| `BB_DATA_DIR`          | `./data` in a checkout; per-user folder when packaged | Database and cached images                      |
| `BB_BOOKMARKS_PATH`    | auto-detected                                         | Override Chrome profile discovery               |
| `BB_PAUSE_ENRICH`      | —                                                     | `1` disables all outbound fetching              |
| `BB_API_ONLY`          | —                                                     | `1` serves only the API, leaving the UI to Vite |
| `BB_TEST_REAL_PROFILE` | —                                                     | `1` runs tests against the real Chrome profile  |

`profiles.ts` resolves Chrome's user-data directory per platform (win32 / darwin / linux) — do not re-derive those paths elsewhere.

## Packaging

Published to npm as `better-bookmark`; `npx better-bookmark` is the primary install. One package serves every OS.

- `scripts/build-server.mjs` bundles the server with esbuild. `better-sqlite3` and `sharp` are **external** — they carry native binaries npm must pick per OS/CPU at install time. They are the only runtime `dependencies`; everything else is `devDependencies` because it is either bundled into `dist/server` or compiled into `web/dist`. A new pure-JS runtime import therefore goes in `devDependencies`, not `dependencies`. A new native one goes in both `EXTERNAL` and `dependencies`.
- The build stamps `process.env.BB_PACKAGED = '1'` via esbuild `define`. `config.ts` keys two things off it, **both because `npx` runs out of npm's cache, which npm prunes on its own schedule**:
  - `DATA_DIR` defaults to the OS per-user folder (`%APPDATA%\better-bookmark`, `~/Library/Application Support/better-bookmark`, `$XDG_DATA_HOME` or `~/.local/share/better-bookmark`) instead of `ROOT/data`. A checkout keeps `./data`.
  - `EXTENSION_DIR` is a copy in `DATA_DIR/extension`, refreshed at every boot by `syncPackagedExtension()`. Chrome reads a load-unpacked extension from disk on every launch, so the path shown to users must outlive the cache.
- `ROOT` is found by walking up to the `package.json` named `better-bookmark`, not by counting directories — the hop count differs between `server/src/config.ts` and `dist/server/index.js`.
- `SCHEMA_PATH` points at `dist/server/schema.sql` when packaged; the build copies it there.
- `npm run smoke` is the only check that exercises the bundle rather than the source. It asserts packaged mode is actually on by checking the extension path lands in the data dir. CI runs it on all three OSes; `prepublishOnly` runs it before any publish.

Releases: bump `package.json` version, push a `vX.Y.Z` tag; `.github/workflows/release.yml` publishes via npm trusted publishing (OIDC, no token secret). Provenance is automatic. The step-by-step, the npm-side configuration and the troubleshooting history are in [`docs/MAINTAINING.md`](docs/MAINTAINING.md).
