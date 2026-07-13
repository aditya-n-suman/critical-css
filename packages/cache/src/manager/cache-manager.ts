/**
 * CacheManager — fingerprint-gated lookup/store/invalidate orchestration
 * (docs/design/800-Cache-Overview.md §8.1/§10.1,
 *  docs/design/805-Cache-Invalidation.md §8.1–8.6).
 *
 * The manager is a MECHANISM, not a policy (800 §7.3): it answers "do you
 * have a stored artifact for this fingerprint" and nothing else. It never
 * decides what to recompute — that is 704's (strategy) territory.
 */

import type { CacheFingerprint, CacheFingerprintInput } from '@critical-css/shared'

import { computeCacheFingerprint } from '../fingerprint.js'
import type { CacheEntry, CacheEntrySummary, CacheStore } from '../store/types.js'

/** Default TTL: 30 days (805 §8.3.3). */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Trace event vocabulary (805 §8.6). Every lookup/purge emits exactly one
 * outcome event — a silent hit violates Principle 6.
 */
export type CacheTraceEvent =
  | { readonly kind: 'hit'; readonly fingerprint: string }
  | {
      readonly kind: 'miss'
      readonly fingerprint: string
      readonly reason: 'cold' | 'disabled'
    }
  | {
      readonly kind: 'miss'
      readonly fingerprint: string
      readonly reason: 'expired'
      readonly ageMs: number
    }
  | {
      readonly kind: 'purged'
      readonly fingerprint: string
      readonly cause: PurgeCause
    }
  | {
      readonly kind: 'cascade'
      readonly assetCanonicalUrl: string
      readonly affectedFingerprints: readonly string[]
    }

export type PurgeCause = 'manual' | 'engine-version-bump' | 'ttl-sweep'

/** The three-way lookup outcome (800 §7.4). */
export type CacheLookupResult =
  | { readonly outcome: 'hit'; readonly entry: CacheEntry }
  | { readonly outcome: 'miss'; readonly reason: 'cold' | 'disabled' }
  | { readonly outcome: 'stale'; readonly reason: 'expired'; readonly ageMs: number }

/** Predicate over entry metadata driving explicit purges (805 §8.1). */
export type InvalidationPredicate = (meta: CacheEntrySummary) => boolean

/**
 * The single deletion choke point purges route through (805 §8.2/§10.1):
 * MUST honor refcount invariants (804 §8.2) when the entry participates in
 * a refcounted scheme. `ViewportCache.entryDeleter()` provides one.
 */
export type EntryDeleter = (key: string, meta: CacheEntrySummary) => Promise<boolean>

export interface CacheManagerOptions {
  readonly store: CacheStore
  /**
   * Refcount-aware deleter used by `invalidate` (805 §8.2): every purge
   * deletion is routed through this single choke point so a purge can never
   * bypass the viewport blob refcount discipline. Defaults to a plain
   * `store.delete`.
   */
  readonly deleteEntry?: EntryDeleter
  /** TTL in ms; strict `age > ttl` ⇒ stale (805 §8.3). */
  readonly ttlMs?: number
  /** `--no-cache`: lookup always misses, store is a no-op (800 §12). */
  readonly disabled?: boolean
  /** Trace sink — the Reporter consumes these (Principle 6). */
  readonly onTrace?: (event: CacheTraceEvent) => void
  /** Clock injection for deterministic tests. */
  readonly now?: () => number
}

export class CacheManager {
  private readonly store: CacheStore
  private readonly ttlMs: number
  private readonly disabled: boolean
  private readonly onTrace: (event: CacheTraceEvent) => void
  private readonly now: () => number
  private readonly deleteEntry: EntryDeleter

  constructor(options: CacheManagerOptions) {
    this.store = options.store
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.disabled = options.disabled ?? false
    this.onTrace = options.onTrace ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.deleteEntry = options.deleteEntry ?? ((key) => this.store.delete(key))
  }

  /** Delegates to shared's fingerprint algorithm (801) — never duplicated. */
  computeFingerprint(input: CacheFingerprintInput): CacheFingerprint {
    return computeCacheFingerprint(input)
  }

