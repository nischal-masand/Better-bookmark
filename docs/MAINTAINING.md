# Maintaining Better Bookmark

A record of how this project is published, what accounts and settings are involved, why it was set up this way, and what to do when something goes wrong. Written for the maintainer and for any AI assistant helping them. Code-level guidance lives in [`AGENTS.md`](../AGENTS.md).

## At a glance

| What                     | Where                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Source code (public)     | [github.com/nischal-masand/Better-bookmark](https://github.com/nischal-masand/Better-bookmark) |
| Installable package      | [npmjs.com/package/better-bookmark](https://www.npmjs.com/package/better-bookmark)             |
| GitHub account           | `nischal-masand`                                                                               |
| npm account              | `nischalmasand` (no hyphen)                                                                    |
| License                  | MIT                                                                                            |
| Latest published version | 1.1.0, published by hand on 2026-09-21 from commit `a0819a3` on `main`                         |
| Automatic checks         | `.github/workflows/ci.yml`: every push to `main` and every pull request                        |
| Automatic publishing     | `.github/workflows/release.yml`: runs when a `vX.Y.Z` tag is pushed                            |

## Glossary

- **GitHub**: where the code lives. Public, so anyone can read it, report problems, or suggest changes.
- **npm**: the store that hosts the ready-to-run package. Publishing puts a new version on the shelf.
- **npx**: the command that fetches a package from npm and runs it in one step. It's how users install this app.
- **Pull request (PR)**: a proposed set of changes on GitHub, shown side by side for review before it's accepted.
- **Merge**: accepting a pull request into `main`, the official version of the code.
- **CI**: the automatic checks GitHub runs on every change (tests on Windows, macOS and Linux). Green means everything passed.
- **Tag / release**: a label on a specific version of the code, such as `v1.2.0`. Pushing a tag is what triggers publishing.
- **2FA**: two-factor authentication. A second check after your password, here your PIN, fingerprint or face, or a phone passkey.
- **Trusted publishing**: npm is told to accept new versions that come from this repository's release workflow. No password or access token is stored anywhere for it.

## How people install it

**Most people:** `npx better-bookmark`, then open `http://127.0.0.1:8765`. Needs Node 20.11+ and Chrome. The same package works on Windows, macOS and Linux. To make sure they get the newest version, users can run `npx better-bookmark@latest`.

**People working on the code:** clone the repository, `npm install`, `npm run build`, `npm start`. See `CONTRIBUTING.md`.

Where the user's library is stored:

| Installed via | Location                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npx`         | Windows `%APPDATA%\better-bookmark` · macOS `~/Library/Application Support/better-bookmark` · Linux `~/.local/share/better-bookmark` |
| Source clone  | `data/` inside the project folder                                                                                                    |

## Releasing a new version

Nothing needs to be run by hand on npm any more. The whole process:

1. Make and merge the changes into `main`, with CI green.
2. Change `"version"` in `package.json`, for example `1.1.0` → `1.2.0`, and commit it to `main`.
   - Small fix: bump the last number (`1.1.1`). New feature: the middle one (`1.2.0`). Anything that breaks existing users: the first one (`2.0.0`).
   - If `extension/` changed, also bump `"version"` in `extension/manifest.json`. It's shown in the app's Settings, which is how you tell which extension copy a user has.
3. Tag and push:
   ```bash
   git tag v1.2.0
   ```
   ```bash
   git push origin v1.2.0
   ```
4. The **Release** workflow then, on its own:
   - refuses to continue if the tag and `package.json` disagree
   - runs typecheck, all tests, the build and the bundle smoke test (through `prepublishOnly`)
   - publishes to npm through trusted publishing, with a provenance badge
   - creates a GitHub Release with generated notes

**Checking it worked:** GitHub → **Actions** → the **Release** run is green; the npm package page shows the new version; `npm view better-bookmark version` prints it.

Version 1.1.0 was published by hand, so it has no git tag and no GitHub Release entry. The first automated release will be the first tag.

## Accounts and security settings

### GitHub

- Repository `nischal-masand/Better-bookmark`, public, default branch `main`.
- Commits made from the maintainer's laptop use GitHub's private "noreply" email (`255936256+nischal-masand@users.noreply.github.com`), set **for this repository only**. The personal email address is not in the public history.
- No repository secrets are needed. Publishing uses trusted publishing, not a token.

### npm

- Account `nischalmasand`, with **2FA turned on** using a security key (Windows Hello PIN, fingerprint or face).
- **Recovery codes** were shown once when 2FA was enabled. They are the only way back into the account if the laptop is lost. Keep them somewhere safe, outside this repository.
- Package settings (npmjs.com → `better-bookmark` → **Settings**):
  - **Trusted Publisher → GitHub Actions**
    | Field                | Value                                                        |
    | -------------------- | ------------------------------------------------------------ |
    | Label                | `GitHub release workflow`                                    |
    | Organization or user | `nischal-masand`                                             |
    | Repository           | `Better-bookmark`                                            |
    | Workflow filename    | `release.yml`                                                |
    | Environment name     | _(empty)_                                                    |
    | Allowed actions      | `npm publish` ticked (`npm stage publish` is always allowed) |
  - **Publishing access**: _Require two-factor authentication and disallow bypass 2FA tokens_ (the recommended, strictest option).
- **No npm access tokens exist** for this package, and none are needed.

If the repository or workflow file is ever renamed, the trusted publisher must be deleted and recreated with the new values. npm does not allow editing those fields.

## Decisions and why

| Decision                                                          | Why                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MIT license**                                                   | The most permissive and familiar choice, with the least friction for contributors.                                                                                                                                                                                                                                        |
| **Source install first (v1.0), `npx` second (v1.1)**              | The repository could go public immediately. The riskier packaging change (moving where user data lives) was done separately and carefully, before anyone had data to migrate.                                                                                                                                             |
| **One npm package for every OS**                                  | The package is plain JavaScript. The only platform-specific parts, `better-sqlite3` and `sharp`, download the right native binary for each user's OS and CPU at install time. No separate Windows or Mac builds are needed.                                                                                               |
| **Server bundled with esbuild**                                   | `tsc` can't compile this codebase (imports carry `.ts` extensions), and shipping `tsx` to users would be slow. The bundle also means users install only the two native modules (45 packages total) instead of the whole dev toolchain.                                                                                    |
| **Library stored in the per-user folder under `npx`**             | `npx` runs from npm's cache, which npm clears on its own schedule. A database stored beside the code would eventually disappear with every bookmark, tag and note in it.                                                                                                                                                  |
| **Extension copied into the data folder under `npx`**             | Chrome reloads an unpacked extension from disk on every launch, so the folder users point Chrome at must outlive npm's cache. It's re-copied on every start, so upgrading the app upgrades the extension.                                                                                                                 |
| **Extension installed "unpacked", not from the Chrome Web Store** | Free and immediate. A store listing needs a developer fee, a review, store images and a hosted privacy policy. Possible later.                                                                                                                                                                                            |
| **Autostart scripts are Windows-only**                            | They're PowerShell and live in the repository. Mac and Linux users start the app themselves or point their login-items mechanism at `npx better-bookmark`.                                                                                                                                                                |
| **Tests run on a checked-in sample bookmarks file**               | So they run anywhere, including GitHub's machines with no Chrome installed. `BB_TEST_REAL_PROFILE=1 npm test` runs them against a copy of a real profile before a release.                                                                                                                                                |
| **README screenshots taken from a demo library**                  | A throwaway library of ~30 public sites, run with `BB_DATA_DIR` pointed at a scratch folder, so the maintainer's real bookmarks never appear in the repository.                                                                                                                                                           |
| **Trusted publishing instead of an npm token**                    | There's no secret to leak, store or rotate. npm is also restricting tokens that bypass 2FA (account actions from August 2026, direct publishing from January 2027), and trusted publishing is its recommended replacement.                                                                                                |
| **Direct `npm publish` rather than staged publishing**            | Staged publishing would require approving every release on npmjs.com with the security key. Direct publishing is safe enough here because only the maintainer can push tags to the repository. To tighten it later: untick **Allow npm publish** on npm and change `npm publish` to `npm stage publish` in `release.yml`. |
| **Prettier, no ESLint; LF line endings**                          | TypeScript's strict settings already catch most of what ESLint would. The tree had mixed Windows and Unix line endings; `.gitattributes` now keeps it consistent.                                                                                                                                                         |

## Troubleshooting

**The security-key / passkey popup never appears (npm 2FA setup, or saving npm settings).**
A password-manager browser extension, such as LastPass, can intercept these prompts and fail without showing anything. Use a browser without the extension (Microsoft Edge is built into Windows), or turn the extension off temporarily at `chrome://extensions`.

**npm keeps asking for the password when saving a package setting, and the change never saves.**
Same cause: the step after the password is a security-key check, and the extension is blocking it. Do it in Edge.

**`npm publish` fails with `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`.**
2FA isn't enabled on the npm account yet. Turn it on first. This only matters for publishing by hand; automated releases don't use it.

**The Release workflow stops at "Check the tag matches package.json".**
The tag and `package.json` disagree, for example the tag is `v1.2.0` but `package.json` still says `1.1.0`. Fix `package.json`, commit, then delete and re-push the tag:

```bash
git tag -d v1.2.0
```

```bash
git push origin :refs/tags/v1.2.0
```

Then tag and push again.

**The Release workflow fails at "Publish to npm" with a 401, 403 or 404.**
The trusted-publisher fields on npm must match exactly: `nischal-masand`, `Better-bookmark` (capital B), `release.yml`. Also check the version number hasn't already been published; npm never allows reusing one.

**`npx ./some-file.tgz` fails on Windows with `'D:/Work/Experiments/Better' is not recognized`.**
npx splits local paths that contain spaces. Copy the `.tgz` to a folder with no spaces. Users installing from npm by name are unaffected.

**"Better Bookmark is already running at http://127.0.0.1:8765".**
Another copy is running, usually the Windows autostart one. That's harmless; the second copy exits by design.

**CI fails on only one operating system.**
Open the failing job under GitHub → **Actions**. The smoke test step prints the server's own output when it fails.

## Keeping personal data out of the repository

`data/` holds the maintainer's real bookmark database and cached images. `.gitignore` excludes it, along with `web/dist/`, `dist/`, `node_modules/` and `*.tgz`. Before any public push, this must print nothing:

```bash
git ls-files | grep -Ei '(^|/)data/|\.db|thumbs/|icons/' | grep -v '^extension/icons/'
```

`extension/icons/` is the extension's own toolbar icon, not cached site icons, so it is the one `icons/` folder allowed through.

The npm package is limited by the `files` list in `package.json` to `bin/`, `dist/`, `web/dist/` and `extension/`, plus the README, license and `package.json`. Check with `npm pack --dry-run` before publishing by hand.

## History

- **2026-09-21: v1.0 public.** Git repository created; MIT license, public `package.json` metadata, tests switched to a checked-in sample file, CI on Windows, macOS and Linux, Prettier, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, README screenshots from a demo library. Pushed to GitHub.
- **2026-09-21: v1.1, one-command install.** Server bundle, `npx better-bookmark` entry point, per-user data folder, extension copy, bundle smoke test, release workflow. Merged through pull request #1 with all checks green.
- **2026-09-21: npm.** npm account created with 2FA; version 1.1.0 published by hand; trusted publisher connected to `release.yml`; publishing access set to the strictest option.
- **2026-09-21: extension 1.1.0.** The toolbar button became the way into the library: an **Open library** button first, sync status and a **Sync now** link underneath. Renamed from "Better Bookmark Sync" to "Better Bookmark" and given a bookmark icon. Not yet in an npm release.

## Not done yet / ideas

- **Chrome Web Store listing** for the extension, which would remove the Developer-mode "Load unpacked" step for users.
- **Autostart on macOS and Linux** (a `launchd` plist and a systemd user unit).
- **Staged publishing** for extra release security (see Decisions above).
- **A double-click desktop installer** (Electron or Tauri). Considered and deferred: it's much more work, needs per-OS builds, and trusted installers require paid code signing.
- From the README's "Not included" list: scheduled re-checks of link health, Edge and Firefox import, renaming or reordering bookmarks from the app.
- **Housekeeping:** the merged `v1.1-npx` branch can be deleted on GitHub.
