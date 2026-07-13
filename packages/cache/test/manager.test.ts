import { describe, expect, it, vi } from 'vitest'
import type { ViewportProfile } from '@critical-css/shared'

import {
  CacheManager,
  MemoryCacheStore,
  createCacheEntry,
  purgeAll,
  purgeByEngineVersion,
  purgeByMeta,
  purgeExpired,
  type CacheTraceEvent,
} from '../src/index.js'

const desktop: ViewportProfile = {
  name: 'desktop',
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  userAgent: null,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  forcedColors: 'none',
  foldOffset: null,
}

const baseInput = {
  htmlContent: '<html><body><h1>hello</h1></body></html>',
  cssAssets: [
    { url: 'https://example.com/a.css', contentHash: 'hash-a' },
    { url: 'https://example.com/b.css', contentHash: 'hash-b' },
  ],
  viewportProfile: desktop,
  extractionMode: 'cssom' as const,
  engineVersion: '0.1.0',
}

function makeManager(overrides: Partial<ConstructorParameters<typeof CacheManager>[0]> = {}) {
  const store = new MemoryCacheStore()
  const events: CacheTraceEvent[] = []
  const manager = new CacheManager({
    store,
    onTrace: (e) => events.push(e),
    ...overrides,
  })
  return { store, events, manager }
}

function entryFor(key: string, css = 'h1{font-size:2rem}', createdAt?: number) {
  return createCacheEntry({
    key,
    css,
    engineVersion: '0.1.0',
    extractionMode: 'cssom',
    viewportProfileId: 'vp-desktop',
    ...(createdAt !== undefined ? { createdAt } : {}),
  })
}

describe('fingerprinting (reusing shared computeCacheFingerprint)', () => {
  it('identical inputs produce identical fingerprints (hit path is possible)', () => {
    const { manager } = makeManager()
    const fp1 = manager.computeFingerprint(baseInput)
    const fp2 = manager.computeFingerprint({ ...baseInput })
    expect(fp1.hash).toBe(fp2.hash)
  })

  it('a single CSS asset content change produces a different fingerprint (no false hits)', () => {
    const { manager } = makeManager()
    const fp1 = manager.computeFingerprint(baseInput)
    const fp2 = manager.computeFingerprint({
      ...baseInput,
      cssAssets: [
        { url: 'https://example.com/a.css', contentHash: 'hash-a-CHANGED' },
        { url: 'https://example.com/b.css', contentHash: 'hash-b' },
      ],
    })
    expect(fp2.hash).not.toBe(fp1.hash)
  })

  it('asset order does not affect the fingerprint (no spurious misses)', () => {
    const { manager } = makeManager()
    const fp1 = manager.computeFingerprint(baseInput)
    const fp2 = manager.computeFingerprint({
      ...baseInput,
      cssAssets: [...baseInput.cssAssets].reverse(),
    })
    expect(fp2.hash).toBe(fp1.hash)
  })

  it('engine version bump changes every fingerprint (implicit whole-cache bust)', () => {
    const { manager } = makeManager()
    const fp1 = manager.computeFingerprint(baseInput)
    const fp2 = manager.computeFingerprint({ ...baseInput, engineVersion: '0.2.0' })
    expect(fp2.hash).not.toBe(fp1.hash)
  })
})