  /**
   * TTL-gated lookup (805 §10.2). Stale is treated as a miss for control
   * flow but is diagnostically distinct (`reason: 'expired'`).
   */
  async lookup(fingerprint: string): Promise<CacheLookupResult> {
    if (this.disabled) {
      this.onTrace({ kind: 'miss', fingerprint, reason: 'disabled' })
      return { outcome: 'miss', reason: 'disabled' }
    }
    const entry = await this.store.get(fingerprint)
    if (entry === null) {
      this.onTrace({ kind: 'miss', fingerprint, reason: 'cold' })
      return { outcome: 'miss', reason: 'cold' }
    }
    const createdAt = entry.meta.createdAt
    const ageMs = this.now() - createdAt
    // Missing/corrupt timestamp ⇒ conservatively already-expired (805 §10.2).
    if (typeof createdAt !== 'number' || Number.isNaN(createdAt) || ageMs > this.ttlMs) {
      this.onTrace({ kind: 'miss', fingerprint, reason: 'expired', ageMs })
      return { outcome: 'stale', reason: 'expired', ageMs }
    }
    this.onTrace({ kind: 'hit', fingerprint })
    return { outcome: 'hit', entry }
  }

  /** Store on miss; no-op when caching is disabled (800 §12). */
  async storeEntry(fingerprint: string, entry: CacheEntry): Promise<void> {
    if (this.disabled) return
    await this.store.set(fingerprint, entry)
  }

  /**
   * Fingerprint-gated extraction (800 §10.1): the produce callback runs ONLY
   * on a miss/stale — a hit short-circuits the entire pipeline (REQ-301).
   */
  async getOrProduce(
    fingerprint: string,
    produce: () => Promise<CacheEntry>,
  ): Promise<{ readonly entry: CacheEntry; readonly outcome: 'hit' | 'miss' | 'stale' }> {
    const result = await this.lookup(fingerprint)
    if (result.outcome === 'hit') return { entry: result.entry, outcome: 'hit' }
    const entry = await produce()
    await this.storeEntry(fingerprint, entry)
    return { entry, outcome: result.outcome }
  }

  /**
   * Explicit purge (805 §10.1): scans `entries()`, deletes matches through
   * the single refcount-honoring choke point (805 §8.2), emits one `purged`
   * trace event per deletion, returns the count.
   */
  async invalidate(predicate: InvalidationPredicate, cause: PurgeCause = 'manual'): Promise<number> {
    let count = 0
    for (const meta of await this.store.entries()) {
      if (!predicate(meta)) continue
      const deleted = await this.deleteEntry(meta.key, meta)
      if (deleted) {
        this.onTrace({ kind: 'purged', fingerprint: meta.key, cause })
        count += 1
      }
    }
    return count
  }

  /** Emit a cascade diagnostic (805 §8.5) — diagnostics only, never control flow. */
  emitCascade(assetCanonicalUrl: string, affectedFingerprints: readonly string[]): void {
    this.onTrace({ kind: 'cascade', assetCanonicalUrl, affectedFingerprints })
  }
}

/** Purge everything (805 §8.1). */
export function purgeAll(): InvalidationPredicate {
  return () => true
}

/**
 * Engine-version-bump purge, ALWAYS scoped to `!==` the current version —
 * never an unconditional clear, to preserve rollback safety (805 §8.4).
 */
export function purgeByEngineVersion(currentEngineVersion: string): InvalidationPredicate {
  return (meta) => meta.engineVersion !== currentEngineVersion
}

/** Optional TTL sweep predicate for storage-bound deployments (805 §8.3.2). */
export function purgeExpired(ttlMs: number, now: number = Date.now()): InvalidationPredicate {
  return (meta) => now - meta.createdAt > ttlMs
}

/** Namespace/route-scoped purge over policy-attached metadata (805 §8.2). */
export function purgeByMeta(field: string, value: unknown): InvalidationPredicate {
  return (meta) => meta[field] === value
}
