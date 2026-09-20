/**
 * Card width is chosen from a handful of stops rather than any pixel value:
 * the in-between sizes were never meaningfully different, and stops make the
 * control land somewhere sensible every time.
 */
export const CARD_WIDTH_STOPS = [200, 260, 320, 380, 440, 500] as const

export const MIN_CARD_WIDTH = CARD_WIDTH_STOPS[0]
export const MAX_CARD_WIDTH = CARD_WIDTH_STOPS[CARD_WIDTH_STOPS.length - 1]
export const DEFAULT_CARD_WIDTH = 260

/** Snaps to the nearest stop, which also migrates any previously saved width. */
export function clampCardWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CARD_WIDTH
  return CARD_WIDTH_STOPS.reduce((best, stop) =>
    Math.abs(stop - value) < Math.abs(best - value) ? stop : best,
  )
}

export function stopIndex(width: number): number {
  const snapped = clampCardWidth(width)
  const index = CARD_WIDTH_STOPS.indexOf(snapped as (typeof CARD_WIDTH_STOPS)[number])
  return index < 0 ? CARD_WIDTH_STOPS.indexOf(DEFAULT_CARD_WIDTH as never) : index
}

export interface CardSpec {
  titleClass: string
  descriptionClass: string
  clamp: string
  skeletonHeight: number
}

/** Type and density scale with the card so the grid reads well at every stop. */
export function cardSpec(width: number): CardSpec {
  switch (clampCardWidth(width)) {
    case 200:
      return {
        titleClass: 'text-[12px]',
        descriptionClass: 'text-[11px]',
        clamp: 'line-clamp-2',
        skeletonHeight: 224,
      }
    case 260:
      return {
        titleClass: 'text-[13.5px]',
        descriptionClass: 'text-[11.5px]',
        clamp: 'line-clamp-2',
        skeletonHeight: 272,
      }
    case 320:
      return {
        titleClass: 'text-[14.5px]',
        descriptionClass: 'text-[12px]',
        clamp: 'line-clamp-3',
        skeletonHeight: 330,
      }
    case 380:
      return {
        titleClass: 'text-[15px]',
        descriptionClass: 'text-[12px]',
        clamp: 'line-clamp-3',
        skeletonHeight: 380,
      }
    case 440:
      return {
        titleClass: 'text-[16px]',
        descriptionClass: 'text-[12.5px]',
        clamp: 'line-clamp-3',
        skeletonHeight: 430,
      }
    default:
      return {
        titleClass: 'text-[17px]',
        descriptionClass: 'text-[13px]',
        clamp: 'line-clamp-4',
        skeletonHeight: 480,
      }
  }
}

export function gridStyle(width: number): React.CSSProperties {
  const snapped = clampCardWidth(width)
  // Gap grows with the cards so dense grids stay tight and large ones breathe.
  const gap = Math.round(12 + (snapped - MIN_CARD_WIDTH) * 0.02)
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${snapped}px, 1fr))`,
    gap: `${gap}px`,
  }
}
