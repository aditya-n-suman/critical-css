# 007 — Implement Cache Manager

## Title

**Implement `packages/cache`: Fingerprint-Gated Cache Manager**

## Package/Module

`packages/cache` (module `M13`, Phase 10 — Caching). Owns the `CacheStore` interface, fingerprint-keyed lookup/store, per-route and per-viewport granularity, invalidation, and the optional distributed backend. Sits in front of the Browser Manager as a short-circuit gate, not behind the Serializer.

## Depends-On

- `packages/browser` (must exist and be stable — a cache hit is defined as skipping this package's invocation entirely; the interface this task short-circuits must already be fixed).
- `packages/serializer` (task 006 — the `SerializedArtifact` shape this module stores as a `CacheEntry` payload must already be settled).
- ../architecture/016-Data-Flow.md (`CacheEntry` DTO, Section 10.2 `storeCacheEntry` / `lookupCacheEntry` mapping).
- ../architecture/003-Requirements.md REQ-300–304.

## Design Doc Reference

../design/800-Cache-Overview.md, and its five sub-concern siblings 801–806 (Fingerprinting, Cache Store, Route Cache, Viewport Cache, Cache Invalidation, Distributed Cache), all implemented here as one cohesive package.

## Overview

This task builds `packages/cache` as a content-addressed lookup mechanism whose correctness bar is that fingerprint equality is both necessary and sufficient for output equivalence — no false hits, no spurious misses (800 §7.1). The fingerprint (801) must be computable from inputs alone (HTML content, referenced CSS asset contents, viewport profile, extraction mode, engine version/config) without running a browser, because the module's entire value proposition depends on being consultable *before* `apps/cli` invokes any extraction strategy (800 §7.2). This task is explicitly a mechanism, not a policy: it must not embed any decision about *what* to recompute or reuse — that is the incremental-extraction strategy's job (704, out of scope here) — it only stores and retrieves entries by fingerprint and reports hit/miss.

Because 801–806 are siblings this overview delegates to but does not itself specify algorithmically, this task's scope includes the concrete fingerprint algorithm, the filesystem `CacheStore` backend, per-route/per-viewport granularity, explicit and TTL invalidation, and the distributed backend behind the same `CacheStore` interface — not merely a stubbed lookup that always misses.

## Acceptance Criteria

- `CacheStore` interface (802) is implemented with a filesystem backend: `get(fingerprint)`, `set(fingerprint, entry)`, `has(fingerprint)`, `invalidate(key)`, matching ../architecture/016-Data-Flow.md's `CacheEntry` DTO shape.
- Fingerprint construction (801) hashes exactly HTML content, referenced CSS asset contents, viewport profile, extraction mode, and engine version/config — REQ-300 — and is deterministic: identical inputs across two process invocations produce byte-identical fingerprints.
- A cache hit short-circuits before Browser Manager acquisition (REQ-301): a test harness asserts zero Browser Manager invocations occur on a hit path.
- Per-route (803) and per-viewport (804) granularity is implemented such that invalidating or changing one route/viewport does not invalidate unrelated routes/viewports sharing the same build.
- Explicit invalidation (`invalidate(key)`) and TTL-based expiry are both implemented (REQ-302, 805), and every hit/miss/invalidation event emits a diagnostic record consumable by the Reporter (805, Principle 6).
- The distributed/shared backend (806, REQ-304) is implemented additively behind the same `CacheStore` interface — no call site outside `packages/cache` branches on which backend is active.
- Unit tests cover each of 801–806 independently; at least one integration test exercises a real hit (skip) and a real miss (populate then re-lookup) end-to-end against the filesystem backend.
- No false-hit regression test: two inputs differing only in one CSS asset byte produce different fingerprints and distinct cache entries.

## Estimated Complexity

**M** — the fingerprint/store/lookup core is straightforward content-addressed storage, but per-route/per-viewport granularity, TTL invalidation, and the distributed backend add real surface area without individually being algorithmically deep.

## Notes on Scope Boundaries

Two boundaries recur enough in review discussions of this module that they are worth stating explicitly in the task card itself rather than leaving them implicit in 800:

- **Mechanism vs. policy (800 §7.3).** This task must not implement any heuristic about *when* recomputation is worthwhile, *which* routes are "likely unchanged," or any predictive/probabilistic hit estimation. Those are the incremental-extraction strategy's (704) concern, and 704 is explicitly a *client* of this module, not a peer to be conflated with it. If an implementer finds themselves writing a function that decides "should we recompute this even though the fingerprint matches" or "should we treat a near-miss as a hit," that code belongs in a different package.
- **Opaque key discipline.** Every consumer of `packages/cache` — the orchestrator (task 011), the SSR route cache (task 010's `lookupCriticalCss`) — must treat the fingerprint purely as an opaque string key. No caller-side logic should parse, decompose, or derive meaning from a fingerprint's internal structure; doing so would silently couple callers to 801's hash algorithm and make a future fingerprint-algorithm change a breaking change across the whole system rather than an internal one.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, at the "New module implementation" applicability level (Section 8.2): Gates 1–7, including an integration test against `packages/browser` for the short-circuit behavior (Gate 3, crosses boundary by construction per Section 11.2.3), and doc updates to 800–806 if implementation surfaces any divergence from the documented fingerprint or invalidation semantics.
