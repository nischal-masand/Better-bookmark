import { Fragment, memo } from 'react'
import {
  Check,
  EyeOff,
  Info,
  Link2Off,
  RotateCcw,
  ShieldAlert,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { Bookmark } from '../lib/api'
import { relativeDate } from '../lib/format'
import { Thumb } from './Thumb'
import { TagPill } from './TagPill'
import { cardSpec } from '../lib/cardSize'

/** The server marks search hits with control characters so nothing can inject HTML. */
export function Snippet({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /([\s\S]*?)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(<mark key={match.index}>{match[1]}</mark>)
    last = match.index + match[0].length
  }
  parts.push(text.slice(last).replace(/[]/g, ''))
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  )
}

interface Props {
  bookmark: Bookmark
  view: 'grid' | 'list'
  cardWidth: number
  active: boolean
  selected: boolean
  /** True once anything is selected: a plain click then toggles, not opens. */
  selecting: boolean
  onOpenDetail: (bookmark: Bookmark) => void
  onToggleFavorite: (bookmark: Bookmark) => void
  /** Hides a Chrome bookmark, or restores one from the Hidden view. */
  onToggleHidden: (bookmark: Bookmark) => void
  /** Opens the confirmation; deleting also removes it from Chrome. */
  onDelete: (bookmark: Bookmark) => void
  onSelect: (bookmark: Bookmark, extend: boolean) => void
}

/**
 * Only `dead` gets the loud treatment. A blocked or unreachable link is very
 * often perfectly good, so flagging those as broken would train you to ignore
 * the badge entirely.
 */
const STATUS_BADGE = {
  dead: { icon: Link2Off, label: 'Dead link', className: 'text-red-400' },
  blocked: {
    icon: ShieldAlert,
    label: 'Site blocked the preview',
    className: 'text-[var(--color-ink-faint)]',
  },
  unreachable: {
    icon: TriangleAlert,
    label: 'Could not be reached',
    className: 'text-amber-500/80',
  },
} as const

function StatusBadge({
  bookmark,
  className = 'size-3',
}: {
  bookmark: Bookmark
  className?: string
}) {
  const status = bookmark.linkStatus
  if (!status || status === 'ok') return null
  const badge = STATUS_BADGE[status]
  const Icon = badge.icon
  return <Icon className={`${className} shrink-0 ${badge.className}`} aria-label={badge.label} />
}

function Favicon({ bookmark, className = 'size-3.5' }: { bookmark: Bookmark; className?: string }) {
  if (!bookmark.favicon) {
    return (
      <span
        className={`${className} shrink-0 rounded-[3px] bg-[var(--color-line-strong)]`}
        aria-hidden
      />
    )
  }
  return (
    <img
      src={bookmark.favicon}
      alt=""
      loading="lazy"
      className={`${className} shrink-0 rounded-[3px] object-contain`}
    />
  )
}

function StarButton({
  bookmark,
  onToggle,
}: {
  bookmark: Bookmark
  onToggle: (b: Bookmark) => void
}) {
  return (
    <button
      type="button"
      aria-label={bookmark.favorite ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={bookmark.favorite}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle(bookmark)
      }}
      className={`grid size-7 place-items-center rounded-lg border backdrop-blur transition ${
        bookmark.favorite
          ? 'border-[var(--color-star)]/40 bg-[var(--color-star)]/15 text-[var(--color-star)]'
          : 'border-white/15 bg-black/30 text-white/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white'
      }`}
    >
      <Star className="size-3.5" fill={bookmark.favorite ? 'currentColor' : 'none'} />
    </button>
  )
}

