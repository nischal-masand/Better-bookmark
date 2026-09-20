import { useEffect, useRef, useState } from 'react'
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  FolderTree,
  Link2Off,
  RefreshCw,
  RotateCcw,
  Star,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { BookmarkDetail, Tag } from '../lib/api'
import { fullDate, prettyUrl } from '../lib/format'
import { Thumb } from './Thumb'
import { TagPill } from './TagPill'

interface Props {
  bookmark: BookmarkDetail
  onClose: () => void
  onPatch: (
    patch: Partial<{
      notes: string | null
      favorite: boolean
      customTitle: string | null
      tags: string[]
    }>,
  ) => void
  onRefetch: () => void
  onTagClick: (tag: Tag) => void
  onToggleHidden: () => void
  onDelete: () => void
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-[3px] shrink-0 text-[var(--color-ink-faint)]">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
          {label}
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-muted)]">{value}</div>
      </div>
    </div>
  )
}

export function DetailDrawer({
  bookmark,
  onClose,
  onPatch,
  onRefetch,
  onTagClick,
  onToggleHidden,
  onDelete,
}: Props) {
  const [notes, setNotes] = useState(bookmark.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [copied, setCopied] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)

  // Reset local state when a different bookmark is opened.
  useEffect(() => {
    setNotes(bookmark.notes ?? '')
    setTagInput('')
  }, [bookmark.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Autosave notes a beat after typing stops, and flush on unmount.
  const queueSave = (value: string) => {
    setNotes(value)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => onPatch({ notes: value || null }), 600)
  }
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
    },
    [],
  )

  const addTag = (raw: string) => {
    const names = raw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length === 0) return
    const existing = bookmark.tags.map((tag) => tag.name)
    const merged = [...new Set([...existing, ...names])]
    if (merged.length !== existing.length) onPatch({ tags: merged })
    setTagInput('')
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(bookmark.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <aside className="animate-slide-in flex h-full w-[366px] shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          Details
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-7 place-items-center rounded-lg text-[var(--color-ink-faint)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Thumb bookmark={bookmark} size="large" className="aspect-[16/9] w-full" />

        <div className="space-y-4 p-4">
          <div>
            <h2 className="text-[15px] font-semibold leading-snug">{bookmark.title}</h2>
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block truncate text-[11.5px] text-[var(--color-accent)] hover:underline"
            >
              {prettyUrl(bookmark.url)}
            </a>
          </div>

          <div className="flex gap-2">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] py-1.5 text-[12px] font-medium text-white transition hover:brightness-110"
            >
              <ExternalLink className="size-3.5" /> Open
            </a>
            <button
              type="button"
              onClick={copyLink}
              aria-label="Copy link"
              className="grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onPatch({ favorite: !bookmark.favorite })}
              aria-label={bookmark.favorite ? 'Remove from favourites' : 'Add to favourites'}
              className={`grid size-8 place-items-center rounded-lg border transition ${
                bookmark.favorite
                  ? 'border-[var(--color-star)]/40 bg-[var(--color-star)]/12 text-[var(--color-star)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Star className="size-3.5" fill={bookmark.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              onClick={onRefetch}
              aria-label="Fetch this page again"
              title="Fetch this page again"
              className="grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>

          {bookmark.linkStatus === 'dead' ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-2.5 text-[11.5px] text-red-300/90">
              <div className="flex items-start gap-2">
                <Link2Off className="mt-px size-3.5 shrink-0" />
                <span>
                  This link is dead — {bookmark.error}. Nothing is coming back from it, so it is
                  safe to remove.
                </span>
              </div>
              <button
                type="button"
                onClick={onDelete}
                className="mt-2 w-full rounded-md border border-red-500/30 py-1 text-[11.5px] font-medium transition hover:bg-red-500/15"
              >
                {bookmark.local ? 'Delete this bookmark' : 'Remove from the library'}
              </button>
            </div>
          ) : bookmark.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-300/90">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                {bookmark.linkStatus === 'blocked'
                  ? `The site refused an automated request (${bookmark.error}), so there is no preview. The link itself is fine.`
                  : `Could not fetch this page: ${bookmark.error}. The link may still work — only the preview is missing.`}
              </span>
            </div>
          ) : null}

          {bookmark.description && (
            <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              {bookmark.description}
            </p>
          )}

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bookmark.tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  onClick={onTagClick}
                  onRemove={(removed) =>
                    onPatch({
                      tags: bookmark.tags.filter((t) => t.id !== removed.id).map((t) => t.name),
                    })
                  }
                />
              ))}
            </div>
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag(tagInput)
                }
              }}
              onBlur={() => addTag(tagInput)}
              placeholder="Add a tag and press Enter"
              className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[12px] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
              Notes
            </div>
            <textarea
              value={notes}
              onChange={(event) => queueSave(event.target.value)}
              rows={4}
              placeholder="Why you saved this…"
              className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 text-[12.5px] leading-relaxed placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <p className="mt-1 text-[10.5px] text-[var(--color-ink-faint)]">
              Notes and tags live only in this app — Chrome is never written to.
            </p>
          </div>

          <div className="flex gap-2 border-t border-[var(--color-line)] pt-3">
            <button
              type="button"
              onClick={onToggleHidden}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-line)] py-1.5 text-[11.5px] text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
            >
              {bookmark.hidden ? (
                <RotateCcw className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
              {bookmark.hidden ? 'Restore' : 'Hide'}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-line)] py-1.5 text-[11.5px] text-[var(--color-ink-muted)] transition hover:border-red-500/40 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
              {bookmark.local ? 'Delete' : 'Remove'}
            </button>
          </div>

          <div className="border-t border-[var(--color-line)] pt-2">
            {bookmark.folderPath && (
              <Field
                icon={<FolderTree className="size-3.5" />}
                label="Chrome folder"
                value={bookmark.folderPath}
              />
            )}
            <Field
              icon={<Calendar className="size-3.5" />}
              label="Saved"
              value={fullDate(bookmark.dateAdded)}
            />
            {bookmark.readingTime && (
              <Field
                icon={<Timer className="size-3.5" />}
                label="Reading time"
                value={`${bookmark.readingTime} min`}
              />
            )}
          </div>

          {bookmark.excerpt && (
            <div className="border-t border-[var(--color-line)] pt-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                Page extract
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                {bookmark.excerpt}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
