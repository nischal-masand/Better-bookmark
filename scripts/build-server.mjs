#!/usr/bin/env node
/**
 * Bundles the Fastify server into a single ESM file for the published package.
 *
 * Why a bundle rather than `tsc`: tsconfig.json sets `allowImportingTsExtensions`,
 * so imports in server/src are written as `./config.ts`. tsc refuses to emit under
 * that flag, and shipping `tsx` to end users means paying a TypeScript transform
 * on every cold start. esbuild understands those specifiers natively and produces
 * one file that plain `node` can run.
 *
 * Output contract (shared with bin/ and server/src/config.ts):
 *   dist/server/index.js    ESM, node20, process.env.BB_PACKAGED === '1'
 *   dist/server/index.js.map
 *   dist/server/schema.sql  read by db/index.ts relative to the bundle
 */
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'server', 'src', 'index.ts')
const OUT_DIR = path.join(ROOT, 'dist', 'server')
const OUT_FILE = path.join(OUT_DIR, 'index.js')
const SCHEMA_SRC = path.join(ROOT, 'server', 'src', 'db', 'schema.sql')
const SCHEMA_OUT = path.join(OUT_DIR, 'schema.sql')

/**
 * Native modules stay external: both ship prebuilt `.node` binaries that are
 * resolved from node_modules at runtime, and bundling their JS loaders would
 * only break that resolution. npm installs them for the user as normal
 * dependencies, so a bare `import` from the bundle finds them.
 *
 * Nothing else needs to be external. The remaining dependencies (fastify,
 * @fastify/static, chokidar, linkedom, @mozilla/readability, p-limit, zod) are
 * pure JS, and server/src contains no dynamic `import()` or `require()` whose
 * specifier esbuild would have to guess at.
 */
const EXTERNAL = ['better-sqlite3', 'sharp']

/**
 * CommonJS dependencies pulled into an ESM bundle can still reach for `require`,
 * `__dirname` or `__filename` (fastify's plugin version checks are one example).
 * Those identifiers do not exist in an ES module, so define them once up top.
 * The import aliases are deliberately ugly to avoid colliding with any name
 * esbuild generates for bundled code.
 */
const BANNER = [
  "import { createRequire as __bbCreateRequire } from 'node:module'",
  "import { fileURLToPath as __bbFileURLToPath } from 'node:url'",
  "import { dirname as __bbDirname } from 'node:path'",
  'const require = __bbCreateRequire(import.meta.url)',
  'const __filename = __bbFileURLToPath(import.meta.url)',
  'const __dirname = __bbDirname(__filename)',
].join('\n')

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function main() {
  await fs.access(ENTRY)
  await fs.access(SCHEMA_SRC)

  // Wipe first: a rename or deletion in server/src must not leave a stale file
  // sitting in the output that `npm publish` would then ship.
  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(OUT_DIR, { recursive: true })

  const result = await build({
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // A local server's stack traces are worth far more than the bytes saved.
    minify: false,
    sourcemap: true,
    charset: 'utf8',
    external: EXTERNAL,
    banner: { js: BANNER },
    define: {
      // Tells server/src/config.ts it is running as an installed package, so
      // user data lands in the OS data directory instead of the repo checkout.
      'process.env.BB_PACKAGED': '"1"',
    },
    logLevel: 'warning',
  })

  if (result.errors.length > 0) {
    throw new Error(`esbuild reported ${result.errors.length} error(s)`)
  }

  await fs.copyFile(SCHEMA_SRC, SCHEMA_OUT)

  const [js, map, schema] = await Promise.all([
    fs.stat(OUT_FILE),
    fs.stat(`${OUT_FILE}.map`),
    fs.stat(SCHEMA_OUT),
  ])

  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
  console.log(`\n  ${rel(OUT_FILE)}      ${formatBytes(js.size)}`)
  console.log(`  ${rel(`${OUT_FILE}.map`)}  ${formatBytes(map.size)}`)
  console.log(`  ${rel(SCHEMA_OUT)}     ${formatBytes(schema.size)}`)
  console.log(`  external: ${EXTERNAL.join(', ')}`)
  if (result.warnings.length > 0) {
    console.log(`  ${result.warnings.length} warning(s) above`)
  }
  console.log()
}

main().catch((err) => {
  console.error('\n  Server bundle failed:', err instanceof Error ? err.message : err)
  // Non-zero so prepublishOnly and CI refuse to continue with no bundle.
  process.exit(1)
})
