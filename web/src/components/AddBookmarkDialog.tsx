import { useEffect, useRef, useState } from 'react'
import { Info, Loader2, X } from 'lucide-react'
import type { FolderNode } from '../lib/api'

interface Props {
  folders: FolderNode[]
  defaultFolderGuid: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (body: {
    url: string
    title?: string
    folderGuid: string | null
    tags?: string[]
  }) => void
}

function flatten(nodes: FolderNode[], out: FolderNode[] = []): FolderNode[] {
  for (const node of nodes) {
    out.push(node)
    flatten(node.children, out)
  }
  return out
}

export function AddBookmarkDialog({
  folders,
  defaultFolderGuid,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [folderGuid, setFolderGuid] = useState<string>(defaultFolderGuid ?? '')
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => urlRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!url.trim() || busy) return
    onSubmit({
      url: url.trim(),
      title: title.trim() || undefined,
      folderGuid: folderGuid || null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
  }

  const field =
    'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[12.5px] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none'
  const label = 'mb-1 block text-[11px] font-medium text-[var(--color-ink-muted)]'

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="animate-fade-up w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <h2 className="text-[13.5px] font-semibold">Add a bookmark</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-lg text-[var(--color-ink-faint)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className={label} htmlFor="bb-url">
              Link
            </label>
            <input
              id="bb-url"
              ref={urlRef}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="example.com/article"
              className={field}
            />
          </div>

          <div>
            <label className={label} htmlFor="bb-title">
              Title{' '}
              <span className="text-[var(--color-ink-faint)]">
                — optional, taken from the page otherwise
              </span>
            </label>
            <input
              id="bb-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={field}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="bb-folder">
                Folder
              </label>
              <select
                id="bb-folder"
                value={folderGuid}
                onChange={(event) => setFolderGuid(event.target.value)}
                className={field}
              >
                <option value="">No folder</option>
                {flatten(folders).map((node) => (
                  <option key={node.guid} value={node.guid}>
                    {' '.repeat(node.depth * 2)}
                    {node.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="bb-tags">
                Tags <span className="text-[var(--color-ink-faint)]">— comma separated</span>
              </label>
              <input
                id="bb-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                className={field}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11.5px] text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5">
            <Info className="mt-px size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
            <p className="text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
              This is saved here only. Chrome's bookmark file is never written to, so the link will
              not appear in Chrome itself.
            </p>
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
            type="submit"
            disabled={!url.trim() || busy}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Add bookmark
          </button>
        </div>
      </form>
    </div>
  )
}
