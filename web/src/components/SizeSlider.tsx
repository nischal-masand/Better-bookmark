import { CARD_WIDTH_STOPS, stopIndex } from '../lib/cardSize'

interface Props {
  width: number
  onWidth: (value: number) => void
}

const LAST = CARD_WIDTH_STOPS.length - 1

/**
 * Stepped card-size control, parked bottom-right and out of the way.
 *
 * The visible track, notches and thumb are plain elements; a transparent range
 * input sits on top so dragging, clicking and arrow keys all behave natively
 * without having to reimplement any of it.
 */
export function SizeSlider({ width, onWidth }: Props) {
  const index = stopIndex(width)
  const percent = (index / LAST) * 100

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex justify-end">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/85 py-1.5 pl-3 pr-3.5 opacity-70 shadow-lg backdrop-blur-md transition hover:opacity-100 focus-within:opacity-100">
        <span className="shrink-0 text-[10.5px] text-[var(--color-ink-faint)]">Smaller</span>

        <div className="relative h-6 w-[132px] shrink-0">
          <div className="absolute inset-0 rounded-lg bg-[var(--color-surface-2)]" />

          {/* One notch per stop, inset by half a thumb so the ends line up. */}
          <div className="absolute inset-y-0 left-2.5 right-2.5">
            {CARD_WIDTH_STOPS.map((stop, i) => (
              <span
                key={stop}
                style={{ left: `${(i / LAST) * 100}%` }}
                className="absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/30"
              />
            ))}
            <span
              style={{ left: `${percent}%` }}
              className="absolute top-1/2 h-[18px] w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[5px] bg-[var(--color-ink)] shadow transition-[left] duration-150 ease-out"
            />
          </div>

          <input
            type="range"
            min={0}
            max={LAST}
            step={1}
            value={index}
            aria-label="Thumbnail size"
            aria-valuetext={`${CARD_WIDTH_STOPS[index]} pixels`}
            onChange={(event) => onWidth(CARD_WIDTH_STOPS[Number(event.target.value)]!)}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>

        <span className="shrink-0 text-[10.5px] text-[var(--color-ink-faint)]">Larger</span>
      </div>
    </div>
  )
}
