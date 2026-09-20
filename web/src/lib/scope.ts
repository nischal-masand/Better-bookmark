import type { ListParams, SortKey } from './api'

export type ScopeFlag =
  'favorite' | 'untagged' | 'dead' | 'blocked' | 'unreachable' | 'hidden' | 'archived' | 'local'

export type Scope =
  | { type: 'all' }
  | { type: 'flag'; flag: ScopeFlag }
  | { type: 'folder'; guid: string; name: string }
  | { type: 'tag'; name: string }

const FLAG_TITLES: Record<ScopeFlag, string> = {
  favorite: 'Favourites',
  untagged: 'Untagged',
  dead: 'Dead links',
  blocked: 'Blocked by the site',
  unreachable: 'Could not be reached',
  hidden: 'Hidden',
  archived: 'Archive',
  local: 'Added here',
}

export function scopeTitle(scope: Scope): string {
  switch (scope.type) {
    case 'all':
      return 'All bookmarks'
    case 'folder':
      return scope.name
    case 'tag':
      return `#${scope.name}`
    case 'flag':
      return FLAG_TITLES[scope.flag]
  }
}

export function scopeSubtitle(scope: Scope): string | null {
  switch (scope.type) {
    case 'flag':
      return {
        dead: 'These returned 404 or their domain no longer exists. Safe to clear out.',
        blocked:
          'These sites are alive but refuse automated requests, so there is no preview. The links still work.',
        unreachable: 'Timed out, or had a certificate or connection problem. Worth retrying later.',
        hidden: 'Kept out of every other view. Restore anything you want back.',
        archived: 'Deleted in Chrome. Tags and notes are still here if you re-add them.',
        local: 'Added in this app, so Chrome does not have them.',
        favorite: null,
        untagged: null,
      }[scope.flag]
    default:
      return null
  }
}

/** Folds the sidebar selection and the search box into one API request. */
export function toParams(scope: Scope, search: string, sort: SortKey, limit: number): ListParams {
  const terms = search.trim()
  const params: ListParams = { sort, limit }

  if (scope.type === 'folder') params.folder = scope.guid
  if (scope.type === 'tag') params.tag = scope.name

  const flagToken = scope.type === 'flag' ? `is:${scope.flag}` : ''
  const q = [terms, flagToken].filter(Boolean).join(' ')
  if (q) params.q = q

  return params
}
