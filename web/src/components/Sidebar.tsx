import { useState } from 'react'
import {
  Archive,
  Bookmark as BookmarkIcon,
  ChevronRight,
  EyeOff,
  Folder,
  FolderOpen,
  Hash,
  Inbox,
  Library,
  Link2Off,
  Plus,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  Star,
  TriangleAlert,
} from 'lucide-react'
import type { FolderNode, Status, TagWithCount } from '../lib/api'
import { tagRgb } from './TagPill'
import type { Scope, ScopeFlag } from '../lib/scope'

interface Props {
  folders: FolderNode[]
  tags: TagWithCount[]
  status: Status | undefined
  scope: Scope
  onScope: (scope: Scope) => void
  onOpenSettings: () => void
  onAdd: () => void
  onExcludeFolder: (folder: FolderNode) => void
}

function Row({
  icon,
  label,
  count,
  active,
  depth = 0,
  onClick,
  leading,
  trailing,
  accentRgb,
  tone,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  depth?: number
  onClick: () => void
  leading?: React.ReactNode
  trailing?: React.ReactNode
  accentRgb?: string
  tone?: string
}) {
  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex w-full items-center gap-2 rounded-lg py-[5px] pr-2 text-left text-[12.5px] transition ${
          active
            ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
            : `${tone ?? 'text-[var(--color-ink-muted)]'} hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]`
        }`}
      >
        {leading}
        <span className="shrink-0" style={accentRgb ? { color: `rgb(${accentRgb})` } : undefined}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-[var(--color-ink-faint)] group-hover/row:opacity-0">
            {count}
          </span>
        )}
      </button>
      {trailing}
    </div>
  )
}

function FolderRow({
  node,
  scope,
  onScope,
  expanded,
  toggle,
  onExclude,
}: {
  node: FolderNode
  scope: Scope
  onScope: (scope: Scope) => void
  expanded: Set<string>
  toggle: (guid: string) => void
  onExclude: (folder: FolderNode) => void
}) {
  const isOpen = expanded.has(node.guid)
  const hasChildren = node.children.length > 0
  const active = scope.type === 'folder' && scope.guid === node.guid

  return (
    <>
      <Row
        icon={
          isOpen && hasChildren ? (
            <FolderOpen className="size-3.5" />
          ) : (
            <Folder className="size-3.5" />
          )
        }
        label={node.name}
        count={node.totalCount}
        active={active}
        depth={node.depth}
        onClick={() => onScope({ type: 'folder', guid: node.guid, name: node.name })}
        leading={
          hasChildren ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              onClick={(event) => {
                event.stopPropagation()
                toggle(node.guid)
              }}
              className="-ml-1 grid size-4 shrink-0 place-items-center rounded text-[var(--color-ink-faint)] transition hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
            >
              <ChevronRight
                className={`size-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
            </span>
          ) : (
            <span className="-ml-1 size-4 shrink-0" aria-hidden />
          )
        }
        trailing={
          <button
            type="button"
            aria-label={`Exclude ${node.name} from the library`}
            title="Exclude this folder — it stops appearing and its sites are never fetched"
            onClick={(event) => {
              event.stopPropagation()
              onExclude(node)
            }}
            className="absolute right-1 grid size-5 place-items-center rounded text-[var(--color-ink-faint)] opacity-0 transition hover:bg-[var(--color-line)] hover:text-[var(--color-ink)] group-hover/row:opacity-100 focus-visible:opacity-100"
          >
            <EyeOff className="size-3" />
          </button>
        }
      />
      {isOpen &&
        node.children.map((child) => (
          <FolderRow
            key={child.guid}
            node={child}
            scope={scope}
            onScope={onScope}
            expanded={expanded}
            toggle={toggle}
            onExclude={onExclude}
          />
        ))}
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
      {children}
    </div>
  )
}

const EXPANDED_KEY = 'bb.expandedFolders'

