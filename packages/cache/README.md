# @critical-css/cache

Fingerprint-gated Cache Manager (AT-08). Implements the caching mechanism
specified in `docs/design/800-Cache-Overview.md` through
`docs/design/806-Distributed-Cache.md`: a content-addressed key-value store
that sits **in front of the browser**, so a cache hit short-circuits the
entire extraction pipeline (REQ-301).

This package is a **mechanism, not a policy** (800 §7.3): it stores and
retrieves entries by fingerprint and reports hit/miss/stale. It never decides
*what* to recompute — that is the incremental-extraction strategy's job.
It depends only on `@critical-css/shared` and is a leaf package.

The canonical fingerprint algorithm lives **here** (`computeCacheFingerprint`,
801 §8.4/§11: SHA-256, 64-char lowercase hex, over a collision-proof
canonical-JSON composite). `@critical-css/shared` keeps only the DTO shapes
(`CacheFingerprint`, `CacheFingerprintInput`) — shared must stay free of Node
built-ins, while 801 mandates a cryptographic hash (`node:crypto`).

## Store layer (802, 806)

```ts
import { MemoryCacheStore, DiskCacheStore, TieredCacheStore, createCacheEntry } from '@critical-css/cache'

const store = new DiskCacheStore('/path/to/.ccss-cache')
const entry = createCacheEntry({
  key: fingerprint,           // opaque hex fingerprint (801)
  css: criticalCss,
  engineVersion: '0.1.0',
  extractionMode: 'cssom',
  viewportProfileId: 'vp-desktop',
})
await store.set(fingerprint, entry)
const hit = await store.get(fingerprint) // CacheEntry | null — corruption IS a miss
```

- **`CacheStore`** — the pluggable backend seam: `get`/`set`/`has`/`delete`/
  `clear`/`entries`/`stats` + `capabilities`. `get` never throws on corrupt or
  absent data; `set` is atomic and idempotent.
- **`MemoryCacheStore`** — process-local, LRU-bounded (`maxBytes`,
  `maxEntries`), non-persistent.
- **`DiskCacheStore`** — filesystem-backed
  (`<dir>/entries/<key[0:2]>/<key>.entry.json`), atomic
  write-temp+fsync+rename, checksum-validated reads (corrupt entry ⇒ evicted +
  miss), persistent across processes. LRU-bounded (`maxBytes`, `maxEntries`)
  with an advisory `index.json` (atomic rewrite) that provides warm start and
  persists `lastAccessedAt`/`hitCount` across instances. Failed writes are
  logged via the injectable `onDiagnostic` sink and degrade to a no-op (next
  read is a miss). Keys must be exactly 64 lowercase hex chars (801 §11).
- **`RemoteCacheStore`** — the distributed hook (806, interface level): plugs a
  `RemoteCacheClient` transport (S3/Redis/HTTP — follow-on work) behind the
  same contract; every remote fault degrades to a soft miss, never a build
  failure.
- **`TieredCacheStore`** — fast→slow composition with read-through back-fill
  and write-through.
- Helpers: `createCacheEntry`, `computeEntryChecksum`, `isEntryValid`,
  `CACHE_ENTRY_FORMAT_VERSION`.

## CacheManager (800, 805)

```ts
import { CacheManager, purgeByEngineVersion } from '@critical-css/cache'

const cache = new CacheManager({ store, ttlMs: 30 * 24 * 3600_000, onTrace: reporterSink })

const fp = cache.computeFingerprint(input).hash       // canonical SHA-256 fingerprint (801)
const result = await cache.lookup(fp)                 // hit | miss(cold/disabled) | stale(expired)

// The load-bearing primitive: produce() runs ONLY on miss/stale (REQ-301).
const { entry, outcome } = await cache.getOrProduce(fp, () => runExtractionPipeline())

// Explicit residuals (805): manual purge, TTL sweep, engine-version bump.
await cache.invalidate(purgeByEngineVersion('0.2.0'), 'engine-version-bump')

// Purges over viewport-cache entries must honor blob refcounts (805 §8.2):
const vpAware = new CacheManager({ store, deleteEntry: viewportCache.entryDeleter() })
```

