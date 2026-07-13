/**
 * @critical-css/cache — public API barrel (AT-08, M4).
 *
 * Fingerprint-gated Cache Manager per docs/design/800–806:
 *  - store abstraction + backends (802, 806 hook)
 *  - CacheManager: TTL-gated lookup, store, invalidate, trace events (800, 805)
 *  - route cache: manifest, glob patterns, route-key resolution (803)
 *  - viewport cache: per-viewport keying, output dedup, merged artifact (804)
 *  - cascade correlation diagnostics (805 §8.5)
 *
 * The canonical fingerprint algorithm (801 §8.4: SHA-256, 64-hex lowercase,
 * collision-proof canonical-JSON composite) lives HERE
 * (`computeCacheFingerprint`) — @critical-css/shared keeps only the DTO
 * shapes, because shared must stay free of Node built-ins while 801 mandates
 * a cryptographic hash.
 */

// Fingerprint (801) — the authoritative computation
export { computeCacheFingerprint } from './fingerprint.js'

// Store layer (802, 806)
export {
  CACHE_ENTRY_FORMAT_VERSION,
  DiskCacheStore,
  MemoryCacheStore,
  RemoteCacheStore,
  TieredCacheStore,
  computeEntryChecksum,
  createCacheEntry,
  isEntryValid,
} from './store/index.js'
export type {
  CacheEntry,
  CacheEntryInit,
  CacheEntryMeta,
  CacheEntrySummary,
  CacheStats,
  CacheStore,
  DiskCacheStoreOptions,
  MemoryCacheStoreOptions,
  RemoteCacheClient,
  RemoteCacheStoreOptions,
  StoreCapabilities,
} from './store/index.js'

// Manager + invalidation (800, 805)
export {
  CacheManager,
  DEFAULT_TTL_MS,
  correlateCascades,
  purgeAll,
  purgeByEngineVersion,
  purgeByMeta,
  purgeExpired,
} from './manager/index.js'
export type {
  CacheLookupResult,
  CacheManagerOptions,
  CacheTraceEvent,
  EntryDeleter,
  CascadeCorrelationResult,
  CascadeEvent,
  CascadeMissRecord,
  CorrelateCascadesOptions,
  InvalidationPredicate,
  PurgeCause,
} from './manager/index.js'

// Route cache (803)
export {
  RouteCache,
  RoutePatternMatcher,
  expandRouteManifest,
  normalizeUrl,
  toRouteManifestEntries,
} from './route/index.js'
export type {
  RouteDescriptor,
  RouteDescriptorInit,
  RouteKeyResolution,
  RouteManifest,
  RouteMatch,
} from './route/index.js'

// Viewport cache (804)
export { ViewportCache } from './viewport/index.js'
export type {
  PerViewportReadResult,
  PerViewportWriteInfo,
  ViewportCacheOptions,
  ViewportDedupStats,
} from './viewport/index.js'
