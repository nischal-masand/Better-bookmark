const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
]

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const absoluteLong = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' })

export function relativeDate(ms: number | null): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) {
      const value = Math.round(diff / size)
      // Past a couple of months a real date is more useful than "8 months ago".
      if (unit === 'year' || (unit === 'month' && Math.abs(value) > 2)) return absolute.format(ms)
      return relative.format(value, unit)
    }
  }
  return 'just now'
}

export function fullDate(ms: number | null): string {
  return ms ? absoluteLong.format(ms) : 'Unknown'
}

/** Stable 0-359 hue per string, so a domain always gets the same fallback colour. */
export function hueFor(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

export function initialsFor(domain: string): string {
  const core = domain.replace(/^www\./, '').split('.')[0] ?? domain
  const parts = core.split(/[-_]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return core.slice(0, 2).toUpperCase()
}

export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = (u.pathname + u.search).replace(/\/$/, '')
    return u.hostname.replace(/^www\./, '') + path
  } catch {
    return url
  }
}
