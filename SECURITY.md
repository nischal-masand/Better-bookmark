# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub's security advisory form](https://github.com/nischal-masand/Better-bookmark/security/advisories/new)
rather than opening a public issue. I will acknowledge the report and, where a fix is needed,
credit you in the release notes unless you would rather stay anonymous.

## What the threat model is

The app runs a local HTTP server that can **delete and move your Chrome bookmarks**, so it is
worth being explicit about what protects it.

- **Loopback only.** The server binds to `127.0.0.1` (`server/src/config.ts`). Nothing else on
  your network can reach it.
- **Origin gate.** Because the API has destructive endpoints, it rejects cross-origin requests
  that are not from the companion extension or the app's own page (`server/src/index.ts`).
  Browsers do not let a web page forge an `Origin` header, which closes the CSRF hole a
  loopback server with destructive endpoints would otherwise leave open.
- **Chrome's file is read-only** during normal operation. The one exception is the explicit
  "Apply now" route, which backs the file up first, refuses a delete whose URL no longer
  matches, re-signs with Chrome's checksum, re-parses before replacing, and writes via
  temp-file-and-rename.
- **The extension holds one permission**, `bookmarks`, and talks only to `127.0.0.1:8765`. It
  never reads page content or browsing history.
- **No outbound traffic except to bookmarked sites.** No telemetry, no accounts, no favicon
  proxy, no CDN. `BB_PAUSE_ENRICH=1`, the Settings pause switch, and the per-domain never-fetch
  list each stop even that.

Things that are **not** in scope: another local process on your machine reading `data/` or
calling the API. The server trusts localhost by design; if an attacker is already running code
as you, they have your bookmarks anyway.

## Supported versions

The latest release on `main` is the supported one.
