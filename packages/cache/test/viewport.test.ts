import { describe, expect, it } from 'vitest'

import { CacheManager, MemoryCacheStore, ViewportCache, purgeAll } from '../src/index.js'

const FP_MOBILE = '1a'.repeat(32)
const FP_TABLET = '2b'.repeat(32)
const FP_DESKTOP = '3c'.repeat(32)

function makeCache() {
  const store = new MemoryCacheStore()
  const dangling: string[] = []
  const cache = new ViewportCache({
    store,
    engineVersion: '0.1.0',
    onDanglingKey: (fp) => dangling.push(fp),
  })
  return { store, cache, dangling }
}

const info = (viewportProfileId: string) => ({ extractionMode: 'cssom', viewportProfileId })

describe('per-viewport keying (804 §8.1)', () => {
  it('same route, different viewport = distinct, independently readable entries', async () => {
    const { cache } = makeCache()
    await cache.writePerViewport(FP_MOBILE, '.nav{display:none}', info('vp-mobile'))
    await cache.writePerViewport(FP_DESKTOP, '.nav{display:flex}', info('vp-desktop'))

    expect((await cache.readPerViewport(FP_MOBILE))?.css).toBe('.nav{display:none}')
    expect((await cache.readPerViewport(FP_DESKTOP))?.css).toBe('.nav{display:flex}')
  })

  it('unknown fingerprint reads as null (miss)', async () => {
    const { cache } = makeCache()
    expect(await cache.readPerViewport(FP_MOBILE)).toBeNull()
  })
})

describe('cross-profile output deduplication (804 §8.2, §10.2)', () => {
  it('byte-identical outputs across two profiles share ONE blob', async () => {
    const { cache } = makeCache()
    const css = 'body{margin:0}'
    const a = await cache.writePerViewport(FP_MOBILE, css, info('vp-light'))
    const b = await cache.writePerViewport(FP_TABLET, css, info('vp-dark'))
    expect(a.contentHash).toBe(b.contentHash)

    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(2)
    expect(stats.distinctBlobs).toBe(1)
  })

  it('differing outputs occupy two blobs', async () => {
    const { cache } = makeCache()
    await cache.writePerViewport(FP_MOBILE, 'a{}', info('vp-a'))
    await cache.writePerViewport(FP_TABLET, 'b{}', info('vp-b'))
    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(2)
    expect(stats.distinctBlobs).toBe(2)
  })

  it('deleting one key decrements, not deletes, a shared blob (refcount invariant)', async () => {
    const { cache } = makeCache()
    const css = 'shared{}'
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    await cache.writePerViewport(FP_TABLET, css, info('vp-b'))

    expect(await cache.deletePerViewport(FP_MOBILE)).toBe(true)
    // survivor still reads its CSS through the shared blob
    expect((await cache.readPerViewport(FP_TABLET))?.css).toBe(css)

    expect(await cache.deletePerViewport(FP_TABLET)).toBe(true)
    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(0)
    expect(stats.distinctBlobs).toBe(0) // blob GC'd at refcount zero
  })

  it('idempotent rewrite of the same fingerprint keeps the refcount stable', async () => {
    const { cache } = makeCache()
    const css = 'stable{}'
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    // one delete must fully release the blob
    await cache.deletePerViewport(FP_MOBILE)
    const stats = await cache.dedupStats()
    expect(stats.distinctBlobs).toBe(0)
  })

  it('re-pointing a key to new content releases the old blob', async () => {
    const { cache } = makeCache()
    await cache.writePerViewport(FP_MOBILE, 'old{}', info('vp-a'))
    await cache.writePerViewport(FP_MOBILE, 'new{}', info('vp-a'))
    expect((await cache.readPerViewport(FP_MOBILE))?.css).toBe('new{}')
    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(1)
    expect(stats.distinctBlobs).toBe(1) // old blob released
  })

  it('a dangling key degrades to a miss with a diagnostic, never a throw (804 §12)', async () => {
    const { cache, store, dangling } = makeCache()
    await cache.writePerViewport(FP_MOBILE, 'gone{}', info('vp-a'))
    // Simulate a refcount bug GC'ing the blob while the key survives:
    // delete every stored blob entry directly.
    for (const meta of await store.entries()) {
      if (meta['kind'] === 'blob') await store.delete(meta.key)
    }
    expect(await cache.readPerViewport(FP_MOBILE)).toBeNull()
    expect(dangling).toEqual([FP_MOBILE])
  })

  it('regression (B4): rewriting the same CSS after a lost blob repairs, not re-dangles, the key (804 §12)', async () => {
    const { cache, store } = makeCache()
    const css = 'repair{}'
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    // Simulate the 804 §12 dangling-key scenario: the blob is lost while the
    // index key survives.
    for (const meta of await store.entries()) {
      if (meta['kind'] === 'blob') await store.delete(meta.key)
    }
    expect(await cache.readPerViewport(FP_MOBILE)).toBeNull() // dangling
    // The repair write: same fingerprint, same CSS. The recreated blob must
    // keep refCount >= 1 — a decref here would delete it and permanently
    // re-dangle the index.
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    const read = await cache.readPerViewport(FP_MOBILE)
    expect(read?.css).toBe(css)
    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(1)
    expect(stats.distinctBlobs).toBe(1)
    // And the repaired state still releases cleanly.
    await cache.deletePerViewport(FP_MOBILE)
    expect((await cache.dedupStats()).distinctBlobs).toBe(0)
  })
})

