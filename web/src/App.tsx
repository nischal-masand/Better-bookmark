import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkX, ChevronRight, Loader2, Trash2 } from 'lucide-react'
import {
  api,
  type BatchAction,
  type Bookmark,
  type FolderNode,
  type SortKey,
  type Tag,
} from './lib/api'
import { scopeSubtitle, toParams, type Scope } from './lib/scope'
import { canGroup, groupByFolder } from './lib/grouping'
import { useDebounced } from './hooks/useDebounced'
import { useEvents } from './hooks/useEvents'
import { cardSpec, clampCardWidth, DEFAULT_CARD_WIDTH, gridStyle } from './lib/cardSize'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { BookmarkCard } from './components/BookmarkCard'
import { DetailDrawer } from './components/DetailDrawer'
import { SettingsDialog } from './components/SettingsDialog'
import { AddBookmarkDialog } from './components/AddBookmarkDialog'
import { SelectionBar } from './components/SelectionBar'
import { SizeSlider } from './components/SizeSlider'
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'
import { PendingChanges } from './components/PendingChanges'

const PAGE_SIZE = 60
/** Grouping is only coherent over a whole folder, so load it in one go. */
const GROUPED_PAGE_SIZE = 1000

function usePersisted<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T | null) ?? fallback)
  const update = useCallback(
    (next: T) => {
      localStorage.setItem(key, next)
      setValue(next)
    },
    [key],
  )
  return [value, update]
}

