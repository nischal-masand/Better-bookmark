import { useState } from 'react'
import { Check, ChevronRight, Copy, Loader2, Plug, TriangleAlert } from 'lucide-react'
import type { OpsStatus } from '../lib/api'

interface Props {
  ops: OpsStatus
  chromeRunning: boolean
  applying: boolean
  error: string | null
  extensionPath: string
  onApplyOffline: () => void
}

/**
 * Deletes and moves are queued when the extension is not installed, and a queue
 * nobody can see is indistinguishable from the feature being broken — which is
 * exactly how this first went wrong. So it says so, loudly, and offers both
 * ways out rather than only naming the problem.
 */
export function PendingChanges({
  ops,
  chromeRunning,
  applying,
  error,
  extensionPath,
  onApplyOffline,
}: Props) {
  const [showSteps, setShowSteps] = useState(false)
  const [copied, setCopied] = useState(false)

  if (ops.pending === 0) return null

  const copyPath = async () => {
    await navigator.clipboard.writeText(extensionPath)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.08]">
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <TriangleAlert className="size-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-amber-200">
            {ops.pending} change{ops.pending === 1 ? '' : 's'} {ops.pending === 1 ? 'has' : 'have'}{' '}
            not reached Chrome yet
          </p>
          <p className="text-[11.5px] text-[var(--color-ink-muted)]">
            {ops.extension.connected
              ? 'The extension is connected and should be applying them now.'
              : 'They are hidden here but still in Chrome. Apply them one of these two ways.'}
          </p>
        </div>

        {!ops.extension.connected && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onApplyOffline}
              disabled={applying || chromeRunning}
              title={
                chromeRunning
                  ? 'Close Chrome first — it keeps bookmarks in memory and would overwrite the change'
                  : "Writes the changes straight into Chrome's bookmarks file"
              }
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-200 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {applying && <Loader2 className="size-3.5 animate-spin" />}
              Apply now
            </button>
            <button
              type="button"
              onClick={() => setShowSteps((value) => !value)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
            >
              <Plug className="size-3.5" />
              Install the extension
              <ChevronRight
                className={`size-3 transition-transform ${showSteps ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
        )}
      </div>

      {chromeRunning && !ops.extension.connected && (
        <p className="border-t border-amber-500/20 px-3.5 py-2 text-[11px] text-[var(--color-ink-muted)]">
          <strong className="text-amber-200/90">Apply now</strong> needs Chrome fully closed — it
          rewrites the bookmarks file, and a running Chrome would overwrite that from memory. The
          extension has no such restriction.
        </p>
      )}

      {error && (
        <p className="border-t border-amber-500/20 bg-red-500/10 px-3.5 py-2 text-[11.5px] text-red-300">
          {error}
        </p>
      )}

      {showSteps && (
        <div className="border-t border-amber-500/20 px-3.5 py-3 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
          <p className="mb-2">
            One-time setup. After this, deletes and moves reach Chrome straight away, even while it
            is running.
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Open{' '}
              <span className="rounded bg-[var(--color-surface-2)] px-1 font-mono text-[11px]">
                chrome://extensions
              </span>
            </li>
            <li>
              Turn on <strong>Developer mode</strong> — top-right corner
            </li>
            <li>
              Click <strong>Load unpacked</strong> and select this folder:
              <span className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-surface-2)] px-1.5 py-1 font-mono text-[10.5px] text-[var(--color-ink)]">
                  {extensionPath}
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
            </li>
          </ol>
          <p className="mt-2 text-[var(--color-ink-faint)]">
            The queue applies itself within a few seconds of the extension appearing — nothing is
            lost in the meantime.
          </p>
        </div>
      )}
    </div>
  )
}
