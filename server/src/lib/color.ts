import type { Sharp } from 'sharp'

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * Picks the colour a person would call "the brand colour" of an image.
 *
 * sharp's own `stats().dominant` is computed over every pixel, so for a favicon
 * it usually returns the transparent or white background. This buckets pixels by
 * coarse RGB and weights each by saturation and opacity instead, which favours
 * the logo over its backdrop. Used to tint the generated fallback cards.
 */
export async function dominantColor(pipeline: Sharp): Promise<string | null> {
  try {
    const { data, info } = await pipeline
      .resize(48, 48, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const buckets = new Map<
      number,
      { weight: number; r: number; g: number; b: number; n: number }
    >()
    let opaqueFallback: { r: number; g: number; b: number; n: number } | null = null

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const a = info.channels === 4 ? data[i + 3]! : 255
      if (a < 128) continue

      opaqueFallback ??= { r: 0, g: 0, b: 0, n: 0 }
      opaqueFallback.r += r
      opaqueFallback.g += g
      opaqueFallback.b += b
      opaqueFallback.n++

      const sat = saturation(r, g, b)
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
      // Ignore near-white, near-black and washed-out pixels: they are backdrop, not brand.
      if (sat < 0.25 || lightness < 24 || lightness > 236) continue

      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 }
      bucket.weight += sat * (a / 255)
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.n++
      buckets.set(key, bucket)
    }

    let best: { weight: number; r: number; g: number; b: number; n: number } | null = null
    for (const bucket of buckets.values()) {
      if (!best || bucket.weight > best.weight) best = bucket
    }
    if (best) return toHex(best.r / best.n, best.g / best.n, best.b / best.n)
    if (opaqueFallback?.n) {
      const { r, g, b, n } = opaqueFallback
      return toHex(r / n, g / n, b / n)
    }
    return null
  } catch {
    return null
  }
}