describe('CacheManager lookup / store', () => {
  it('miss (cold) then hit round-trip, with one trace event per lookup', async () => {
    const { manager, events } = makeManager()
    const fp = manager.computeFingerprint(baseInput).hash

    expect(await manager.lookup(fp)).toEqual({ outcome: 'miss', reason: 'cold' })
    await manager.storeEntry(fp, entryFor(fp))
    const result = await manager.lookup(fp)
    expect(result.outcome).toBe('hit')
    if (result.outcome === 'hit') expect(result.entry.css).toBe('h1{font-size:2rem}')

    expect(events).toEqual([
      { kind: 'miss', fingerprint: fp, reason: 'cold' },
      { kind: 'hit', fingerprint: fp },
    ])
  })

  it('fingerprint mismatch is a miss: changed input never returns the old entry', async () => {
    const { manager } = makeManager()
    const fpOld = manager.computeFingerprint(baseInput).hash
    await manager.storeEntry(fpOld, entryFor(fpOld))
    const fpNew = manager.computeFingerprint({
      ...baseInput,
      htmlContent: baseInput.htmlContent + '<p>edit</p>',
    }).hash
    expect(fpNew).not.toBe(fpOld)
    expect((await manager.lookup(fpNew)).outcome).toBe('miss')
  })

  it('two inputs differing in one asset byte produce distinct cache entries', async () => {
    const { manager } = makeManager()
    const fpA = manager.computeFingerprint(baseInput).hash
    const fpB = manager.computeFingerprint({
      ...baseInput,
      cssAssets: [
        { url: 'https://example.com/a.css', contentHash: 'hash-a!' },
        { url: 'https://example.com/b.css', contentHash: 'hash-b' },
      ],
    }).hash
    await manager.storeEntry(fpA, entryFor(fpA, 'a{}'))
    await manager.storeEntry(fpB, entryFor(fpB, 'b{}'))
    const a = await manager.lookup(fpA)
    const b = await manager.lookup(fpB)
    expect(a.outcome).toBe('hit')
    expect(b.outcome).toBe('hit')
    if (a.outcome === 'hit' && b.outcome === 'hit') {
      expect(a.entry.css).not.toBe(b.entry.css)
    }
  })

  it('disabled mode: lookup always misses with reason=disabled, store is a no-op', async () => {
    const { manager, store, events } = makeManager({ disabled: true })
    const fp = 'f'.repeat(64)
    await manager.storeEntry(fp, entryFor(fp))
    expect((await store.stats()).entryCount).toBe(0)
    expect(await manager.lookup(fp)).toEqual({ outcome: 'miss', reason: 'disabled' })
    expect(events).toEqual([{ kind: 'miss', fingerprint: fp, reason: 'disabled' }])
  })
})

describe('TTL expiry (805 §8.3, fake clock, no real sleeps)', () => {
  const TTL = 1000

  async function managerAt(entryAge: number) {
    const createdAt = 100_000
    let now = createdAt
    const { manager, events, store } = makeManager({ ttlMs: TTL, now: () => now })
    const fp = 'e'.repeat(64)
    await store.set(fp, entryFor(fp, 'h1{}', createdAt))
    now = createdAt + entryAge
    return { manager, events, fp }
  }

  it('an entry exactly at its TTL edge is still a hit (strict > gate)', async () => {
    const { manager, fp } = await managerAt(TTL)
    expect((await manager.lookup(fp)).outcome).toBe('hit')
  })

  it('an entry one tick past TTL is stale with reason=expired', async () => {
    const { manager, events, fp } = await managerAt(TTL + 1)
    const result = await manager.lookup(fp)
    expect(result).toEqual({ outcome: 'stale', reason: 'expired', ageMs: TTL + 1 })
    expect(events).toEqual([
      { kind: 'miss', fingerprint: fp, reason: 'expired', ageMs: TTL + 1 },
    ])
  })
})

describe('getOrProduce — the fingerprint-gated short-circuit (REQ-301)', () => {
  it('first call produces + stores; second identical call is a hit with ZERO producer calls', async () => {
    const { manager } = makeManager()
    const fp = manager.computeFingerprint(baseInput).hash
    const produce = vi.fn(async () => entryFor(fp))

    const first = await manager.getOrProduce(fp, produce)
    expect(first.outcome).toBe('miss')
    expect(produce).toHaveBeenCalledTimes(1)

    const second = await manager.getOrProduce(fp, produce)
    expect(second.outcome).toBe('hit')
    expect(produce).toHaveBeenCalledTimes(1) // pipeline NOT re-invoked
    expect(second.entry.css).toBe(first.entry.css)
  })

  it('stale entries re-run the producer (treated as miss for control flow)', async () => {
    const createdAt = 50_000
    let now = createdAt
    const { manager, store } = makeManager({ ttlMs: 10, now: () => now })
    const fp = 'd'.repeat(64)
    await store.set(fp, entryFor(fp, 'old{}', createdAt))
    now = createdAt + 11
    const produce = vi.fn(async () => entryFor(fp, 'fresh{}', now))
    const result = await manager.getOrProduce(fp, produce)
    expect(result.outcome).toBe('stale')
    expect(produce).toHaveBeenCalledTimes(1)
    expect(result.entry.css).toBe('fresh{}')
  })
})

