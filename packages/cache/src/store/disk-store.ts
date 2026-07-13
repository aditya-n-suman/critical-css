/**
 * DiskCacheStore — filesystem-backed, persistent backend
 * (docs/design/802-Cache-Store.md §8.3, §8.5, §8.6).
 *
 * Layout:
 *   <cacheDir>/index.json                          # advisory LRU index (warm start)
 *   <cacheDir>/entries/<key[0:2]>/<key>.entry.json
 *
 * Writes are atomic and durable: write-temp (same directory, guaranteeing a
 * same-filesystem rename) + fsync + rename (802 §8.6). A reader therefore
 * sees either the complete old file or the complete new file, never a torn
 * blend. Racing writers on one key are benign — same fingerprint ⇒ identical
 * content ⇒ last-rename-wins is content-equivalent.
 *
 * LRU eviction (802 §8.5): bounded by `maxBytes`/`maxEntries`; accounting
 * lives in the advisory `index.json`, rewritten atomically, which also
 * persists `lastAccessedAt`/`hitCount` across store instances and provides
 * the warm-start index.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  CacheEntry,
  CacheEntrySummary,
  CacheStats,
  CacheStore,
  StoreCapabilities,
} from './types.js'
import { isEntryValid } from './types.js'

const ENTRY_SUFFIX = '.entry.json'
/** Cache keys are SHA-256 digests (801 §11): exactly 64 lowercase hex chars. */
const KEY_PATTERN = /^[0-9a-f]{64}$/
const INDEX_FILE = 'index.json'
const INDEX_VERSION = 1

export interface DiskCacheStoreOptions {
  /** Total accounted payload bytes before LRU eviction (802 §8.5). */
  readonly maxBytes?: number
  /** Entry-count bound before LRU eviction (802 §8.5). */
  readonly maxEntries?: number
  /** Diagnostic sink for degraded (logged, non-throwing) failure paths (802 §10.2). */
  readonly onDiagnostic?: (message: string, error?: unknown) => void
}

interface IndexRecord {
  byteSize: number
  lastAccessedAt: number
  hitCount: number
}

interface IndexFileShape {
  readonly version: number
  readonly entries: Readonly<Record<string, IndexRecord>>
}

export class DiskCacheStore implements CacheStore {
  readonly capabilities: StoreCapabilities = {
    persistent: true,
    sharedAcrossProcesses: true,
    evicts: true,
  }

  private readonly cacheDir: string
  private readonly entriesDir: string
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly onDiagnostic: (message: string, error?: unknown) => void
  private index: Map<string, IndexRecord> | null = null
  private hits = 0
  private misses = 0

  constructor(cacheDir: string, options: DiskCacheStoreOptions = {}) {
    this.cacheDir = cacheDir
    this.entriesDir = join(cacheDir, 'entries')
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
  }