export const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  view,
  cardWidth,
  active,
  selected,
  selecting,
  onOpenDetail,
  onToggleFavorite,
  onToggleHidden,
  onDelete,
  onSelect,
}: Props) {
  const spec = cardSpec(cardWidth)
  const ring = selected
    ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/45'
    : active
      ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40'
      : 'border-[var(--color-line)]'

  // While a selection is active, clicking a card extends it rather than
  // navigating away — otherwise one stray click loses the whole selection.
  const onCardClick = (event: React.MouseEvent) => {
    if (selecting || event.shiftKey) {
      event.preventDefault()
      onSelect(bookmark, event.shiftKey)
    }
  }

  const checkbox = (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? 'Deselect' : 'Select'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect(bookmark, event.shiftKey)
      }}
      className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition ${
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-white/30 bg-black/35 text-transparent opacity-0 backdrop-blur group-hover:opacity-100 focus-visible:opacity-100'
      }`}
    >
      <Check className="size-3" strokeWidth={3} />
    </button>
  )

  const hideButton = (
    <button
      type="button"
      aria-label={bookmark.hidden ? 'Restore to the library' : 'Hide from the library'}
      title={bookmark.hidden ? 'Restore to the library' : 'Hide from the library'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleHidden(bookmark)
      }}
      className="grid size-7 place-items-center rounded-lg border border-white/15 bg-black/30 text-white/70 opacity-0 backdrop-blur transition hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
    >
      {bookmark.hidden ? <RotateCcw className="size-3.5" /> : <EyeOff className="size-3.5" />}
    </button>
  )

  const deleteButton = (
    <button
      type="button"
      aria-label="Delete from Chrome too"
      title="Delete — removes it from Chrome as well"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDelete(bookmark)
      }}
      className="grid size-7 place-items-center rounded-lg border border-white/15 bg-black/30 text-white/70 opacity-0 backdrop-blur transition hover:border-red-400/40 hover:bg-red-500/25 hover:text-red-200 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Trash2 className="size-3.5" />
    </button>
  )

  const detailButton = (
    <button
      type="button"
      aria-label="Show details"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenDetail(bookmark)
      }}
      className="grid size-7 place-items-center rounded-lg border border-white/15 bg-black/30 text-white/70 opacity-0 backdrop-blur transition hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Info className="size-3.5" />
    </button>
  )

  if (view === 'list') {
    return (
      <a
        href={bookmark.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onCardClick}
        style={{ boxShadow: 'var(--shadow-card)' }}
        className={`group flex items-center gap-3 rounded-xl border bg-[var(--color-surface)] px-3 py-2.5 transition hover:bg-[var(--color-surface-2)] ${ring}`}
      >
        {checkbox}
        <Thumb bookmark={bookmark} className="size-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-medium">{bookmark.title}</h3>
            <StatusBadge bookmark={bookmark} />
            {bookmark.local && (
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                local
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--color-ink-faint)]">
            <Favicon bookmark={bookmark} className="size-3" />
            <span className="truncate">{bookmark.domain}</span>
            {bookmark.folderName && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{bookmark.folderName}</span>
              </>
            )}
          </div>
          {bookmark.snippet && (
            <p className="mt-1 line-clamp-1 text-[11px] text-[var(--color-ink-muted)]">
              <Snippet text={bookmark.snippet} />
            </p>
          )}
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {bookmark.tags.slice(0, 2).map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
        </div>
        <span className="hidden w-24 shrink-0 text-right text-[11px] text-[var(--color-ink-faint)] md:block">
          {relativeDate(bookmark.dateAdded)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {deleteButton}
          {hideButton}
          {detailButton}
          <StarButton bookmark={bookmark} onToggle={onToggleFavorite} />
        </div>
      </a>
    )
  }

  return (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={onCardClick}
      style={{ boxShadow: 'var(--shadow-card)' }}
      className={`group lift relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--color-surface)] hover:border-[var(--color-line-strong)] hover:[box-shadow:var(--shadow-card-hover)] ${ring}`}
    >
      <Thumb bookmark={bookmark} className="aspect-[16/10] w-full" />

      <div className="absolute left-2 top-2 z-10">{checkbox}</div>

      <div className="absolute right-2 top-2 flex items-center gap-1">
        {deleteButton}
        {hideButton}
        {detailButton}
        <StarButton bookmark={bookmark} onToggle={onToggleFavorite} />
      </div>

      {bookmark.local && (
        <span className="absolute bottom-2 left-2 rounded-md border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/80 backdrop-blur">
          Added here
        </span>
      )}

      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        <h3 className={`line-clamp-2 font-medium leading-snug ${spec.titleClass}`}>
          {bookmark.title}
        </h3>

        {bookmark.snippet ? (
          <p
            className={`mt-1.5 leading-relaxed text-[var(--color-ink-muted)] ${spec.descriptionClass} ${spec.clamp}`}
          >
            <Snippet text={bookmark.snippet} />
          </p>
        ) : bookmark.description ? (
          <p
            className={`mt-1.5 leading-relaxed text-[var(--color-ink-muted)] ${spec.descriptionClass} ${spec.clamp}`}
          >
            {bookmark.description}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-1.5 pt-3 text-[11px] text-[var(--color-ink-faint)]">
          <Favicon bookmark={bookmark} />
          <span className="truncate">{bookmark.domain}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{relativeDate(bookmark.dateAdded)}</span>
          <span className="ml-auto flex shrink-0 items-center">
            <StatusBadge bookmark={bookmark} />
          </span>
        </div>

        {bookmark.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {bookmark.tags.slice(0, 3).map((tag) => (
              <TagPill key={tag.id} tag={tag} />
            ))}
            {bookmark.tags.length > 3 && (
              <span className="text-[10px] text-[var(--color-ink-faint)]">
                +{bookmark.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </a>
  )
})
