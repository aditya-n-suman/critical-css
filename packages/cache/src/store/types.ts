/**
 * CacheStore contract + CacheEntry format, per docs/design/802-Cache-Store.md
 * §8.1–8.2 and docs/design/800-Cache-Overview.md §8.1.
 *
 * Contract obligations binding all implementations (802 §8.2):
 *  1. `get` never throws on a corrupt or absent entry — it returns `null`.
 *  2. `set` is atomic and idempotent.
 *  3. `has` may be racy but must be monotone-honest.
 *  4. `capabilities` is declarative and honest.
 */

import { canonicalJsonStringify } from '@critical-css/shared'
import { sha256Hex } from '../hash.js'

/** Entry-format schema version — a mismatch on read is a miss (802 §8.1). */
export const CACHE_ENTRY_FORMAT_VERSION = 1

/**
 * Entry envelope metadata (802 §8.1). `lastAccessedAt` and `hitCount` are
 * mutable bookkeeping and are excluded from the checksum.
 *
 * Keying policies (803/804) may attach extra metadata (e.g. `routePattern`,
 * `kind`, `refCount`) — the index signature keeps this type generic over
 * that, per docs/design/805-Cache-Invalidation.md §8.1.
 */
export interface CacheEntryMeta {
  readonly engineVersion: string
  readonly extractionMode: string
  readonly viewportProfileId: string
  /** Epoch ms (envelope only — never part of the fingerprinted payload). */
  createdAt: number
  /** Epoch ms, mutated on read for LRU; excluded from checksum. */
  lastAccessedAt: number
  /** Diagnostics only; excluded from checksum. */
  hitCount: number
  /** Total accounted size of the payload. */
  readonly byteSize: number
  /** Redundant with `key` for integrity cross-checks and auditing (802 §8.1). */
  readonly sourceDigest: string
  readonly [extra: string]: unknown
}

/** The unit the store reads and writes atomically (802 §8.1). */
export interface CacheEntry {
  /** The fingerprint from 801 — the primary index. */
  readonly key: string
  readonly formatVersion: number
  /** The critical CSS text (already serialized/minified). */
  readonly css: string
  /** Optional co-stored JSON source map (605). */
  readonly sourceMap?: string
  /** Optional per-viewport slices (804). */
  readonly perViewport?: Readonly<Record<string, { readonly css: string }>>
  readonly meta: CacheEntryMeta
  /** Digest over {css, sourceMap, perViewport, meta-sans-mutable-fields}. */
  readonly checksum: string
}

/** Metadata summary yielded by `entries()` — the invalidation scan surface. */
export interface CacheEntrySummary extends CacheEntryMeta {
  readonly key: string
}

export interface CacheStats {
  readonly entryCount: number
  readonly totalBytes: number
  readonly hits: number
  readonly misses: number
}

export interface StoreCapabilities {
  readonly persistent: boolean
  readonly sharedAcrossProcesses: boolean
  readonly evicts: boolean
}

/** The pluggable backend seam (800 §8.1, 802 §8.2, 806). */
export interface CacheStore {
  /** `null` = miss. Never throws on corruption — corruption IS a miss. */
  get(key: string): Promise<CacheEntry | null>
  /** Atomic and idempotent. */
  set(key: string, entry: CacheEntry): Promise<void>
  /** Presence probe; may be cheaper than `get`, racy but monotone-honest. */
  has(key: string): Promise<boolean>
  /** `true` if an entry was removed. */
  delete(key: string): Promise<boolean>
  /** Remove all entries in this store. */
  clear(): Promise<void>
  /** Enumerate entry metadata — drives `invalidate(predicate)` (805 §8.1). */
  entries(): Promise<CacheEntrySummary[]>
  stats(): Promise<CacheStats>
  readonly capabilities: StoreCapabilities
}

/** Fields the caller supplies when building an entry. */
export interface CacheEntryInit {
  readonly key: string
  readonly css: string
  readonly sourceMap?: string
  readonly perViewport?: Readonly<Record<string, { readonly css: string }>>
  readonly engineVersion: string
  readonly extractionMode: string
  readonly viewportProfileId: string
  /** Envelope timestamp; defaults to `Date.now()`. */
  readonly createdAt?: number
  /** Extra metadata attached by keying policies (routePattern, …). */
  readonly extraMeta?: Readonly<Record<string, unknown>>
}

/**
 * Checksum over the immutable content + framing; `lastAccessedAt`/`hitCount`
 * deliberately excluded so LRU access-time updates never rewrite content
 * (802 §8.1).
 */
export function computeEntryChecksum(entry: {
  readonly key: string
  readonly formatVersion: number
  readonly css: string
  readonly sourceMap?: string
  readonly perViewport?: Readonly<Record<string, { readonly css: string }>>
  readonly meta: CacheEntryMeta
}): string {
  const { lastAccessedAt: _atime, hitCount: _hits, ...immutableMeta } = entry.meta
  return sha256Hex(
    canonicalJsonStringify({
      key: entry.key,
      formatVersion: entry.formatVersion,
      css: entry.css,
      sourceMap: entry.sourceMap ?? null,
      perViewport: entry.perViewport ?? null,
      meta: immutableMeta,
    }),
  )
}

/** Build a well-formed, checksummed `CacheEntry` from its payload. */
export function createCacheEntry(init: CacheEntryInit): CacheEntry {
  const createdAt = init.createdAt ?? Date.now()
  const byteSize =
    utf8Length(init.css) +
    (init.sourceMap !== undefined ? utf8Length(init.sourceMap) : 0) +
    (init.perViewport !== undefined
      ? Object.values(init.perViewport).reduce((sum, slice) => sum + utf8Length(slice.css), 0)
      : 0)
  const meta: CacheEntryMeta = {
    ...init.extraMeta,
    engineVersion: init.engineVersion,
    extractionMode: init.extractionMode,
    viewportProfileId: init.viewportProfileId,
    createdAt,
    lastAccessedAt: createdAt,
    hitCount: 0,
    byteSize,
    sourceDigest: init.key,
  }
  const base = {
    key: init.key,
    formatVersion: CACHE_ENTRY_FORMAT_VERSION,
    css: init.css,
    ...(init.sourceMap !== undefined ? { sourceMap: init.sourceMap } : {}),
    ...(init.perViewport !== undefined ? { perViewport: init.perViewport } : {}),
    meta,
  }
  return { ...base, checksum: computeEntryChecksum(base) }
}

/**
 * Shared read-side validation (802 §8.4): a corrupt entry must become a MISS,
 * never a wrong HIT. Returns `true` only when the entry is intact.
 */
export function isEntryValid(entry: CacheEntry, expectedKey: string): boolean {
  if (entry.formatVersion !== CACHE_ENTRY_FORMAT_VERSION) return false
  if (entry.key !== expectedKey) return false
  if (entry.meta.sourceDigest !== entry.key) return false
  return computeEntryChecksum(entry) === entry.checksum
}

function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
