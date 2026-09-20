import { parseHTML } from 'linkedom'

export interface PageMeta {
  title: string | null
  description: string | null
  siteName: string | null
  imageUrl: string | null
  imageSource: 'og' | 'twitter' | 'link' | null
  iconUrls: string[]
  themeColor: string | null
  canonical: string | null
  document: Document
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length ? text.slice(0, 2000) : null
}

function metaContent(doc: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector)
    const value = clean(el?.getAttribute('content'))
    if (value) return value
  }
  return null
}

function absolute(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('data:')) return null
  try {
    return new URL(trimmed, base).toString()
  } catch {
    return null
  }
}

/** Largest declared size wins; a 180px apple-touch-icon beats a 16px .ico. */
function iconWeight(el: Element): number {
  const rel = (el.getAttribute('rel') ?? '').toLowerCase()
  const sizes = el.getAttribute('sizes') ?? ''
  const px = Number(/(\d+)x\d+/i.exec(sizes)?.[1] ?? 0)
  if (rel.includes('apple-touch-icon')) return Math.max(px, 180)
  if (sizes.toLowerCase() === 'any') return 128 // usually an SVG
  return px || 16
}

export function extractMeta(html: string, baseUrl: string): PageMeta {
  const { document } = parseHTML(html)

  const imageCandidates: Array<[PageMeta['imageSource'], string | null]> = [
    [
      'og',
      metaContent(document, [
        'meta[property="og:image:secure_url"]',
        'meta[property="og:image"]',
        'meta[name="og:image"]',
        'meta[property="og:image:url"]',
      ]),
    ],
    [
      'twitter',
      metaContent(document, [
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
        'meta[name="twitter:image:src"]',
      ]),
    ],
    [
      'link',
      metaContent(document, ['meta[itemprop="image"]']) ??
        document.querySelector('link[rel="image_src"]')?.getAttribute('href') ??
        null,
    ],
  ]
  const picked = imageCandidates.find(([, value]) => Boolean(value))

  const icons = [
    ...document.querySelectorAll(
      'link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel="shortcut icon"]',
    ),
  ]
    .sort((a, b) => iconWeight(b as Element) - iconWeight(a as Element))
    .map((el) => absolute((el as Element).getAttribute('href'), baseUrl))
    .filter((value): value is string => Boolean(value))

  return {
    title:
      metaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ??
      clean(document.querySelector('title')?.textContent),
    description: metaContent(document, [
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]),
    siteName: metaContent(document, [
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ]),
    imageUrl: picked ? absolute(picked[1], baseUrl) : null,
    imageSource: picked ? picked[0] : null,
    iconUrls: [...new Set(icons)].slice(0, 4),
    themeColor: metaContent(document, ['meta[name="theme-color"]']),
    canonical: absolute(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      baseUrl,
    ),
    document: document as unknown as Document,
  }
}
