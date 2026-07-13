/**
 * MemoryCacheStore — process-local, LRU-bounded, non-persistent backend
 * (docs/design/802-Cache-Store.md §8.3, §8.5).
 *
 * LRU uses `Map` insertion-order semantics: touching a key deletes and
 * re-inserts it, so the first key in iteration order is always the
 * least-recently-used victim.
 */

import type {
  CacheEntry,
  CacheEntrySummary,
  CacheStats,
  CacheStore,
  StoreCapabilities,
} from './types.js'
import { isEntryValid } from './types.js'

export interface MemoryCacheStoreOptions {
  /** Evict LRU entries once total accounted bytes exceed this. */
  readonly maxBytes?: number
  /** Evict LRU entries once the entry count exceeds this. */
  readonly maxEntries?: number
}

export class MemoryCacheStore implements CacheStore {
  readonly capabilities: StoreCapabilities = {
    persistent: false,
    sharedAcrossProcesses: false,
    evicts: true,
  }

  private readonly store = new Map<string, CacheEntry>()
  private totalBytes = 0
  private hits = 0
  private misses = 0
  private readonly maxBytes: number
  private readonly maxEntries: number

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY
  }

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.store.get(key)
    if (entry === undefined) {
      this.misses += 1
      return null
    }
    if (!isEntryValid(entry, key)) {
      // Corruption is a miss, never a wrong hit (802 §8.4).
      await this.delete(key)
      this.misses += 1
      return null
    }
    // LRU touch: move to most-recently-used position.
    this.store.delete(key)
    this.store.set(key, entry)
    entry.meta.lastAccessedAt = Date.now()
    entry.meta.hitCount += 1
    this.hits += 1
    return entry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const previous = this.store.get(key)
    if (previous !== undefined) this.totalBytes -= previous.meta.byteSize
    this.store.delete(key)
    // Freeze to catch accidental post-store payload mutation (802 §11).
    Object.freeze(entry)
    this.store.set(key, entry)
    this.totalBytes += entry.meta.byteSize
    this.evictUntilWithinLimits()
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key)
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (entry === undefined) return false
    this.store.delete(key)
    this.totalBytes -= entry.meta.byteSize
    return true
  }

  async clear(): Promise<void> {
    this.store.clear()
    this.totalBytes = 0
  }

  async entries(): Promise<CacheEntrySummary[]> {
    return [...this.store.values()].map((entry) => ({ ...entry.meta, key: entry.key }))
  }

  async stats(): Promise<CacheStats> {
    return {
      entryCount: this.store.size,
      totalBytes: this.totalBytes,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /** Capacity-driven eviction is silent by design (802 §8.5, 805 §8.6). */
  private evictUntilWithinLimits(): void {
    while (this.totalBytes > this.maxBytes || this.store.size > this.maxEntries) {
      const victimKey = this.store.keys().next().value as string | undefined
      if (victimKey === undefined) break
      const victim = this.store.get(victimKey)
      this.store.delete(victimKey)
      if (victim !== undefined) this.totalBytes -= victim.meta.byteSize
    }
  }
}
