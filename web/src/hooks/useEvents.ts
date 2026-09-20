import { useEffect, useRef } from 'react'

export type ServerEvent =
  | { type: 'sync'; added: number; updated: number; removed: number; resurrected: number }
  | { type: 'enriched'; bookmarkId: number }
  | { type: 'queue'; pending: number; failed: number }

/**
 * Subscribes to the server's event stream. Enrichment finishes one bookmark at a
 * time, so bursts are coalesced into a single refresh rather than re-rendering
 * the grid hundreds of times during the first import.
 */
export function useEvents(onFlush: () => void, delay = 700): void {
  const callback = useRef(onFlush)
  callback.current = onFlush

  useEffect(() => {
    const source = new EventSource('/api/events')
    let timer: number | undefined

    source.onmessage = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => callback.current(), delay)
    }

    return () => {
      window.clearTimeout(timer)
      source.close()
    }
  }, [delay])
}
