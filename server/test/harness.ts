/**
 * Shared setup for the test suites.
 *
 * Every suite runs against a scratch COPY of a Bookmarks file, never against a
 * live Chrome profile. Which file gets copied depends on the mode:
 *
 *   default                    the checked-in fixture, so the suites run on any
 *                              machine — including CI runners with no Chrome
 *   BB_TEST_REAL_PROFILE=1     this machine's own Chrome profile, for the extra
 *                              confidence of running against real-world data
 *
 * The fixture's `checksum` field was produced by this project's own
 * `computeChecksum`, so it cannot be used to prove that implementation matches
 * Chromium's. The one assertion that needs a genuinely Chrome-written file is
 * guarded on REAL_PROFILE in writer.test.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { findProfiles } from '../src/chrome/profiles.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** True when the suites are running against this machine's real Chrome profile. */
export const REAL_PROFILE = process.env.BB_TEST_REAL_PROFILE === '1'

export const FIXTURE_PATH = path.join(here, 'fixtures', 'Bookmarks')

/** The Bookmarks file each suite copies from. */
export function bookmarksSource(): string {
  if (!REAL_PROFILE) return FIXTURE_PATH

  const profile = findProfiles()[0]
  if (!profile) {
    console.error(
      'BB_TEST_REAL_PROFILE=1 was set but no Chrome profile with a Bookmarks file was found.\n' +
        'Unset it to run against the checked-in fixture instead.',
    )
    process.exit(1)
  }
  return profile.bookmarksPath
}

/**
 * Makes a scratch directory, copies the Bookmarks file into it and points the
 * app at it. Must be called before importing anything that reads config.
 */
export function setupScratch(prefix: string): { scratch: string; fixture: string } {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const fixture = path.join(scratch, 'Bookmarks')
  fs.copyFileSync(bookmarksSource(), fixture)

  process.env.BB_DATA_DIR = path.join(scratch, 'data')
  process.env.BB_BOOKMARKS_PATH = fixture
  process.env.BB_PAUSE_ENRICH = '1'

  console.log(`source: ${REAL_PROFILE ? 'real Chrome profile' : 'checked-in fixture'}`)
  return { scratch, fixture }
}
