/**
 * Better Bookmark Sync — the only component that writes to Chrome.
 *
 * The app server keeps a queue of changes you made in the library (deletes and
 * moves). This drains that queue through the chrome.bookmarks API, which is the
 * safe way to do it: editing Chrome's Bookmarks file directly would be silently
 * overwritten, because Chrome holds its bookmarks in memory.
 *
 * It also relays Chrome's own bookmark events back, so adding a bookmark shows
 * up in the library immediately instead of on the next file poll.
 */

const SERVER = 'http://127.0.0.1:8765'
const VERSION = chrome.runtime.getManifest().version
const POLL_ALARM = 'bb-poll'

let draining = false

async function api(path, init) {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/**
 * Resolves the Chrome node for an op.
 *
 * Node ids are not stable — a profile rebuild renumbers them — so the id is
 * treated as a hint and the URL is verified before anything destructive runs.
 * If the id has gone stale we fall back to searching by URL.
 */
async function resolveNode(op) {
  if (op.chromeId) {
    try {
      const [node] = await chrome.bookmarks.get(String(op.chromeId))
      if (node && (!op.url || node.url === op.url)) return node
    } catch {
      // id no longer exists — fall through to the search
    }
  }
  if (!op.url) return null
  const matches = await chrome.bookmarks.search({ url: op.url })
  return matches.find((node) => node.url === op.url) ?? null
}

async function applyOp(op) {
  const node = await resolveNode(op)

  if (op.op === 'delete') {
    if (!node) return { id: op.id, ok: true } // already gone: the goal is met
    await chrome.bookmarks.remove(node.id)
    return { id: op.id, ok: true }
  }

  if (op.op === 'move') {
    if (!node) return { id: op.id, ok: false, error: 'Bookmark not found in Chrome' }
    const parentId = op.payload?.parentId
    if (!parentId) return { id: op.id, ok: false, error: 'No destination folder' }
    try {
      await chrome.bookmarks.get(String(parentId))
    } catch {
      return { id: op.id, ok: false, error: 'Destination folder not found in Chrome' }
    }
    await chrome.bookmarks.move(node.id, { parentId: String(parentId) })
    return { id: op.id, ok: true }
  }

  return { id: op.id, ok: false, error: `Unknown operation "${op.op}"` }
}

async function drain() {
  if (draining) return
  draining = true
  try {
    for (;;) {
      const { ops } = await api(`/api/ext/ops?v=${VERSION}`)
      if (!ops || ops.length === 0) break

      const results = []
      for (const op of ops) {
        try {
          results.push(await applyOp(op))
        } catch (err) {
          results.push({ id: op.id, ok: false, error: String(err?.message ?? err) })
        }
      }
      await api('/api/ext/results', {
        method: 'POST',
        body: JSON.stringify({ version: VERSION, results }),
      })
    }
  } catch {
    // Server not running. The alarm will try again.
  } finally {
    draining = false
  }
}

/** Tells the app that Chrome's bookmarks changed, so it re-reads them now. */
let relayTimer = null
function relayChange() {
  clearTimeout(relayTimer)
  relayTimer = setTimeout(() => {
    api('/api/ext/changed', { method: 'POST', body: JSON.stringify({ version: VERSION }) }).catch(
      () => {},
    )
  }, 400)
}

for (const event of [
  chrome.bookmarks.onCreated,
  chrome.bookmarks.onRemoved,
  chrome.bookmarks.onChanged,
  chrome.bookmarks.onMoved,
]) {
  event.addListener(relayChange)
}

// MV3 service workers are torn down when idle, so the alarm is what actually
// keeps this alive. One minute is the floor Chrome allows.
chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) drain()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'drain') {
    drain().then(() => sendResponse({ ok: true }))
    return true // keep the channel open for the async reply
  }
  return false
})

chrome.runtime.onStartup.addListener(drain)
chrome.runtime.onInstalled.addListener(drain)
chrome.action.onClicked.addListener(drain)

// Anything the library does while the worker happens to be awake is applied
// within a couple of seconds rather than waiting for the next alarm.
setInterval(drain, 2500)
drain()
