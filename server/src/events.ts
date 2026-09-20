import { EventEmitter } from 'node:events'

export type AppEvent =
  | { type: 'sync'; added: number; updated: number; removed: number; resurrected: number }
  | { type: 'enriched'; bookmarkId: number }
  | { type: 'queue'; pending: number; failed: number }
  | { type: 'ops'; pending: number }

class Bus extends EventEmitter {
  emitEvent(event: AppEvent): void {
    this.emit('event', event)
  }
  onEvent(listener: (event: AppEvent) => void): () => void {
    this.on('event', listener)
    return () => this.off('event', listener)
  }
}

export const bus = new Bus()
bus.setMaxListeners(50)
