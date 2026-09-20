import { Readability } from '@mozilla/readability'

export interface ReadableResult {
  title: string | null
  excerpt: string | null
  text: string | null
  wordCount: number
  readingTime: number | null
}

const MAX_TEXT_CHARS = 200_000
const WORDS_PER_MINUTE = 220

const EMPTY: ReadableResult = {
  title: null,
  excerpt: null,
  text: null,
  wordCount: 0,
  readingTime: null,
}

/**
 * Pulls the article body out of an already-parsed document so it can be indexed
 * for full-text search. Readability mutates the document, so this must run after
 * metadata extraction. Failure is normal (apps, dashboards, paywalls) and quiet.
 */
export function extractReadable(document: Document): ReadableResult {
  try {
    const article = new Readability(document, { charThreshold: 200 }).parse()
    if (!article?.textContent) return EMPTY

    const text = article.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
    if (text.length < 120) return EMPTY

    const wordCount = text.split(' ').length
    return {
      title: article.title?.trim() || null,
      excerpt: article.excerpt?.replace(/\s+/g, ' ').trim().slice(0, 500) || text.slice(0, 300),
      text,
      wordCount,
      readingTime: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
    }
  } catch {
    return EMPTY
  }
}
