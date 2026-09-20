const SERVER = 'http://127.0.0.1:8765'
const dot = document.getElementById('dot')
const state = document.getElementById('state')

async function refresh() {
  try {
    const res = await fetch(`${SERVER}/api/ext/hello?v=${chrome.runtime.getManifest().version}`)
    const data = await res.json()
    dot.className = 'dot ok'
    state.textContent = data.pending
      ? `Connected — ${data.pending} change${data.pending === 1 ? '' : 's'} waiting`
      : 'Connected — nothing pending'
  } catch {
    dot.className = 'dot bad'
    state.textContent = 'Better Bookmark is not running'
  }
}

document.getElementById('sync').addEventListener('click', async () => {
  state.textContent = 'Applying…'
  await chrome.runtime.sendMessage({ type: 'drain' }).catch(() => {})
  setTimeout(refresh, 800)
})

refresh()
