export interface Tag {
  id: number
  name: string
  color: string
}

export interface TagWithCount extends Tag {
  count: number
}

export type LinkStatus = 'ok' | 'blocked' | 'dead' | 'unreachable'

export interface Bookmark {
  id: number
  url: string
  domain: string
  title: string
  description: string | null
  siteName: string | null
  favicon: string | null
  thumb: string | null
  accent: string | null
  folderGuid: string | null
  folderName: string | null
  folderPath: string | null
  dateAdded: number | null
  favorite: boolean
  hidden: boolean
  notes: string | null
  readingTime: number | null
  error: string | null
  linkStatus: LinkStatus | null
  httpStatus: number | null
  archived: boolean
  local: boolean
  fetched: boolean
  tags: Tag[]
  snippet?: string
}

export interface BookmarkDetail extends Bookmark {
  excerpt: string | null
}

export interface FolderNode {
  guid: string
  name: string
  path: string
  root: string
  depth: number
  count: number
  totalCount: number
  excluded: boolean
  children: FolderNode[]
}

export interface ExcludedFolder {
  guid: string
  name: string
  path: string
  count: number
}

export interface OpsStatus {
  pending: number
  failed: number
  failures: Array<{ id: number; op: string; url: string | null; error: string | null }>
  extension: { connected: boolean; lastSeen: number | null; version: string | null }
  extensionPath: string
}

export type BatchAction =
  'hide' | 'unhide' | 'delete' | 'move' | 'tag' | 'untag' | 'favorite' | 'unfavorite'

export interface Status {
  bookmarks: number
  favorites: number
  dead: number
  blocked: number
  unreachable: number
  hiddenCount: number
  archived: number
  local: number
  folders: number
  tags: number
  domains: number
  thumbnails: number
  errors: number
  queue: { pending: number; done: number; failed: number; skipped: number }
  ops: { pending: number; failed: number }
  extension: { connected: boolean; lastSeen: number | null; version: string | null }
  paused: boolean
  lastSyncAt: number | null
  syncError: string | null
  profile: { dir: string; label: string; path: string } | null
  profiles: Array<{ dir: string; label: string }>
}

export interface Settings {
  paused: boolean
  skipDomains: string
  profile: string | null
}

export type SortKey = 'recent' | 'oldest' | 'title' | 'domain' | 'relevance'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface ListParams {
  folder?: string
  tag?: string
  q?: string
  sort?: SortKey
  limit?: number
  offset?: number
}

export const api = {
  bookmarks(params: ListParams) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value))
    }
    return request<{ items: Bookmark[]; total: number }>(`/api/bookmarks?${search}`)
  },
  bookmark: (id: number) => request<BookmarkDetail>(`/api/bookmarks/${id}`),
  updateBookmark: (
    id: number,
    patch: Partial<{
      notes: string | null
      favorite: boolean
      hidden: boolean
      customTitle: string | null
      tags: string[]
    }>,
  ) =>
    request<BookmarkDetail>(`/api/bookmarks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  createBookmark: (body: {
    url: string
    title?: string
    folderGuid?: string | null
    tags?: string[]
  }) => request<BookmarkDetail>('/api/bookmarks', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * Deletes from Chrome too. A locally added bookmark goes immediately; a
   * Chrome-owned one is hidden now and removed once the extension confirms.
   */
  removeBookmark: (id: number) =>
    request<{ deleted: boolean; queued: boolean; extension: boolean }>(`/api/bookmarks/${id}`, {
      method: 'DELETE',
    }),
  batch: (body: {
    ids: number[]
    action: BatchAction
    folderGuid?: string | null
    tags?: string[]
  }) =>
    request<{ applied: number; queued: number; extension: boolean }>('/api/bookmarks/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ops: () => request<OpsStatus>('/api/ops'),
  retryOps: () => request<{ retried: number }>('/api/ops/retry', { method: 'POST' }),
  clearOps: () => request<{ cleared: number }>('/api/ops/clear', { method: 'POST' }),
  offlineStatus: () => request<{ chromeRunning: boolean; pending: number }>('/api/ops/offline'),
  /** Writes queued changes straight into Chrome's file; needs Chrome closed. */
  applyOffline: () =>
    request<{ applied: number; failed: number; backup: string | null }>('/api/ops/offline', {
      method: 'POST',
    }),
  hideDead: () => request<{ hidden: number }>('/api/bookmarks/hide-dead', { method: 'POST' }),
  refetch: (id: number) =>
    request<{ ok: true }>(`/api/bookmarks/${id}/refetch`, { method: 'POST' }),
  folders: (includeExcluded = false) =>
    request<FolderNode[]>(`/api/folders${includeExcluded ? '?includeExcluded=1' : ''}`),
  exclusions: () => request<ExcludedFolder[]>('/api/exclusions'),
  excludeFolder: (guid: string) =>
    request<{ excluded: boolean }>(`/api/folders/${encodeURIComponent(guid)}/exclusion`, {
      method: 'PUT',
    }),
  includeFolder: (guid: string) =>
    request<{ excluded: boolean }>(`/api/folders/${encodeURIComponent(guid)}/exclusion`, {
      method: 'DELETE',
    }),
  tags: () => request<TagWithCount[]>('/api/tags'),
  deleteTag: (id: number) => request<{ ok: true }>(`/api/tags/${id}`, { method: 'DELETE' }),
  status: () => request<Status>('/api/status'),
  settings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: Partial<{ paused: boolean; skipDomains: string; profile: string }>) =>
    request<{ ok: true }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  sync: (force = false) =>
    request<{ added: number; updated: number; removed: number; total: number; skipped: boolean }>(
      `/api/sync${force ? '?force=1' : ''}`,
      { method: 'POST' },
    ),
}
