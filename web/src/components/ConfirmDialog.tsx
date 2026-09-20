import { useEffect, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'

export interface ConfirmRequest {
  title: string
  body: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

/**
 * Replaces window.confirm, which is not reliable here: Chrome suppresses native
 * dialogs in installed-app windows and in some embedded contexts, so the
 * callback simply never fired and destructive actions looked broken.
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest
  onClose: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Enter') {
        request.onConfirm()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onClose])

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        className="animate-fade-up w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="flex gap-3 p-5">
          {request.destructive && (
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-red-500/12 text-red-400">
              <TriangleAlert className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold">{request.title}</h2>
            <div className="mt-1.5 space-y-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {request.body}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              request.onConfirm()
              onClose()
            }}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium text-white transition hover:brightness-110 ${
              request.destructive ? 'bg-red-600' : 'bg-[var(--color-accent)]'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
