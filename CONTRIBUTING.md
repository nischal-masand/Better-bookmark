# Contributing

Thanks for taking a look. Bug reports and pull requests are both welcome.

## Getting set up

You need **Node 20.11 or newer** and Chrome.

```bash
git clone https://github.com/nischal-masand/Better-bookmark.git
cd Better-bookmark
npm install
npm run dev
```

`npm run dev` runs two processes: the API on **http://127.0.0.1:8765** and Vite on
**http://localhost:5173**. Use the Vite URL while working on the UI — it proxies `/api`,
`/thumbs` and `/icons` through to the server and gives you hot reload. The server is started
with `BB_API_ONLY=1` so it does not try to serve a stale `web/dist` underneath you.

To run the way a user would, `npm run build && npm start` and open 8765.

Your own bookmarks live in `data/`, which is gitignored. Point the app somewhere else with
`BB_DATA_DIR` if you would rather not develop against your real library.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run format
```

CI runs those on Windows, macOS and Linux against Node 20 and 22, then builds and runs
`npm run smoke` — which boots the bundled server through the real CLI entry point, the same way
`npx better-bookmark` does. All six legs have to pass.

## Tests

The four suites in `server/test/` each run against a scratch **copy** of
`server/test/fixtures/Bookmarks` — a small checked-in file in Chrome's own format. Nothing
touches a real Chrome profile, and no Chrome installation is required, which is what lets them
run in CI.

Before a release it is worth also running them against real data:

```bash
BB_TEST_REAL_PROFILE=1 npm test
```

Still a copy, still read-only as far as Chrome is concerned. Real bookmark files are messier
than any fixture — odd characters in titles, deep nesting, entries Chrome wrote years ago — so
this catches things the fixture cannot. One assertion, that `computeChecksum` reproduces
Chromium's own algorithm, can only be proved against a file Chrome actually wrote and is
skipped in fixture mode.

If you change the fixture, remember its `checksum` field has to be recomputed or the app will
treat the file as corrupt. `server/src/chrome/checksum.ts` has the algorithm.

## Where things live

`README.md` has a Layout section with the full map. The short version:

- `server/src/chrome/` — profile discovery, parsing Chrome's JSON, the checksum, the offline writer
- `server/src/sync/` — the reconciler (guid matching, archive, resurrect) and the file watcher
- `server/src/enrich/` — the fetch queue, metadata extraction, images, readable text
- `server/src/routes/api.ts` — the whole JSON API, including the `/api/ext/*` extension protocol
- `web/src/` — the React UI
- `extension/` — the MV3 companion extension

## Style

Prettier, configured in `.prettierrc`: no semicolons, single quotes, 100 columns. `npm run format`
applies it. There is no ESLint — TypeScript is configured strictly enough
(`noUncheckedIndexedAccess`, `verbatimModuleSyntax`) to cover most of what it would catch.

The codebase comments the _why_, not the _what_, and there is a fair amount of hard-won
detail in those comments about how Chrome actually behaves. Please keep that up.

## How the published package is built

`npm run build` does two things: Vite compiles the UI into `web/dist`, and
`scripts/build-server.mjs` bundles the server with esbuild into `dist/server/index.js`.
`bin/better-bookmark.mjs` is the `npx` entry point that loads it.

The bundle is why the package's runtime `dependencies` are only `better-sqlite3` and `sharp`:
everything else is compiled in. Those two stay external because they ship native binaries, and
npm has to pick the right one for each user's OS and CPU at install time — which is also why one
package serves Windows, macOS and Linux. If you add a runtime dependency with a native binary,
add it to `EXTERNAL` in the build script _and_ to `dependencies`; a pure-JS one goes in
`devDependencies` and gets bundled.

The build stamps `process.env.BB_PACKAGED = '1'` into the bundle. That is what moves the
library into the per-user data folder and the extension into a copy beside it — see
`server/src/config.ts` for why both have to escape npm's cache.

To try the package exactly as a user gets it:

```bash
npm run build
npm pack
```

then `npm install` the resulting `.tgz` into an empty directory elsewhere and run
`node_modules/.bin/better-bookmark`. Set `BB_DATA_DIR` to a scratch folder unless you want it
to read and write your real library.

## Releasing

1. Bump `version` in `package.json` and commit.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`

The `Release` workflow checks the tag matches `package.json`, then `npm publish` runs
typecheck, tests, build and the smoke test through `prepublishOnly` before anything is uploaded,
and a GitHub Release is created with generated notes.

It needs an `NPM_TOKEN` repository secret (an npm _automation_ token) to exist first.

If the extension changes, bump `version` in `extension/manifest.json` too — it is reported to
the server and shown in Settings, which is how you tell which copy a user has loaded.

## A note on scope

This app is deliberately local-only. It binds to `127.0.0.1`, has no accounts, no telemetry and
no third-party services — the only outbound requests it makes are to the bookmarked sites
themselves, to fetch a title and a preview image. Changes that would weaken any of that are
unlikely to be merged.