- TTL is checked lazily at lookup with a strict `age > ttl` gate (an entry
  exactly at the TTL edge is still a hit).
- Every lookup/purge emits exactly one `CacheTraceEvent`
  (`hit` / `miss{cold|expired|disabled}` / `purged` / `cascade`) — Principle 6.
- `disabled: true` (`--no-cache`) makes lookup always miss and store a no-op,
  with traces still recorded.
- Predicate helpers: `purgeAll()`, `purgeByEngineVersion(v)`,
  `purgeExpired(ttlMs, now)`, `purgeByMeta(field, value)`.
- `correlateCascades(misses, priorAssetHashes)` — diagnostics-only grouping of
  a build's misses attributable to one shared-asset edit (805 §8.5); never
  gates control flow.

## Route cache (803)

```ts
import { RouteCache, expandRouteManifest, toRouteManifestEntries } from '@critical-css/cache'

const manifest = expandRouteManifest({ '/': 'home.css', '/blog/*': 'blog.css' })
const routes = new RouteCache(manifest)
const { key, descriptor } = routes.resolveRouteKey('/blog/post-1', templateFp, viewportProfileId)
```

- Pattern grammar: literals, `:param`, trailing `*`, root `/`; positional
  specificity (left-to-right: literal > `:param` > `*` at the first differing
  segment) with first-match-wins; duplicate or structurally ambiguous patterns
  (`/docs/:a` vs `/docs/:b`) rejected at load.
- URL normalisation: query/fragment stripped, slashes collapsed, injective
  percent-decoding (only safe printable ASCII decoded; `/`, `%`, control chars
  and non-ASCII stay encoded, so distinct URLs never collapse), trailing slash
  dropped (except root).
- Collapse invariant: all URLs under a `shareGroup` pattern resolve to one
  routeKey. Invalidation invariant: a template-fingerprint change strands the
  old key — no fan-out deletion.
- `shareGroup: false` and `paramsInFingerprint` provide per-URL and per-param
  de-collapse. Unmatched URLs fall back to per-URL keys (never dropped).
- `toRouteManifestEntries(manifest)` composes back into the shared
  `RouteManifestEntry` DTO.

## Viewport cache (804)

```ts
import { ViewportCache } from '@critical-css/cache'

const vp = new ViewportCache({ store, engineVersion: '0.1.0' })
await vp.writePerViewport(fingerprint, css, { extractionMode: 'cssom', viewportProfileId })
const result = await vp.readPerViewport(fingerprint)  // dedup-transparent; dangling key ⇒ miss
const mergeKey = vp.deriveMergeKey([fpMobile, fpDesktop], mergeConfig) // order-independent
await vp.writeMerged(mergeKey, mergedCss, info)
```

- Two-level layout: key index (fingerprint → contentHash) over a refcounted
  content-addressed blob store — byte-identical outputs across profiles are
  stored once; keys remain independently invalidatable.
- Deleting one key decrements (never unconditionally deletes) a shared blob.
- The merged artifact is keyed on the **sorted set** of per-viewport
  fingerprints + merge config + engine version.
- `dedupStats()` exposes the dedup ratio (a falling ratio signals upstream
  serializer nondeterminism).

## Testing

```
pnpm --filter @critical-css/cache test
```

107 unit tests across the fingerprint algorithm (format, determinism,
delimiter-collision regressions), store contract (memory + disk + tiered +
remote stub), disk LRU/warm-start/diagnostics, TTL boundary (fake clock),
explicit purge (incl. refcount-honoring purge through
`ViewportCache.entryDeleter()`), engine-version bump, route glob
matching/positional specificity/ambiguity rejection, URL-normalisation
injectivity, viewport dedup/refcount (incl. dangling-key repair), merge keys,
and cascade correlation.
