/**
 * RemoteCacheStore — the remote/distributed backend HOOK
 * (docs/design/802-Cache-Store.md §8.3/§8.8, 806-Distributed-Cache.md).
 *
 * Per 802, this file fixes the *contract*; concrete transports (S3, Redis,
 * HTTP) are 806's follow-on concern and plug in via `RemoteCacheClient`.
 * The load-bearing safety property (806 §8.4) is enforced here: no remote
 * fault may ever fail or block the build — every remote error degrades to a
 * soft miss on `get`/`has` and a silent drop on `set`/`delete`.
 */

import type {
  CacheEntry,
  CacheEntrySummary,
  CacheStats,
  CacheStore,
  StoreCapabilities,
} from './types.js'
import { isEntryValid } from './types.js'

/**
 * Minimal transport a distributed backend must provide (806 §8.1). Values
 * are the JSON-serialized `CacheEntry`; keys are opaque hex fingerprints.
 */
export interface RemoteCacheClient {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { readonly ttlSeconds?: number }): Promise<void>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Optional enumeration; backends without listing return `undefined`. */
  list?(): Promise<string[]>
}

export interface RemoteCacheStoreOptions {
  readonly ttlSeconds?: number
}

export class RemoteCacheStore implements CacheStore {
  readonly capabilities: StoreCapabilities = {
    persistent: true,
    sharedAcrossProcesses: true,
    evicts: true,
  }

  constructor(
    private readonly client: RemoteCacheClient,
    private readonly options: RemoteCacheStoreOptions = {},
  ) {}

  private hits = 0
  private misses = 0

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await this.client.get(key)
      if (raw === null) {
        this.misses += 1
        return null
      }
      const entry = JSON.parse(raw) as CacheEntry
      if (!isEntryValid(entry, key)) {
        await this.delete(key)
        this.misses += 1
        return null
      }
      this.hits += 1
      return entry
    } catch {
      // A network timeout is a miss, not a build failure (802 §8.3).
      this.misses += 1
      return null
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    try {
      const opts =
        this.options.ttlSeconds !== undefined ? { ttlSeconds: this.options.ttlSeconds } : undefined
      await this.client.put(key, JSON.stringify(entry), opts)
    } catch {
      // fire-and-forget drop (806 §8.4)
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return await this.client.has(key)
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.delete(key)
      return true
    } catch {
      return false
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = (await this.client.list?.()) ?? []
      for (const key of keys) await this.client.delete(key)
    } catch {
      // best effort
    }
  }

  async entries(): Promise<CacheEntrySummary[]> {
    try {
      const keys = (await this.client.list?.()) ?? []
      const summaries: CacheEntrySummary[] = []
      for (const key of keys) {
        const entry = await this.get(key)
        if (entry !== null) summaries.push({ ...entry.meta, key: entry.key })
      }
      return summaries
    } catch {
      return []
    }
  }

  async stats(): Promise<CacheStats> {
    return { entryCount: 0, totalBytes: 0, hits: this.hits, misses: this.misses }
  }
}