export function Sidebar({
  folders,
  tags,
  status,
  scope,
  onScope,
  onOpenSettings,
  onAdd,
  onExcludeFolder,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })

  const toggle = (guid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(guid)) next.delete(guid)
      else next.add(guid)
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const isFlag = (flag: ScopeFlag) => scope.type === 'flag' && scope.flag === flag
  const flagRow = (
    flag: ScopeFlag,
    icon: React.ReactNode,
    label: string,
    count?: number,
    tone?: string,
  ) => (
    <Row
      icon={icon}
      label={label}
      count={count}
      tone={tone}
      active={isFlag(flag)}
      onClick={() => onScope({ type: 'flag', flag })}
    />
  )

  const health = (status?.dead ?? 0) + (status?.blocked ?? 0) + (status?.unreachable ?? 0)

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 px-4 py-4">
        <BookmarkIcon className="size-[18px] text-[var(--color-accent)]" />
        <span className="text-[13px] font-semibold tracking-tight">Better Bookmark</span>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a bookmark"
          title="Add a bookmark"
          className="ml-auto grid size-6 place-items-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Row
          icon={<Library className="size-3.5" />}
          label="All bookmarks"
          count={status?.bookmarks}
          active={scope.type === 'all'}
          onClick={() => onScope({ type: 'all' })}
        />
        {flagRow('favorite', <Star className="size-3.5" />, 'Favourites', status?.favorites)}
        {flagRow('untagged', <Inbox className="size-3.5" />, 'Untagged')}
        {(status?.local ?? 0) > 0 &&
          flagRow('local', <Sparkles className="size-3.5" />, 'Added here', status?.local)}

        {health > 0 && (
          <>
            <SectionLabel>Link health</SectionLabel>
            {(status?.dead ?? 0) > 0 &&
              flagRow(
                'dead',
                <Link2Off className="size-3.5" />,
                'Dead links',
                status?.dead,
                'text-red-400/80',
              )}
            {(status?.unreachable ?? 0) > 0 &&
              flagRow(
                'unreachable',
                <TriangleAlert className="size-3.5" />,
                'Unreachable',
                status?.unreachable,
              )}
            {(status?.blocked ?? 0) > 0 &&
              flagRow(
                'blocked',
                <ShieldAlert className="size-3.5" />,
                'Blocked previews',
                status?.blocked,
              )}
          </>
        )}

        <SectionLabel>Chrome folders</SectionLabel>
        {folders.map((node) => (
          <FolderRow
            key={node.guid}
            node={node}
            scope={scope}
            onScope={onScope}
            expanded={expanded}
            toggle={toggle}
            onExclude={onExcludeFolder}
          />
        ))}

        {tags.length > 0 && (
          <>
            <SectionLabel>Tags</SectionLabel>
            {tags.map((tag) => (
              <Row
                key={tag.id}
                icon={<Hash className="size-3.5" />}
                label={tag.name}
                count={tag.count}
                accentRgb={tagRgb(tag.color)}
                active={scope.type === 'tag' && scope.name === tag.name}
                onClick={() => onScope({ type: 'tag', name: tag.name })}
              />
            ))}
          </>
        )}

        {((status?.hiddenCount ?? 0) > 0 || (status?.archived ?? 0) > 0) && (
          <>
            <SectionLabel>Put away</SectionLabel>
            {(status?.hiddenCount ?? 0) > 0 &&
              flagRow('hidden', <EyeOff className="size-3.5" />, 'Hidden', status?.hiddenCount)}
            {(status?.archived ?? 0) > 0 &&
              flagRow('archived', <Archive className="size-3.5" />, 'Archive', status?.archived)}
          </>
        )}
      </nav>

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-3 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <SettingsIcon className="size-3.5" />
        Settings
        {status?.profile && (
          <span className="ml-auto truncate text-[10.5px] text-[var(--color-ink-faint)]">
            {status.profile.label}
          </span>
        )}
      </button>
    </aside>
  )
}
