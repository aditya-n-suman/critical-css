import { describe, expect, it } from 'vitest'
import { PoolDrainingError, PoolExhaustedTimeoutError, Semaphore } from '../src/internal/semaphore.js'

describe('Semaphore (102 §10.1)', () => {
  it('grants immediately while permits remain and never exceeds the ceiling', async () => {
    const sem = new Semaphore(2)
    await sem.acquire(100)
    await sem.acquire(100)
    expect(sem.inUse).toBe(2)
    expect(sem.queueDepth).toBe(0)
  })

  it('queues FIFO and transfers the permit directly on release', async () => {
    const sem = new Semaphore(1)
    await sem.acquire(1000)
    const order: number[] = []
    const w1 = sem.acquire(1000).then(() => order.push(1))
    const w2 = sem.acquire(1000).then(() => order.push(2))
    expect(sem.queueDepth).toBe(2)
    sem.release()
    await w1
    sem.release()
    await w2
    expect(order).toEqual([1, 2])
    expect(sem.granted).toBe(3)
  })

  it('rejects with PoolExhaustedTimeoutError when the wait exceeds the bound', async () => {
    const sem = new Semaphore(1)
    await sem.acquire(1000)
    await expect(sem.acquire(30)).rejects.toBeInstanceOf(PoolExhaustedTimeoutError)
    // The timed-out waiter must be removed: a later release restores capacity.
    sem.release()
    await expect(sem.acquire(30)).resolves.toBeUndefined()
  })

  it('drain() rejects queued waiters and blocks new acquisitions', async () => {
    const sem = new Semaphore(1)
    await sem.acquire(1000)
    const queued = sem.acquire(5000)
    sem.drain()
    await expect(queued).rejects.toBeInstanceOf(PoolDrainingError)
    await expect(sem.acquire(10)).rejects.toBeInstanceOf(PoolDrainingError)
  })

  it('tracks granted/released diagnostic counters (leak detection, 102 §11)', async () => {
    const sem = new Semaphore(2)
    await sem.acquire(100)
    await sem.acquire(100)
    sem.release()
    sem.release()
    expect(sem.granted).toBe(2)
    expect(sem.released).toBe(2)
    expect(sem.inUse).toBe(0)
  })
})
