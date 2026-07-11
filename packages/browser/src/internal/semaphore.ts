/**
 * Bounded concurrency permit acquisition, per docs/design/102-Browser-Pool.md
 * §10.1: FIFO wait queue, never exceeds the ceiling, bounded wait.
 */

import { ExtractionError } from '@critical-css/shared'

interface Waiter {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class PoolExhaustedTimeoutError extends ExtractionError {
  constructor(timeoutMs: number) {
    super(
      'POOL_EXHAUSTED_TIMEOUT',
      `Browser pool saturated: no permit became available within ${timeoutMs}ms`,
      { context: { timeoutMs } },
    )
  }
}

export class PoolDrainingError extends ExtractionError {
  constructor() {
    super('POOL_DRAINING', 'Browser pool is draining; no new acquisitions are granted')
  }
}

export class Semaphore {
  private permits: number
  private readonly waitQueue: Waiter[] = []
  private draining = false

  /** Diagnostic counters (102 §11): granted vs released must converge. */
  granted = 0
  released = 0

  constructor(readonly maxPermits: number) {
    this.permits = maxPermits
  }

  get inUse(): number {
    return this.maxPermits - this.permits
  }

  get queueDepth(): number {
    return this.waitQueue.length
  }

  acquire(timeoutMs: number): Promise<void> {
    if (this.draining) return Promise.reject(new PoolDrainingError())
    if (this.permits > 0) {
      this.permits -= 1
      this.granted += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          this.granted += 1
          resolve()
        },
        reject,
        timer: setTimeout(() => {
          const idx = this.waitQueue.indexOf(waiter)
          if (idx !== -1) this.waitQueue.splice(idx, 1)
          reject(new PoolExhaustedTimeoutError(timeoutMs))
        }, timeoutMs),
      }
      this.waitQueue.push(waiter)
    })
  }

  release(): void {
    this.released += 1
    const next = this.waitQueue.shift()
    if (next !== undefined && !this.draining) {
      clearTimeout(next.timer)
      // Permit transferred directly to the next FIFO waiter (102 §10.1).
      next.resolve()
    } else {
      this.permits += 1
    }
  }

  /** Stop granting permits; reject all queued waiters. */
  drain(): void {
    this.draining = true
    for (const waiter of this.waitQueue.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new PoolDrainingError())
    }
  }
}
