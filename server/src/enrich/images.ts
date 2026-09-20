import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { ICON_SIZE, ICONS_DIR, MAX_IMAGE_BYTES, THUMBS_DIR, THUMB_WIDTH } from '../config.ts'
import { fetchLimited } from '../lib/http.ts'
import { decodeIco, isIco } from '../lib/ico.ts'
import { dominantColor } from '../lib/color.ts'
import { hashFor } from '../lib/url.ts'

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'

/** Smaller than this and it is a spacer, a tracking pixel or a bare logo — not a preview. */
const MIN_THUMB_WIDTH = 200
const MIN_THUMB_HEIGHT = 100

export interface StoredImage {
  /** Path as served to the browser, e.g. /thumbs/ab12.webp */
  urlPath: string
  accent: string | null
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchLimited(url, { maxBytes: MAX_IMAGE_BYTES, accept: IMAGE_ACCEPT })
    if (res.truncated || res.buffer.length === 0) return null
    return res.buffer
  } catch {
    return null
  }
}

/** Normalises anything sharp cannot open natively (currently: ICO containers). */
function toPipeline(buffer: Buffer): Sharp | null {
  if (!isIco(buffer)) return sharp(buffer, { animated: false })
  const entry = decodeIco(buffer)
  if (entry?.png) return sharp(entry.png)
  if (entry?.raw) {
    return sharp(entry.raw.data, {
      raw: { width: entry.raw.width, height: entry.raw.height, channels: entry.raw.channels },
    })
  }
  return null
}

export async function storeThumbnail(imageUrl: string): Promise<StoredImage | null> {
  const buffer = await download(imageUrl)
  if (!buffer) return null

  const pipeline = toPipeline(buffer)
  if (!pipeline) return null

  try {
    const meta = await pipeline.metadata()
    if ((meta.width ?? 0) < MIN_THUMB_WIDTH || (meta.height ?? 0) < MIN_THUMB_HEIGHT) return null

    const name = `${hashFor(imageUrl)}.webp`
    await pipeline
      .clone()
      .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toFile(path.join(THUMBS_DIR, name))

    return { urlPath: `/thumbs/${name}`, accent: await dominantColor(pipeline.clone()) }
  } catch {
    return null
  }
}

const iconCache = new Map<string, Promise<StoredImage | null>>()

async function fetchIcon(domain: string, candidates: string[]): Promise<StoredImage | null> {
  const name = `${hashFor(domain)}.webp`
  const filePath = path.join(ICONS_DIR, name)

  // Already on disk from another bookmark on this domain in an earlier run.
  try {
    await fs.access(filePath)
    return {
      urlPath: `/icons/${name}`,
      accent: await dominantColor(sharp(await fs.readFile(filePath))),
    }
  } catch {
    // not cached yet
  }

  for (const candidate of candidates) {
    const buffer = await download(candidate)
    if (!buffer) continue
    const pipeline = toPipeline(buffer)
    if (!pipeline) continue
    try {
      await pipeline
        .resize(ICON_SIZE, ICON_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, effort: 4 })
        .toFile(filePath)
      return { urlPath: `/icons/${name}`, accent: await dominantColor(pipeline.clone()) }
    } catch {
      continue
    }
  }
  return null
}

/**
 * One fetch per domain, shared across every bookmark that uses it — 236
 * bookmarks span ~170 domains, and many share one.
 */
export function storeFavicon(domain: string, candidates: string[]): Promise<StoredImage | null> {
  const cached = iconCache.get(domain)
  if (cached) return cached
  const job = fetchIcon(domain, candidates).catch(() => null)
  iconCache.set(domain, job)
  return job
}

export function clearIconCache(): void {
  iconCache.clear()
}
