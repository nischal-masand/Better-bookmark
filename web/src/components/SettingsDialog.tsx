import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Eye,
  FolderX,
  Plug,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { ExcludedFolder, OpsStatus, Settings, Status } from '../lib/api'

interface Props {
  status: Status | undefined
  settings: Settings | undefined
  exclusions: ExcludedFolder[]
  onClose: () => void
  onSave: (patch: Partial<{ paused: boolean; skipDomains: string; profile: string }>) => void
  onIncludeFolder: (guid: string) => void
  ops: OpsStatus | undefined
  onRetryOps: () => void
  onClearOps: () => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Focus search'],
  ['j / k', 'Move between bookmarks'],
  ['Enter', 'Open in a new tab'],
  ['o', 'Show details'],
  ['f', 'Toggle favourite'],
  ['Esc', 'Close panel or clear search'],
]

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2">
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[10.5px] text-[var(--color-ink-faint)]">{label}</div>
    </div>
  )
}

export function SettingsDialog({
  status,
  settings,
  exclusions,
  onClose,
  onSave,
  onIncludeFolder,
  ops,
  onRetryOps,
  onClearOps,
}: Props) {
  const connected = ops?.extension.connected ?? false
  const [skipDomains, setSkipDomains] = useState(settings?.skipDomains ?? '')
  const [copied, setCopied] = useState(false)

  const copyPath = async () => {
    if (!ops?.extensionPath) return
    await navigator.clipboard.writeText(ops.extensionPath)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => setSkipDomains(settings?.skipDomains ?? ''), [settings?.skipDomains])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="animate-fade-up max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <h2 className="text-[13.5px] font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="grid size-7 place-items-center rounded-lg text-[var(--color-ink-faint)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Bookmarks" value={status?.bookmarks ?? 0} />
            <Stat label="Folders" value={status?.folders ?? 0} />
            <Stat label="Sites" value={status?.domains ?? 0} />
            <Stat label="Previews" value={status?.thumbnails ?? 0} />
          </div>

          <div>
            <label className="text-[12px] font-medium" htmlFor="profile">
              Chrome profile
            </label>
            <p className="mb-1.5 text-[11px] text-[var(--color-ink-faint)]">
              Bookmarks are read from this profile's file and never written back.
            </p>
            <select
              id="profile"
              value={settings?.profile ?? ''}
              onChange={(event) => onSave({ profile: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[12.5px] focus:border-[var(--color-accent)] focus:outline-none"
            >
              {(status?.profiles ?? []).map((profile) => (
                <option key={profile.dir} value={profile.dir}>
                  {profile.label} ({profile.dir})
                </option>
              ))}
            </select>
            {status?.profile && (
              <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                {status.profile.path}
              </p>
            )}
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={settings?.paused ?? false}
              onChange={(event) => onSave({ paused: event.target.checked })}
              className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
            />
            <span>
              <span className="text-[12px] font-medium">Pause fetching previews</span>
              <span className="block text-[11px] text-[var(--color-ink-faint)]">
                Stops all outbound requests. Bookmarks still sync from Chrome.
              </span>
            </span>
          </label>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
              <Plug className="size-3.5 text-[var(--color-ink-faint)]" />
              Chrome write-back
              <span
                className={`ml-auto flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-normal ${
                  connected
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-[var(--color-line)] text-[var(--color-ink-faint)]'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-[var(--color-ink-faint)]'}`}
                />
                {connected
                  ? `Extension connected${ops?.extension.version ? ` (v${ops.extension.version})` : ''}`
                  : 'Extension not connected'}
              </span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              Deleting and moving bookmarks here changes them in Chrome too, applied by a small
              companion extension. Chrome keeps its bookmarks in memory, so editing its file
              directly would just be overwritten — the extension uses the official API instead.
            </p>

            {!connected && (
              <div className="mb-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                To install it: open <span className="font-mono">chrome://extensions</span>, turn on{' '}
                <strong>Developer mode</strong>, choose <strong>Load unpacked</strong> and pick this
                folder, then pin it from Chrome's puzzle-piece menu:
                {/* The real path, not "the extension folder": an npx install has no project
                    folder, and the copy it loads from lives in the per-user data directory. */}
                {ops?.extensionPath && (
                  <span className="mt-1.5 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-surface-2)] px-1.5 py-1 font-mono text-[10.5px] text-[var(--color-ink)]">
                      {ops.extensionPath}
                    </code>
                    <button
                      type="button"
                      onClick={copyPath}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-line)] px-1.5 py-1 text-[10.5px] transition hover:text-[var(--color-ink)]"
                    >
                      {copied ? (
                        <Check className="size-3 text-emerald-400" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </span>
                )}
                <span className="mt-1.5 block">
                  Until then, deletes and moves are queued and applied the moment it connects.
                </span>
              </div>
            )}

            {(ops?.pending ?? 0) > 0 && (
              <p className="mb-2 text-[11.5px] text-amber-400">
                {ops!.pending} change{ops!.pending === 1 ? '' : 's'} waiting for Chrome.
              </p>
            )}

            {(ops?.failed ?? 0) > 0 && (
              <div className="mb-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5">
                <div className="flex items-start gap-2 text-[11.5px] text-red-300/90">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span>
                    {ops!.failed} change{ops!.failed === 1 ? '' : 's'} could not be applied in
                    Chrome. Those bookmarks have been put back.
                  </span>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {ops!.failures.slice(0, 4).map((failure) => (
                    <li key={failure.id} className="truncate font-mono text-[10px] text-red-300/70">
                      {failure.op}: {failure.error}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onRetryOps}
                    className="flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-0.5 text-[10.5px] text-red-200 transition hover:bg-red-500/15"
                  >
                    <RotateCcw className="size-3" /> Retry
                  </button>
                  <button
                    type="button"
                    onClick={onClearOps}
                    className="flex items-center gap-1 rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
                  >
                    <Trash2 className="size-3" /> Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
              <FolderX className="size-3.5 text-[var(--color-ink-faint)]" />
              Excluded folders
            </div>
            <p className="mb-2 text-[11px] text-[var(--color-ink-faint)]">
              These never appear anywhere in the library, and their sites are never fetched. Exclude
              a folder from the hover button next to it in the sidebar.
            </p>
            {exclusions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-line)] px-3 py-2.5 text-[11.5px] text-[var(--color-ink-faint)]">
                Nothing is excluded.
              </p>
            ) : (
              <ul className="space-y-1">
                {exclusions.map((folder) => (
                  <li
                    key={folder.guid}
                    className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11.5px]" title={folder.path}>
                      {folder.path}
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--color-ink-faint)]">
                      {folder.count}
                    </span>
                    <button
                      type="button"
                      onClick={() => onIncludeFolder(folder.guid)}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-line)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
                    >
                      <Eye className="size-3" />
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="text-[12px] font-medium" htmlFor="skip">
              Never fetch these sites
            </label>
            <p className="mb-1.5 text-[11px] text-[var(--color-ink-faint)]">
              One domain per line. Subdomains are covered too.
            </p>
            <textarea
              id="skip"
              rows={3}
              value={skipDomains}
              onChange={(event) => setSkipDomains(event.target.value)}
              onBlur={() => onSave({ skipDomains })}
              placeholder="bank.example.com"
              className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 font-mono text-[11.5px] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
            <ShieldCheck className="mt-px size-4 shrink-0 text-emerald-400" />
            <p className="text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Everything stays on this machine. The server listens on 127.0.0.1 only, and the sole
              outbound requests are to the bookmarked sites themselves to read their title, preview
              image and icon — no third-party favicon or metadata service is ever contacted.
            </p>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
              Keyboard
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="text-[var(--color-ink-muted)]">{label}</span>
                  <kbd className="rounded border border-[var(--color-line)] px-1.5 py-px font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