describe('explicit invalidation (805 §8.1–8.4)', () => {
  it('invalidate(purgeAll) deletes everything, returns count, emits purged events', async () => {
    const { manager, store, events } = makeManager()
    const fpA = 'a'.repeat(64)
    const fpB = 'b'.repeat(64)
    await store.set(fpA, entryFor(fpA))
    await store.set(fpB, entryFor(fpB))

    const count = await manager.invalidate(purgeAll())
    expect(count).toBe(2)
    expect((await store.stats()).entryCount).toBe(0)
    expect(events.filter((e) => e.kind === 'purged')).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'purged', cause: 'manual' })
  })

  it('a predicate matching zero entries returns 0 and emits nothing', async () => {
    const { manager, events } = makeManager()
    expect(await manager.invalidate(purgeAll())).toBe(0)
    expect(events).toEqual([])
  })

  it('engine-version bump purge is scoped: old-version entries only (rollback safety)', async () => {
    const { manager, store } = makeManager()
    const fpOld = '1'.repeat(64)
    const fpNew = '2'.repeat(64)
    await store.set(
      fpOld,
      createCacheEntry({
        key: fpOld,
        css: 'old{}',
        engineVersion: '0.1.0',
        extractionMode: 'cssom',
        viewportProfileId: 'vp',
      }),
    )
    await store.set(
      fpNew,
      createCacheEntry({
        key: fpNew,
        css: 'new{}',
        engineVersion: '0.2.0',
        extractionMode: 'cssom',
        viewportProfileId: 'vp',
      }),
    )

    const count = await manager.invalidate(purgeByEngineVersion('0.2.0'), 'engine-version-bump')
    expect(count).toBe(1)
    expect(await store.has(fpOld)).toBe(false)
    expect(await store.has(fpNew)).toBe(true)
  })

  it('purgeExpired sweeps only entries older than the TTL', async () => {
    const { manager, store } = makeManager()
    const fpOld = '3'.repeat(64)
    const fpFresh = '4'.repeat(64)
    await store.set(fpOld, entryFor(fpOld, 'a{}', 1000))
    await store.set(fpFresh, entryFor(fpFresh, 'b{}', 9800))
    const count = await manager.invalidate(purgeExpired(500, 10_000), 'ttl-sweep')
    expect(count).toBe(1)
    expect(await store.has(fpFresh)).toBe(true)
  })

  it('purgeByMeta scopes to policy-attached metadata (e.g. route pattern)', async () => {
    const { manager, store } = makeManager()
    const fpBlog = '5'.repeat(64)
    const fpHome = '6'.repeat(64)
    await store.set(
      fpBlog,
      createCacheEntry({
        key: fpBlog,
        css: 'blog{}',
        engineVersion: '0.1.0',
        extractionMode: 'cssom',
        viewportProfileId: 'vp',
        extraMeta: { routePattern: '/blog/*' },
      }),
    )
    await store.set(
      fpHome,
      createCacheEntry({
        key: fpHome,
        css: 'home{}',
        engineVersion: '0.1.0',
        extractionMode: 'cssom',
        viewportProfileId: 'vp',
        extraMeta: { routePattern: '/' },
      }),
    )
    const count = await manager.invalidate(purgeByMeta('routePattern', '/blog/*'))
    expect(count).toBe(1)
    expect(await store.has(fpBlog)).toBe(false)
    expect(await store.has(fpHome)).toBe(true)
  })
})