  async get(key: string): Promise<CacheEntry | null> {
    const path = this.entryPath(key)
    if (path === null) {
      this.misses += 1
      return null
    }
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      this.misses += 1
      return null // absent or unreadable ⇒ miss, never an error (802 §8.2)
    }
    let entry: CacheEntry
    try {
      entry = JSON.parse(raw) as CacheEntry
    } catch {
      await bestEffortUnlink(path)
      this.misses += 1
      return null
    }
    if (!isEntryValid(entry, key)) {
      // Corrupt / torn / version-drifted entry: evict, treat as miss (802 §8.4).
      await bestEffortUnlink(path)
      this.misses += 1
      await this.dropFromIndex(key)
      return null
    }
    // LRU bookkeeping: cheap metadata-only index rewrite that never touches
    // the checksummed content file (802 §8.5).
    const index = await this.loadIndex()
    const record = index.get(key) ?? {
      byteSize: entry.meta.byteSize,
      lastAccessedAt: entry.meta.lastAccessedAt,
      hitCount: entry.meta.hitCount,
    }
    record.lastAccessedAt = Date.now()
    record.hitCount += 1
    index.set(key, record)
    await this.persistIndex()
    entry.meta.lastAccessedAt = record.lastAccessedAt
    entry.meta.hitCount = record.hitCount
    this.hits += 1
    return entry
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const path = this.entryPath(key)
    if (path === null) throw new TypeError(`invalid cache key: ${key}`)
    const shardDir = join(this.entriesDir, key.slice(0, 2))
    try {
      await mkdir(shardDir, { recursive: true })
      await writeFileAtomic(path, JSON.stringify(entry))
    } catch (error) {
      // Write failure is a logged no-op: next read is a miss ⇒ fresh
      // extraction (802 §10.2 failure cases). Temp cleanup happens inside
      // writeFileAtomic.
      this.onDiagnostic(`cache set failed for key ${key}; entry not stored`, error)
      return
    }
    const index = await this.loadIndex()
    const previous = index.get(key)
    index.set(key, {
      byteSize: entry.meta.byteSize,
      lastAccessedAt: Date.now(),
      hitCount: previous?.hitCount ?? entry.meta.hitCount,
    })
    await this.evictUntilWithinLimits(key)
    await this.persistIndex()
  }

  async has(key: string): Promise<boolean> {
    const path = this.entryPath(key)
    if (path === null) return false
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<boolean> {
    const path = this.entryPath(key)
    if (path === null) return false
    try {
      await unlink(path)
    } catch {
      await this.dropFromIndex(key)
      return false
    }
    await this.dropFromIndex(key)
    return true
  }

  async clear(): Promise<void> {
    await rm(this.entriesDir, { recursive: true, force: true })
    await rm(join(this.cacheDir, INDEX_FILE), { force: true })
    this.index = new Map()
  }

  async entries(): Promise<CacheEntrySummary[]> {
    await this.loadIndex() // ensure the persisted LRU bookkeeping overlay
    const summaries: CacheEntrySummary[] = []
    for (const entry of await this.readAllEntries()) {
      summaries.push({ ...entry.meta, key: entry.key })
    }
    return summaries
  }

  async stats(): Promise<CacheStats> {
    let entryCount = 0
    let totalBytes = 0
    for (const entry of await this.readAllEntries()) {
      entryCount += 1
      totalBytes += entry.meta.byteSize
    }
    return { entryCount, totalBytes, hits: this.hits, misses: this.misses }
  }

  /**
   * Key-derived paths must stay inside the cache dir. Fingerprints are
   * SHA-256 hex digests (801 §11), so anything else is rejected (802 §12
   * path-traversal defence).
   */
  private entryPath(key: string): string | null {
    if (!KEY_PATTERN.test(key)) return null
    return join(this.entriesDir, key.slice(0, 2), `${key}${ENTRY_SUFFIX}`)
  }

  /**
   * Warm start (802 §8.3/§8.5): load the advisory `index.json`; if absent or
   * unreadable, rebuild the accounting by scanning the entry files.
   */
  private async loadIndex(): Promise<Map<string, IndexRecord>> {
    if (this.index !== null) return this.index
    const index = new Map<string, IndexRecord>()
    let loaded = false
    try {
      const raw = await readFile(join(this.cacheDir, INDEX_FILE), 'utf8')
      const parsed = JSON.parse(raw) as IndexFileShape
      if (
        parsed.version === INDEX_VERSION &&
        parsed.entries !== null &&
        typeof parsed.entries === 'object'
      ) {
        for (const [key, record] of Object.entries(parsed.entries)) {
          if (
            KEY_PATTERN.test(key) &&
            typeof record.byteSize === 'number' &&
            typeof record.lastAccessedAt === 'number' &&
            typeof record.hitCount === 'number'
          ) {
            index.set(key, { ...record })
          }
        }
        loaded = true
      }
    } catch {
      // missing or corrupt index: advisory only — rebuild below (802 §8.3)
    }
    if (!loaded) {
      for (const entry of await this.readAllEntries()) {
        index.set(entry.key, {
          byteSize: entry.meta.byteSize,
          lastAccessedAt: entry.meta.lastAccessedAt,
          hitCount: entry.meta.hitCount,
        })
      }
    }
    this.index = index
    return index
  }

  /** Atomic (temp + fsync + rename) advisory-index rewrite. */
  private async persistIndex(): Promise<void> {
    if (this.index === null) return
    const shape: IndexFileShape = {
      version: INDEX_VERSION,
      entries: Object.fromEntries(this.index),
    }
    try {
      await mkdir(this.cacheDir, { recursive: true })
      await writeFileAtomic(join(this.cacheDir, INDEX_FILE), JSON.stringify(shape))
    } catch (error) {
      // Advisory only: losing the index degrades warm start, never correctness.
      this.onDiagnostic('cache index persist failed; warm-start index may be stale', error)
    }
  }

  private async dropFromIndex(key: string): Promise<void> {
    const index = await this.loadIndex()
    if (index.delete(key)) await this.persistIndex()
  }

  /**
   * LRU eviction (802 §8.5/§10.2): after a `set`, delete
   * least-recently-accessed entries (never the just-written key) until both
   * `maxBytes` and `maxEntries` are satisfied. Capacity-driven and silent —
   * distinct from logged invalidation (805).
   */
  private async evictUntilWithinLimits(justWrittenKey: string): Promise<void> {
    const index = await this.loadIndex()
    const overLimits = (): boolean => {
      if (index.size > this.maxEntries) return true
      let total = 0
      for (const record of index.values()) total += record.byteSize
      return total > this.maxBytes
    }
    while (overLimits()) {
      let victim: string | null = null
      let oldest = Number.POSITIVE_INFINITY
      for (const [key, record] of index) {
        if (key === justWrittenKey) continue
        if (record.lastAccessedAt < oldest) {
          oldest = record.lastAccessedAt
          victim = key
        }
      }
      if (victim === null) return // nothing evictable left
      index.delete(victim)
      const path = this.entryPath(victim)
      if (path !== null) await bestEffortUnlink(path)
    }
  }

  private async readAllEntries(): Promise<CacheEntry[]> {
    let shards: string[]
    try {
      shards = await readdir(this.entriesDir)
    } catch {
      return []
    }
    const entries: CacheEntry[] = []
    for (const shard of shards) {
      let files: string[]
      try {
        files = await readdir(join(this.entriesDir, shard))
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith(ENTRY_SUFFIX)) continue
        try {
          const raw = await readFile(join(this.entriesDir, shard, file), 'utf8')
          const entry = JSON.parse(raw) as CacheEntry
          if (isEntryValid(entry, entry.key)) {
            // Overlay persisted LRU bookkeeping (advisory index) so
            // lastAccessedAt/hitCount survive across store instances.
            const record = this.index?.get(entry.key)
            if (record !== undefined) {
              entry.meta.lastAccessedAt = record.lastAccessedAt
              entry.meta.hitCount = record.hitCount
            }
            entries.push(entry)
          }
        } catch {
          // unreadable entries are skipped, never fatal
        }
      }
    }
    return entries
  }
}

/**
 * Write-temp + fsync + atomic rename (802 §8.6): durable on rename, and any
 * concurrent reader sees a complete old or complete new file. Cleans the
 * temp file and rethrows on failure — callers decide the degradation policy.
 */
async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path) // atomic within one filesystem
  } catch (error) {
    await bestEffortUnlink(tmp)
    throw error
  }
}

async function bestEffortUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // best effort only
  }
}
