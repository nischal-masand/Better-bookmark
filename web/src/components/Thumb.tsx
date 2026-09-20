import { useState } from 'react'
import type { Bookmark } from '../lib/api'
import { hueFor, initialsFor } from '../lib/format'

interface ThumbProps {
  bookmark: Bookmark
  className?: string
  /** Larger favicon chip and domain label, for the detail drawer. */
  size?: 'card' | 'large'
}

/**
 * Every card gets a picture. When the page publishes an og:image we show it;
 * otherwise we generate one from the site's own accent colour and favicon, so a
 * grid of link-only bookmarks still reads as a designed wall rather than a list
 * of grey boxes.
 */
export function Thumb({ bookmark, className = '', size = 'card' }: ThumbProps) {
  const [failed, setFailed] = useState(false)
  const showImage = bookmark.thumb && !failed

  if (showImage) {
    return (
      <div className={`relative overflow-hidden bg-[var(--color-surface-2)] ${className}`}>
        {/* A white og:image on a white card needs its own edge to read as artwork. */}
        <span aria-hidden className="thumb-ring pointer-events-none absolute inset-0 z-10" />
        <img
          src={bookmark.thumb!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>
    )
  }

  const tint = bookmark.accent ?? `hsl(${hueFor(bookmark.domain)} 65% 55%)`
  const chip = size === 'large' ? 'size-20 rounded-2xl' : 'size-14 rounded-xl'
  const icon = size === 'large' ? 'size-11' : 'size-7'

  return (
    <div
      className={`thumb-ring relative flex flex-col items-center justify-center overflow-hidden bg-[var(--color-surface-2)] ${className}`}
      style={
        {
          '--tint': tint,
          backgroundImage: `
            radial-gradient(85% 115% at 20% 10%, color-mix(in oklab, ${tint} 42%, transparent), transparent 62%),
            radial-gradient(65% 85% at 88% 94%, color-mix(in oklab, ${tint} 24%, transparent), transparent 60%),
            linear-gradient(155deg, color-mix(in oklab, ${tint} 12%, transparent), transparent 72%)
          `,
        } as React.CSSProperties
      }
    >
      {/* Faint dot grid keeps large flat areas from looking empty. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--color-ink) 12%, transparent) 1px, transparent 0)',
          backgroundSize: '14px 14px',
        }}
      />

      <div
        className={`relative flex ${chip} items-center justify-center border border-white/15 bg-white/10 shadow-lg shadow-black/20 backdrop-blur-sm`}
      >
        {bookmark.favicon ? (
          <img
            src={bookmark.favicon}
            alt=""
            loading="lazy"
            decoding="async"
            className={`${icon} object-contain drop-shadow`}
          />
        ) : (
          <span className="font-semibold tracking-tight text-[var(--color-ink)]/85">
            {initialsFor(bookmark.domain)}
          </span>
        )}
      </div>

      <span
        className={`relative mt-3 max-w-[85%] truncate font-mono uppercase tracking-[0.14em] text-[var(--color-ink)]/55 ${
          size === 'large' ? 'text-[11px]' : 'text-[9px]'
        }`}
      >
        {bookmark.domain}
      </span>
    </div>
  )
}
