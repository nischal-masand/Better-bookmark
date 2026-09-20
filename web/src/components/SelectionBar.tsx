import { useEffect, useRef, useState } from 'react'
import { ChevronDown, EyeOff, FolderInput, RotateCcw, Star, Tag, Trash2, X } from 'lucide-react'
import type { BatchAction, FolderNode } from '../lib/api'

interface Props {
  count: number
  /** True while viewing Hidden, where the useful action is putting things back. */
  hiddenScope: boolean
  folders: FolderNode[]
  busy: boolean
  onAction: (action: BatchAction, options?: { folderGuid?: string | null; tags?: string[] }) => void
  onClear: () => void
  onSelectAll: () => void
}

function flatten(nodes: FolderNode[], out: FolderNode[] = []): FolderNode[] {
  for (const node of nodes) {
    out.push(node)
    flatten(node.children, out)
  }
  return out
}

function useDismiss(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onDismiss()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])
  return ref
}

function MoveMenu({ folders, onPick }: { folders: FolderNode[]; onPick: (guid: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useDismiss(() => setOpen(false))

  const all = flatten(folders)
  const matches = filter
    ? all.filter((node) => node.path.toLowerCase().includes(filter.toLowerCase()))
    : all

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <FolderInput className="size-3.5" />
        Move to
        <ChevronDown className="size-3" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl">
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a folder…"
            className="w-full border-b border-[var(--color-line)] bg-transparent px-3 py-2 text-[12px] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && (
              <p className="px-3 py-2 text-[11.5px] text-[var(--color-ink-faint)]">
                No folder matches.
              </p>
            )}
            {matches.map((node) => (
              <button
                key={node.guid}
                type="button"
                onClick={() => {
                  onPick(node.guid)
                  setOpen(false)
                  setFilter('')
                }}
                style={{ paddingLeft: 12 + node.depth * 12 }}
                className="block w-full truncate py-1.5 pr-3 text-left text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                title={node.path}
              >
                {node.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TagMenu({ onApply }: { onApply: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const ref = useDismiss(() => setOpen(false))

  const submit = () => {
    const tags = value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tags.length) onApply(tags)
    setValue('')
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <Tag className="size-3.5" />
        Tag
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-60 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-2 shadow-2xl">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            placeholder="reading, design"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-[12px] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            className="mt-1.5 w-full rounded-lg bg-[var(--color-accent)] py-1.5 text-[12px] font-medium text-white transition hover:brightness-110"
          >
            Add to selection
          </button>
        </div>
      )}
    </div>
  )
}

/** Appears only while something is selected; the escape hatch is always visible. */
export function SelectionBar({
  count,
  hiddenScope,
  folders,
  busy,
  onAction,
  onClear,
  onSelectAll,
}: Props) {
  const divider = <span className="h-4 w-px bg-[var(--color-line)]" />

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div
        className={`animate-fade-up pointer-events-auto flex items-center gap-1 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-1.5 pl-3 shadow-2xl backdrop-blur-md ${
          busy ? 'opacity-60' : ''
        }`}
      >
        <span className="mr-1 text-[12px] font-medium tabular-nums">{count} selected</span>
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-lg px-2 py-1.5 text-[11.5px] text-[var(--color-ink-faint)] transition hover:text-[var(--color-ink)]"
        >
          Select all
        </button>
        {divider}

        {hiddenScope ? (
          <button
            type="button"
            onClick={() => onAction('unhide')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <RotateCcw className="size-3.5" />
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAction('hide')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <EyeOff className="size-3.5" />
            Hide
          </button>
        )}

        <button
          type="button"
          onClick={() => onAction('favorite')}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <Star className="size-3.5" />
          Favourite
        </button>

        <TagMenu onApply={(tags) => onAction('tag', { tags })} />
        <MoveMenu folders={folders} onPick={(folderGuid) => onAction('move', { folderGuid })} />

        {divider}
        <button
          type="button"
          onClick={() => onAction('delete')}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--color-ink-muted)] transition hover:bg-red-500/12 hover:text-red-300"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>

        {divider}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="grid size-7 place-items-center rounded-lg text-[var(--color-ink-faint)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