describe('purge routes through the refcount-honoring deleter (S1, 805 §8.2/§10.1/§15)', () => {
  it('invalidate on one per-viewport key decrements — never deletes — a shared blob', async () => {
    const { cache, store } = makeCache()
    const css = 'shared{}'
    await cache.writePerViewport(FP_MOBILE, css, info('vp-a'))
    await cache.writePerViewport(FP_TABLET, css, info('vp-b'))

    const manager = new CacheManager({ store, deleteEntry: cache.entryDeleter() })
    const count = await manager.invalidate((meta) => meta['fingerprint'] === FP_MOBILE)
    expect(count).toBe(1)

    // Refcount arithmetic: the shared blob survives at refCount 1 and the
    // surviving key still reads through it.
    expect((await cache.readPerViewport(FP_TABLET))?.css).toBe(css)
    const blob = (await store.entries()).find((m) => m['kind'] === 'blob')
    expect(blob?.['refCount']).toBe(1)
    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(1)
    expect(stats.distinctBlobs).toBe(1)
  })

  it('purge-all through the deleter releases blobs via refcounts, stranding nothing', async () => {
    const { cache, store } = makeCache()
    await cache.writePerViewport(FP_MOBILE, 'shared{}', info('vp-a'))
    await cache.writePerViewport(FP_TABLET, 'shared{}', info('vp-b'))
    await cache.writePerViewport(FP_DESKTOP, 'solo{}', info('vp-c'))

    const manager = new CacheManager({ store, deleteEntry: cache.entryDeleter() })
    await manager.invalidate(purgeAll())

    const stats = await cache.dedupStats()
    expect(stats.indexKeys).toBe(0)
    expect(stats.distinctBlobs).toBe(0) // no stranded blobs, no stranded indexes
    expect((await store.stats()).entryCount).toBe(0)
  })
})

describe('merged multi-viewport artifact cache (804 §8.3)', () => {
  it('deriveMergeKey is order-independent over the fingerprint set', () => {
    const { cache } = makeCache()
    const k1 = cache.deriveMergeKey([FP_MOBILE, FP_TABLET, FP_DESKTOP], { normalize: true })
    const k2 = cache.deriveMergeKey([FP_DESKTOP, FP_MOBILE, FP_TABLET], { normalize: true })
    expect(k1).toBe(k2)
  })

  it('deriveMergeKey is set-sensitive: adding a profile changes the key', () => {
    const { cache } = makeCache()
    const two = cache.deriveMergeKey([FP_MOBILE, FP_DESKTOP], {})
    const three = cache.deriveMergeKey([FP_MOBILE, FP_TABLET, FP_DESKTOP], {})
    expect(two).not.toBe(three)
  })

  it('deriveMergeKey is merge-config-sensitive', () => {
    const { cache } = makeCache()
    const a = cache.deriveMergeKey([FP_MOBILE], { normalizeMediaQueries: true })
    const b = cache.deriveMergeKey([FP_MOBILE], { normalizeMediaQueries: false })
    expect(a).not.toBe(b)
  })

  it('merge-config key order does not matter (canonical JSON)', () => {
    const { cache } = makeCache()
    const a = cache.deriveMergeKey([FP_MOBILE], { x: 1, y: 2 })
    const b = cache.deriveMergeKey([FP_MOBILE], { y: 2, x: 1 })
    expect(a).toBe(b)
  })

  it('merged artifact round-trips; unknown key misses', async () => {
    const { cache } = makeCache()
    const key = cache.deriveMergeKey([FP_MOBILE, FP_DESKTOP], {})
    expect(await cache.readMerged(key)).toBeNull()
    await cache.writeMerged(key, '@media(min-width:768px){a{}}', info('merged'))
    expect(await cache.readMerged(key)).toBe('@media(min-width:768px){a{}}')
  })
})
