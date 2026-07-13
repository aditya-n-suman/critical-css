/**
 * TieredCacheStore — decorator composing an ordered fast→slow list of stores
 * (docs/design/802-Cache-Store.md §8.7).
 *
 * `get` probes tiers in order, returning the first hit and back-filling
 * faster tiers on the way up. `set` writes through to all tiers. `delete`
 * and `clear` fan out.
 */

import type {
  CacheEntry,
  CacheEntrySummary,
  CacheStats,
  CacheStore,
  StoreCapabilities,
} from './types.js'

export class TieredCacheStore implements CacheStore {
  readonly capabilities: StoreCapabilities

  constructor(private readonly tiers: readonly CacheStore[]) {
    if (tiers.length === 0) throw new TypeError('TieredCacheStore requires at least one tier')
    this.capabilities = {
      persistent: tiers.some((t) => t.capabilities.persistent),
      sharedAcrossProcesses: tiers.some((t) => t.capabilities.sharedAcrossProcesses),
      evicts: tiers.some((t) => t.capabilities.evicts),
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]
      if (tier === undefined) continue
      const entry = await tier.get(key)
      if (entry !== null) {
        // Back-fill faster tiers (802 §8.7).
        for (let j = 0; j < i; j++) {
          await this.tiers[j]?.set(key, entry)
        }
        return entry
      }
    }
    return null
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    for (const tier of this.tiers) await tier.set(key, entry)
  }

  async has(key: string): Promise<boolean> {
    for (const tier of this.tiers) {
      if (await tier.has(key)) return true
    }
    return false
  }

  async delete(key: string): Promise<boolean> {
    let deleted = false
    for (const tier of this.tiers) {
      deleted = (await tier.delete(key)) || deleted
    }
    return deleted
  }

  async clear(): Promise<void> {
    for (const tier of this.tiers) await tier.clear()
  }

  /** Enumerates the authoritative (slowest persistent, else last) tier. */
  async entries(): Promise<CacheEntrySummary[]> {
    const authoritative =
      [...this.tiers].reverse().find((t) => t.capabilities.persistent) ??
      this.tiers[this.tiers.length - 1]
    return authoritative === undefined ? [] : authoritative.entries()
  }

  async stats(): Promise<CacheStats> {
    let entryCount = 0
    let totalBytes = 0
    let hits = 0
    let misses = 0
    for (const tier of this.tiers) {
      const s = await tier.stats()
      entryCount = Math.max(entryCount, s.entryCount)
      totalBytes = Math.max(totalBytes, s.totalBytes)
      hits += s.hits
      misses += s.misses
    }
    return { entryCount, totalBytes, hits, misses }
  }
}
