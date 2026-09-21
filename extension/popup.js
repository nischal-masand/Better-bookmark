const SERVER = 'http://127.0.0.1:8765'
const VERSION = chrome.runtime.getManifest().version

const openButton = document.getElementById('open')
const syncButton = document.getElementById('sync')
const dot = document.getElementById('dot')
const state = document.getElementById('state')
const count = document.getElementById('count')

function ago(ms) {
  if (!ms) return ''
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function show(tone, text) {
  dot.className = `dot ${tone}`
  state.textContent = text
  state.title = text
}

async function refresh() {
  try {
    const res = await fetch(`${SERVER}/api/ext/hello?v=${VERSION}`)
    const data = await res.json()

    openButton.disabled = false
    syncButton.hidden = false
    if (typeof data.bookmarks === 'number') {
      count.textContent = `${data.bookmarks.toLocaleString()} bookmarks`
    }

    if (data.failed > 0) {
      show('bad', `${data.failed} change${data.failed === 1 ? '' : 's'} couldn’t reach Chrome`)
    } else if (data.pending > 0) {
      show('wait', `${data.pending} change${data.pending === 1 ? '' : 's'} waiting to sync`)
    } else {
      const when = ago(data.lastSyncAt)
      show('ok', when ? `In sync with Chrome · ${when}` : 'In sync with Chrome')
    }
  } catch {
    // The app page would not load either, so don't offer to open it.
    openButton.disabled = true
    openButton.title = 'Better Bookmark isn’t running on this computer'
    syncButton.hidden = true
    count.textContent = 'Your bookmark library'
    show('bad', 'Better Bookmark isn’t running')
  }
}

/**
 * Brings an already-open library tab to the front instead of stacking up a new
 * one on every click. Querying by URL needs no "tabs" permission here because
 * the extension already holds host access to 127.0.0.1:8765.
 */
openButton.addEventListener('click', async () => {
  const [existing] = await chrome.tabs.query({ url: `${SERVER}/*` })
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    await chrome.windows.update(existing.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url: `${SERVER}/` })
  }
  window.close()
})

/**
 * Sync now works both ways: first push anything waiting in the library out to
 * Chrome, then make the library re-read Chrome's bookmarks from scratch.
 */
syncButton.addEventListener('click', async () => {
  syncButton.disabled = true
  show('wait', 'Syncing…')
  await chrome.runtime.sendMessage({ type: 'drain' }).catch(() => {})
  await fetch(`${SERVER}/api/sync?force=1`, { method: 'POST' }).catch(() => {})
  await refresh()
  syncButton.disabled = false
})

refresh()
