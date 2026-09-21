import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import {
  HOST,
  ICONS_DIR,
  PORT,
  SERVE_WEB,
  THUMBS_DIR,
  WEB_DIST,
  ensureDirs,
  syncPackagedExtension,
} from './config.ts'
import { apiRoutes } from './routes/api.ts'
import { startWatching, syncNow } from './sync/service.ts'
import { resetStalled, wakeWorker } from './enrich/worker.ts'

ensureDirs()
syncPackagedExtension()

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 })

const SELF_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`])
const isExtension = (origin: string) => origin.startsWith('chrome-extension://')

/**
 * The only cross-origin caller this server has is the companion extension, and
 * the API can now delete bookmarks — so anything else is turned away.
 *
 * A page on the open web cannot forge an Origin header, so this also closes the
 * CSRF hole that a loopback server with destructive endpoints would otherwise
 * leave open: any site you visited could otherwise POST to 127.0.0.1:8765.
 */
app.addHook('onRequest', (req, reply, done) => {
  const origin = req.headers.origin
  if (origin && isExtension(origin)) {
    reply.header('access-control-allow-origin', origin)
    reply.header('access-control-allow-headers', 'content-type')
    reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    reply.header('access-control-max-age', '600')
    reply.header('vary', 'origin')
  }

  if (req.method === 'OPTIONS') {
    reply.code(origin && isExtension(origin) ? 204 : 403).send()
    return
  }

  const mutating = req.method !== 'GET' && req.method !== 'HEAD'
  if (mutating && origin && !SELF_ORIGINS.has(origin) && !isExtension(origin)) {
    reply.code(403).send({ error: 'Cross-origin requests are not allowed.' })
    return
  }
  done()
})

// Cached hard: both directories are content-addressed, so a path never changes meaning.
await app.register(fastifyStatic, {
  root: THUMBS_DIR,
  prefix: '/thumbs/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '30d',
  immutable: true,
})
await app.register(fastifyStatic, {
  root: ICONS_DIR,
  prefix: '/icons/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '7d',
})

await app.register(apiRoutes)

if (SERVE_WEB) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', decorateReply: true })
  // Client-side routing: anything that is not an API or asset path gets the app shell.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = err.statusCode ?? 500
  if (status >= 500) console.error('[api]', err)
  reply.code(status).send({ error: err.message })
})

try {
  await app.listen({ host: HOST, port: PORT })
} catch (err) {
  // A second copy starting up — the shortcut clicked twice, or a manual start
  // while the scheduled task already has it — should be a quiet no-op.
  if ((err as { code?: string }).code === 'EADDRINUSE') {
    console.log(`Better Bookmark is already running at http://${HOST}:${PORT}`)
    process.exit(0)
  }
  throw err
}

console.log(
  `\n  Better Bookmark  ->  http://${HOST}:${PORT}` +
    `${SERVE_WEB ? '' : '  (API only — run `npm run build`, or use Vite on :5173)'}\n`,
)

resetStalled()
startWatching()

try {
  const result = await syncNow()
  if (result.skipped) console.log(`[sync] up to date — ${result.total} bookmarks`)
  else
    console.log(
      `[sync] ${result.total} bookmarks in ${result.folders} folders ` +
        `(+${result.added} ~${result.updated} -${result.removed})`,
    )
} catch (err) {
  console.error('[sync] initial import failed:', err instanceof Error ? err.message : err)
}

wakeWorker()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}