function Skeletons({ view, cardWidth }: { view: 'grid' | 'list'; cardWidth: number }) {
  const height = view === 'list' ? 68 : cardSpec(cardWidth).skeletonHeight
  return (
    <>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          style={{ height }}
          className="animate-pulse rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        />
      ))}
    </>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>({ type: 'all' })
  const [search, setSearch] = useState('')
  const [sort, setSort] = usePersisted<SortKey>('bb.sort', 'recent')
  const [view, setView] = usePersisted<'grid' | 'list'>('bb.view', 'grid')
  const [cardWidth, setCardWidth] = useState(() =>
    clampCardWidth(Number(localStorage.getItem('bb.cardWidth') ?? DEFAULT_CARD_WIDTH)),
  )
  const [theme, setTheme] = usePersisted<'dark' | 'light'>('bb.theme', 'dark')
  const [groupPref, setGroupPref] = usePersisted<'on' | 'off'>('bb.group', 'on')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lastPicked, setLastPicked] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [offlineError, setOfflineError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const changeCardWidth = useCallback((value: number) => {
    const width = clampCardWidth(value)
    localStorage.setItem('bb.cardWidth', String(width))
    setCardWidth(width)
  }, [])

  const debouncedSearch = useDebounced(search, 220)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  const folders = useQuery({ queryKey: ['folders'], queryFn: () => api.folders() })
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 20_000 })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const exclusions = useQuery({ queryKey: ['exclusions'], queryFn: api.exclusions })
  const ops = useQuery({ queryKey: ['ops'], queryFn: api.ops, refetchInterval: 10_000 })
  const offline = useQuery({
    queryKey: ['offline'],
    queryFn: api.offlineStatus,
    // Only relevant while something is actually waiting to reach Chrome.
    enabled: (ops.data?.pending ?? 0) > 0,
    refetchInterval: 8_000,
  })

  // Searching flattens everything into one relevance-ranked list, so grouping
  // is suppressed while there is a query.
  const hiddenScope = scope.type === 'flag' && scope.flag === 'hidden'
  const grouping = canGroup(scope) && !debouncedSearch.trim() ? groupPref === 'on' : null
  const pageSize = grouping ? GROUPED_PAGE_SIZE : PAGE_SIZE

  const params = useMemo(
    () => toParams(scope, debouncedSearch, sort, pageSize),
    [scope, debouncedSearch, sort, pageSize],
  )

  const list = useInfiniteQuery({
    queryKey: ['bookmarks', params],
    queryFn: ({ pageParam }) => api.bookmarks({ ...params, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  })

  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0

  const groups = useMemo(
    () => (grouping ? groupByFolder(items, scope, folders.data ?? []) : null),
    [grouping, items, scope, folders.data],
  )

  const indexOf = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items])

  const detail = useQuery({
    queryKey: ['bookmark', detailId],
    queryFn: () => api.bookmark(detailId!),
    enabled: detailId !== null,
  })

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    void queryClient.invalidateQueries({ queryKey: ['status'] })
    void queryClient.invalidateQueries({ queryKey: ['folders'] })
    void queryClient.invalidateQueries({ queryKey: ['exclusions'] })
    void queryClient.invalidateQueries({ queryKey: ['ops'] })
    if (detailId) void queryClient.invalidateQueries({ queryKey: ['bookmark', detailId] })
  }, [queryClient, detailId])

  useEvents(refreshAll)

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Parameters<typeof api.updateBookmark>[1]) =>
      api.updateBookmark(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      void queryClient.invalidateQueries({ queryKey: ['status'] })
      if (detailId) void queryClient.invalidateQueries({ queryKey: ['bookmark', detailId] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.removeBookmark(id),
    onSuccess: () => {
      setDetailId(null)
      refreshAll()
    },
  })

  const hideDead = useMutation({ mutationFn: api.hideDead, onSuccess: refreshAll })

  const applyOffline = useMutation({
    mutationFn: api.applyOffline,
    onMutate: () => setOfflineError(null),
    onSuccess: (result) => {
      if (result.failed > 0) {
        setOfflineError(
          `${result.failed} change${result.failed === 1 ? '' : 's'} could not be applied — see Settings.`,
        )
      }
      refreshAll()
      void queryClient.invalidateQueries({ queryKey: ['offline'] })
    },
    onError: (error: Error) => setOfflineError(error.message),
  })

  const create = useMutation({
    mutationFn: api.createBookmark,
    onSuccess: (bookmark) => {
      setAddOpen(false)
      setAddError(null)
      refreshAll()
      setDetailId(bookmark.id)
    },
    onError: (error: Error) => setAddError(error.message),
  })

  const exclude = useMutation({
    mutationFn: (guid: string) => api.excludeFolder(guid),
    onSuccess: refreshAll,
  })
  const include = useMutation({
    mutationFn: (guid: string) => api.includeFolder(guid),
    onSuccess: refreshAll,
  })
  const sync = useMutation({ mutationFn: () => api.sync(), onSuccess: refreshAll })
  const saveSettings = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      refreshAll()
    },
  })

  const toggleFavorite = useCallback(
    (bookmark: Bookmark) => patch.mutate({ id: bookmark.id, favorite: !bookmark.favorite }),
    [patch],
  )
  const toggleHidden = useCallback(
    (bookmark: Bookmark) => patch.mutate({ id: bookmark.id, hidden: !bookmark.hidden }),
    [patch],
  )
  const openDetail = useCallback((bookmark: Bookmark) => setDetailId(bookmark.id), [])

  const applyScope = useCallback((next: Scope) => {
    setScope(next)
    setActiveIndex(-1)
  }, [])

  const excludeFolder = (folder: FolderNode) => {
    exclude.mutate(folder.guid)
    // Leaving the user staring at a folder that no longer exists would be odd.
    if (scope.type === 'folder' && scope.guid === folder.guid) applyScope({ type: 'all' })
  }

  const extensionConnected = status.data?.extension.connected ?? false

  const batch = useMutation({
    mutationFn: (body: {
      ids: number[]
      action: BatchAction
      folderGuid?: string | null
      tags?: string[]
    }) => api.batch(body),
    onSuccess: () => {
      setSelected(new Set())
      setLastPicked(null)
      refreshAll()
    },
  })

  const toggleSelect = useCallback(
    (bookmark: Bookmark, extend: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        const index = indexOf.get(bookmark.id) ?? -1
        // Shift-click fills in everything between the last pick and this one.
        if (extend && lastPicked !== null && index >= 0) {
          const from = indexOf.get(lastPicked) ?? index
          const [lo, hi] = from < index ? [from, index] : [index, from]
          for (let i = lo; i <= hi; i++) {
            const item = items[i]
            if (item) next.add(item.id)
          }
        } else if (next.has(bookmark.id)) {
          next.delete(bookmark.id)
        } else {
          next.add(bookmark.id)
        }
        return next
      })
      setLastPicked(bookmark.id)
    },
    [indexOf, items, lastPicked],
  )

  /** Spells out what a Chrome-side change will actually do before it happens. */
  const runBatch = (
    action: BatchAction,
    options?: { folderGuid?: string | null; tags?: string[] },
  ) => {
    const ids = [...selected]
    if (ids.length === 0) return
    const many = ids.length === 1 ? 'this bookmark' : `these ${ids.length} bookmarks`

    if (action === 'delete') {
      setConfirm({
        title: ids.length === 1 ? 'Delete this bookmark?' : `Delete ${ids.length} bookmarks?`,
        destructive: true,
        confirmLabel: 'Delete',
        body: (
          <>
            <p>This deletes {many} from Chrome as well. It cannot be undone.</p>
            {!extensionConnected && (
              <p className="text-amber-400">
                The Chrome extension is not connected, so this is queued and applied the moment it
                is. Until then they are hidden here but still in Chrome.
              </p>
            )}
          </>
        ),
        onConfirm: () => batch.mutate({ ids, action }),
      })
      return
    }

    if (action === 'move' && !extensionConnected) {
      setConfirm({
        title: ids.length === 1 ? 'Move this bookmark?' : `Move ${ids.length} bookmarks?`,
        confirmLabel: 'Move',
        body: (
          <p>
            The move happens here straight away. The Chrome extension is not connected, so Chrome
            itself is updated once it is.
          </p>
        ),
        onConfirm: () => batch.mutate({ ids, action, ...options }),
      })
      return
    }

    batch.mutate({ ids, action, ...options })
  }

  const deleteBookmark = (bookmark: Bookmark) => {
    setConfirm({
      title: bookmark.local ? 'Delete this bookmark?' : 'Delete from Chrome too?',
      destructive: true,
      confirmLabel: 'Delete',
      body: bookmark.local ? (
        <p>“{bookmark.title}” was added here, so this deletes it outright. It cannot be undone.</p>
      ) : (
        <>
          <p>This removes “{bookmark.title}” from Chrome as well. It cannot be undone.</p>
          {!extensionConnected && (
            <p className="text-amber-400">
              The Chrome extension is not connected, so this is queued until it is. Meanwhile the
              bookmark is hidden here but still in Chrome.
            </p>
          )}
        </>
      ),
      onConfirm: () => remove.mutate(bookmark.id),
    })
  }

  // Keyboard navigation. Ignored while typing so shortcuts never eat input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)

      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        if (typing) (target as HTMLElement).blur()
        else if (selected.size > 0) {
          setSelected(new Set())
          setLastPicked(null)
        } else if (search) setSearch('')
        return
      }
      // Ctrl/Cmd+A selects the loaded bookmarks rather than the page text.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault()
        setSelected(new Set(items.map((item) => item.id)))
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return

      const current = items[activeIndex]
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, items.length - 1))
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          if (current) window.open(current.url, '_blank', 'noopener,noreferrer')
          break
        case 'o':
          if (current) setDetailId(current.id)
          break
        case 'f':
          if (current) toggleFavorite(current)
          break
        case 'e':
          if (current) toggleHidden(current)
          break
        case 'x':
          if (current) toggleSelect(current, event.shiftKey)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, activeIndex, search, selected.size, toggleFavorite, toggleHidden, toggleSelect])

  useEffect(() => {
    if (activeIndex < 0) return
    document.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const showSkeletons = list.isPending
  const subtitle = scopeSubtitle(scope)
  const openAdd = () => {
    setAddError(null)
    setAddOpen(true)
  }

  const renderCards = (subset: Bookmark[]) => (
    <div
      className={view === 'grid' ? undefined : 'flex flex-col gap-1.5'}
      style={view === 'grid' ? gridStyle(cardWidth) : undefined}
    >
      {subset.map((bookmark) => {
        const index = indexOf.get(bookmark.id) ?? -1
        return (
          <div key={bookmark.id} data-index={index} className="animate-fade-up">
            <BookmarkCard
              bookmark={bookmark}
              view={view}
              cardWidth={cardWidth}
              active={index === activeIndex}
              selected={selected.has(bookmark.id)}
              selecting={selected.size > 0}
              onOpenDetail={openDetail}
              onToggleFavorite={toggleFavorite}
              onToggleHidden={toggleHidden}
              onDelete={deleteBookmark}
              onSelect={toggleSelect}
            />
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        folders={folders.data ?? []}
        tags={tags.data ?? []}
        status={status.data}
        scope={scope}
        onScope={applyScope}
        onOpenSettings={() => setSettingsOpen(true)}
        onAdd={openAdd}
        onExcludeFolder={excludeFolder}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          ref={searchRef}
          scope={scope}
          total={total}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          view={view}
          onView={setView}
          grouped={grouping}
          onGrouped={(value) => setGroupPref(value ? 'on' : 'off')}
          onAdd={openAdd}
          theme={theme}
          onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          status={status.data}
          syncing={sync.isPending}
          onSync={() => sync.mutate()}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-16 pt-5">
          {ops.data && (
            <PendingChanges
              ops={ops.data}
              chromeRunning={offline.data?.chromeRunning ?? true}
              applying={applyOffline.isPending}
              error={offlineError}
              extensionPath={ops.data.extensionPath}
              onApplyOffline={() => applyOffline.mutate()}
            />
          )}

          {subtitle && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
              <p className="flex-1 text-[11.5px] text-[var(--color-ink-muted)]">{subtitle}</p>
              {scope.type === 'flag' && scope.flag === 'dead' && total > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: `Hide all ${total} dead links?`,
                      confirmLabel: 'Hide them',
                      body: (
                        <p>
                          They are kept, not deleted — everything moves to Hidden, where you can
                          restore any of them or delete them from Chrome for good.
                        </p>
                      ),
                      onConfirm: () => hideDead.mutate(),
                    })
                  }
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink-muted)] transition hover:border-red-500/40 hover:text-red-300"
                >
                  <Trash2 className="size-3" />
                  Remove all {total}
                </button>
              )}
            </div>
          )}

          {list.isError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12.5px] text-red-300">
              {(list.error as Error).message}
            </p>
          )}

          {showSkeletons ? (
            <div
              className={view === 'grid' ? undefined : 'flex flex-col gap-1.5'}
              style={view === 'grid' ? gridStyle(cardWidth) : undefined}
            >
              <Skeletons view={view} cardWidth={cardWidth} />
            </div>
          ) : groups ? (
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key}>
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!group.guid}
                      onClick={() =>
                        group.guid &&
                        applyScope({ type: 'folder', guid: group.guid, name: group.label })
                      }
                      className="group/head flex items-center gap-1.5 text-[12px] font-semibold tracking-tight text-[var(--color-ink)] disabled:cursor-default"
                    >
                      {group.label}
                      {group.guid && (
                        <ChevronRight className="size-3 text-[var(--color-ink-faint)] transition group-hover/head:translate-x-0.5" />
                      )}
                    </button>
                    <span className="text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                      {group.items.length}
                    </span>
                    <span className="h-px flex-1 bg-[var(--color-line)]" />
                  </div>
                  {renderCards(group.items)}
                </section>
              ))}
            </div>
          ) : (
            renderCards(items)
          )}

          {!showSkeletons && items.length === 0 && (
            <div className="grid place-items-center py-24 text-center">
              <BookmarkX className="mb-3 size-8 text-[var(--color-ink-faint)]" />
              <p className="text-[13px] font-medium">Nothing here</p>
              <p className="mt-1 max-w-sm text-[12px] text-[var(--color-ink-muted)]">
                {search
                  ? 'No bookmark matches that search. Try fewer words, or a filter like tag:design or site:github.com.'
                  : 'This folder is empty. Add a bookmark in Chrome and it will show up here within a few seconds.'}
              </p>
            </div>
          )}

          {list.hasNextPage && (
            <div className="mt-6 grid place-items-center">
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-4 py-2 text-[12px] text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
              >
                {list.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>
      </main>

      {detail.data && (
        <DetailDrawer
          bookmark={detail.data}
          onClose={() => setDetailId(null)}
          onPatch={(body) => patch.mutate({ id: detail.data!.id, ...body })}
          onRefetch={() => void api.refetch(detail.data!.id)}
          onToggleHidden={() => toggleHidden(detail.data!)}
          onDelete={() => deleteBookmark(detail.data!)}
          onTagClick={(tag: Tag) => {
            applyScope({ type: 'tag', name: tag.name })
            setDetailId(null)
          }}
        />
      )}

      {addOpen && (
        <AddBookmarkDialog
          folders={folders.data ?? []}
          defaultFolderGuid={scope.type === 'folder' ? scope.guid : null}
          busy={create.isPending}
          error={addError}
          onClose={() => setAddOpen(false)}
          onSubmit={(body) => create.mutate(body)}
        />
      )}

      {view === 'grid' && <SizeSlider width={cardWidth} onWidth={changeCardWidth} />}

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          hiddenScope={hiddenScope}
          folders={folders.data ?? []}
          busy={batch.isPending}
          onAction={runBatch}
          onClear={() => {
            setSelected(new Set())
            setLastPicked(null)
          }}
          onSelectAll={() => setSelected(new Set(items.map((item) => item.id)))}
        />
      )}

      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}

      {settingsOpen && (
        <SettingsDialog
          status={status.data}
          settings={settings.data}
          exclusions={exclusions.data ?? []}
          onClose={() => setSettingsOpen(false)}
          onSave={(body) => saveSettings.mutate(body)}
          onIncludeFolder={(guid) => include.mutate(guid)}
          ops={ops.data}
          onRetryOps={() => void api.retryOps().then(refreshAll)}
          onClearOps={() => void api.clearOps().then(refreshAll)}
        />
      )}
    </div>
  )
}
