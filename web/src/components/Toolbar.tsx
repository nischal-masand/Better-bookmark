import { forwardRef } from 'react'
import {
  Group,
  LayoutGrid,
  List,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Ungroup,
  X,
} from 'lucide-react'
import type { SortKey, Status } from '../lib/api'
import type { Scope } from '../lib/scope'
import { scopeTitle } from '../lib/scope'

interface Props {
  scope: Scope
  total: number
  search: string
  onSearch: (value: string) => void
  sort: SortKey
  onSort: (value: SortKey) => void
  view: 'grid' | 'list'
  onView: (value: 'grid' | 'list') => void
  /** null when the current view has no folder hierarchy to group by. */
  grouped: boolean | null
  onGrouped: (value: boolean) => void
  onAdd: () => void
  theme: 'dark' | 'light'
  onTheme: () => void
  status: Status | undefined
  syncing: boolean
  onSync: () => void
}

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'domain', label: 'Site A–Z' },
  { value: 'relevance', label: 'Best match' },
]

const iconButton =
  'grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]'

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar(
  {
    scope,
    total,
    search,
    onSearch,
    sort,
    onSort,
    view,
    onView,
    grouped,
    onGrouped,
    onAdd,
    theme,
    onTheme,
    status,
    syncing,
    onSync,
  },
  searchRef,
) {
  const pending = status?.queue.pending ?? 0
  const opsPending = status?.ops.pending ?? 0

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-canvas)]/85 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-6 py-3.5">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{scopeTitle(scope)}</h1>
          <p className="truncate text-[11px] text-[var(--color-ink-faint)]">
            {total.toLocaleString()} {total === 1 ? 'bookmark' : 'bookmarks'}
            {pending > 0 && (
              <span className="text-[var(--color-accent)]"> · fetching {pending}</span>
            )}
            {opsPending > 0 && (
              <span
                className="text-amber-400"
                title="Waiting for the Chrome extension to apply them"
              >
                {' '}
                · {opsPending} change{opsPending === 1 ? '' : 's'} waiting for Chrome
              </span>
            )}
          </p>
        </div>

        <div className="relative ml-auto w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search titles, pages, notes…  try tag:design or site:figma.com"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-[7px] pl-9 pr-8 text-[12.5px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch('')}
              className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--color-line)] px-1 text-[10px] text-[var(--color-ink-faint)]">
              /
            </kbd>
          )}
        </div>

        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as SortKey)}
          aria-label="Sort order"
          className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-ink-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex items-center rounded-lg border border-[var(--color-line)] p-0.5">
          {(['grid', 'list'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-label={value === 'grid' ? 'Grid view' : 'List view'}
              aria-pressed={view === value}
              onClick={() => onView(value)}
              className={`grid size-7 place-items-center rounded-[6px] transition ${
                view === value
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
              }`}
            >
              {value === 'grid' ? (
                <LayoutGrid className="size-3.5" />
              ) : (
                <List className="size-3.5" />
              )}
            </button>
          ))}
        </div>

        <button type="button" onClick={onTheme} aria-label="Toggle theme" className={iconButton}>
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          aria-label="Sync from Chrome"
          title={status?.profile ? `Reading ${status.profile.label}` : 'Sync from Chrome'}
          className={iconButton}
        >
          <RefreshCw className={`size-3.5 ${syncing || pending > 0 ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  )
})
