import type { Tag } from '../lib/api'

/** Tag colours are fixed token pairs so pills stay legible in both themes. */
const PALETTE: Record<string, string> = {
  slate: '148 163 184',
  rose: '251 113 133',
  amber: '251 191 36',
  emerald: '52 211 153',
  sky: '56 189 248',
  violet: '167 139 250',
  fuchsia: '232 121 249',
  lime: '163 230 53',
}

export function tagRgb(color: string): string {
  return PALETTE[color] ?? PALETTE.slate!
}

interface Props {
  tag: Tag
  onClick?: (tag: Tag) => void
  onRemove?: (tag: Tag) => void
}

export function TagPill({ tag, onClick, onRemove }: Props) {
  const rgb = tagRgb(tag.color)
  const style = {
    color: `rgb(${rgb})`,
    backgroundColor: `rgb(${rgb} / 0.12)`,
    borderColor: `rgb(${rgb} / 0.25)`,
  }

  const content = (
    <>
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Remove ${tag.name}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove(tag)
          }}
          className="-mr-0.5 ml-0.5 grid size-3.5 shrink-0 place-items-center rounded-full opacity-60 transition hover:bg-black/20 hover:opacity-100"
        >
          ×
        </span>
      )}
    </>
  )

  const className =
    'inline-flex max-w-[11rem] items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-4 transition'

  if (onClick) {
    return (
      <button
        type="button"
        style={style}
        className={`${className} hover:brightness-125`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick(tag)
        }}
      >
        {content}
      </button>
    )
  }

  return (
    <span style={style} className={className}>
      {content}
    </span>
  )
}
