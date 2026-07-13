import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CACHE_ENTRY_FORMAT_VERSION,
  DiskCacheStore,
  MemoryCacheStore,
  RemoteCacheStore,
  TieredCacheStore,
  createCacheEntry,
  type CacheEntry,
  type CacheStore,
  type RemoteCacheClient,
} from '../src/index.js'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

function entryFor(key: string, css = 'body{color:red}'): CacheEntry {
  return createCacheEntry({
    key,
    css,
    engineVersion: '0.1.0',
    extractionMode: 'cssom',
    viewportProfileId: 'vp-desktop',
  })
}

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ccss-cache-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

function storeContractTests(name: string, makeStore: () => Promise<CacheStore>): void {
  describe(`${name} contract`, () => {
    it('round-trips set/get/has/delete', async () => {
      const store = await makeStore()
      const entry = entryFor(KEY_A)
      expect(await store.get(KEY_A)).toBeNull()
      expect(await store.has(KEY_A)).toBe(false)

      await store.set(KEY_A, entry)
      expect(await store.has(KEY_A)).toBe(true)
      const got = await store.get(KEY_A)
      expect(got?.css).toBe(entry.css)
      expect(got?.key).toBe(KEY_A)
      expect(got?.checksum).toBe(entry.checksum)

      expect(await store.delete(KEY_A)).toBe(true)
      expect(await store.delete(KEY_A)).toBe(false)
      expect(await store.get(KEY_A)).toBeNull()
    })

    it('set is idempotent', async () => {
      const store = await makeStore()
      const entry = entryFor(KEY_A)
      await store.set(KEY_A, entry)
      await store.set(KEY_A, entry)
      const stats = await store.stats()
      expect(stats.entryCount).toBe(1)
      expect((await store.get(KEY_A))?.css).toBe(entry.css)
    })

    it('clear removes all entries', async () => {
      const store = await makeStore()
      await store.set(KEY_A, entryFor(KEY_A))
      await store.set(KEY_B, entryFor(KEY_B, 'p{margin:0}'))
      await store.clear()
      expect(await store.get(KEY_A)).toBeNull()
      expect(await store.get(KEY_B)).toBeNull()
      expect((await store.stats()).entryCount).toBe(0)
    })

    it('entries() enumerates metadata summaries with keys', async () => {
      const store = await makeStore()
      await store.set(KEY_A, entryFor(KEY_A))
      await store.set(KEY_B, entryFor(KEY_B))
      const summaries = await store.entries()
      expect(summaries.map((s) => s.key).sort()).toEqual([KEY_A, KEY_B])
      expect(summaries[0]?.engineVersion).toBe('0.1.0')
    })

    it('empty-CSS entry is a legitimate entry, not a miss sentinel', async () => {
      const store = await makeStore()
      await store.set(KEY_A, entryFor(KEY_A, ''))
      const got = await store.get(KEY_A)
      expect(got).not.toBeNull()
      expect(got?.css).toBe('')
    })
  })
}

storeContractTests('MemoryCacheStore', async () => new MemoryCacheStore())
storeContractTests('DiskCacheStore', async () => new DiskCacheStore(await tempDir()))

describe('MemoryCacheStore LRU eviction', () => {
  it('evicts least-recently-used entries beyond maxEntries', async () => {
    const store = new MemoryCacheStore({ maxEntries: 2 })
    const keyC = 'c'.repeat(64)
    await store.set(KEY_A, entryFor(KEY_A))
    await store.set(KEY_B, entryFor(KEY_B))
    await store.get(KEY_A) // touch A so B is LRU
    await store.set(keyC, entryFor(keyC))
    expect(await store.has(KEY_A)).toBe(true)
    expect(await store.has(KEY_B)).toBe(false) // evicted
    expect(await store.has(keyC)).toBe(true)
  })

  it('evicts by maxBytes', async () => {
    const bigCss = 'x'.repeat(1000)
    const store = new MemoryCacheStore({ maxBytes: 1500 })
    await store.set(KEY_A, entryFor(KEY_A, bigCss))
    await store.set(KEY_B, entryFor(KEY_B, bigCss))
    expect(await store.has(KEY_A)).toBe(false)
    expect(await store.has(KEY_B)).toBe(true)
  })
})

describe('DiskCacheStore persistence and integrity', () => {
  it('entries survive a new store instance pointed at the same dir', async () => {
    const dir = await tempDir()
    const first = new DiskCacheStore(dir)
    await first.set(KEY_A, entryFor(KEY_A))

    const second = new DiskCacheStore(dir)
    const got = await second.get(KEY_A)
    expect(got?.css).toBe('body{color:red}')
  })

  it('atomic writes leave no temp files and no partial reads', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    // Concurrent identical-fingerprint writes converge to one valid entry.
    await Promise.all(
      Array.from({ length: 10 }, () => store.set(KEY_A, entryFor(KEY_A))),
    )
    const shardDir = join(dir, 'entries', KEY_A.slice(0, 2))
    const files = await readdir(shardDir)
    expect(files).toEqual([`${KEY_A}.entry.json`])
    const got = await store.get(KEY_A)
    expect(got?.css).toBe('body{color:red}')
  })

  it('a corrupted entry is a miss and is evicted, never a wrong hit', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    await store.set(KEY_A, entryFor(KEY_A))
    const path = join(dir, 'entries', KEY_A.slice(0, 2), `${KEY_A}.entry.json`)
    const raw = await readFile(path, 'utf8')
    await writeFile(path, raw.replace('color:red', 'color:BAD'), 'utf8')

    expect(await store.get(KEY_A)).toBeNull()
    // best-effort eviction of the corrupt file
    const files = await readdir(join(dir, 'entries', KEY_A.slice(0, 2)))
    expect(files).toEqual([])
  })

  it('unparseable JSON on disk is a miss', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    await store.set(KEY_A, entryFor(KEY_A))
    const path = join(dir, 'entries', KEY_A.slice(0, 2), `${KEY_A}.entry.json`)
    await writeFile(path, '{not json', 'utf8')
    expect(await store.get(KEY_A)).toBeNull()
  })

  it('formatVersion drift is a miss', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    const entry = entryFor(KEY_A)
    const drifted = { ...entry, formatVersion: CACHE_ENTRY_FORMAT_VERSION + 1 }
    const path = join(dir, 'entries', KEY_A.slice(0, 2), `${KEY_A}.entry.json`)
    await store.set(KEY_A, entry)
    await writeFile(path, JSON.stringify(drifted), 'utf8')
    expect(await store.get(KEY_A)).toBeNull()
  })

  it('rejects non-hex keys instead of touching the filesystem', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    expect(await store.get('../../../etc/passwd')).toBeNull()
    expect(await store.has('../escape')).toBe(false)
    expect(await store.delete('..')).toBe(false)
  })

  it('rejects keys that are not exactly 64 lowercase hex chars (801 §11)', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir)
    expect(await store.get('a'.repeat(16))).toBeNull() // legacy 16-hex: no longer a producer
    expect(await store.get('A'.repeat(64))).toBeNull() // uppercase rejected
    expect(await store.has('a'.repeat(63))).toBe(false)
  })

  it('regression (S2): a failed set is a logged no-op — diagnostic emitted, no temp litter, no throw', async () => {
    const dir = await tempDir()
    // Occupy the entries path with a FILE so mkdir/write must fail.
    await writeFile(join(dir, 'entries'), 'not a directory', 'utf8')
    const diagnostics: string[] = []
    const store = new DiskCacheStore(dir, { onDiagnostic: (message) => diagnostics.push(message) })
    await expect(store.set(KEY_A, entryFor(KEY_A))).resolves.toBeUndefined()
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toContain(KEY_A)
    expect(await store.get(KEY_A)).toBeNull() // next read is a miss
  })
})

describe('DiskCacheStore LRU eviction + persisted index (802 §8.3/§8.5, S3)', () => {
  it('evicts least-recently-used entries beyond maxEntries', async () => {
    const dir = await tempDir()
    const store = new DiskCacheStore(dir, { maxEntries: 2 })
    const keyC = 'c'.repeat(64)
    await store.set(KEY_A, entryFor(KEY_A))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.set(KEY_B, entryFor(KEY_B))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.get(KEY_A) // touch A so B is LRU
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.set(keyC, entryFor(keyC))
    expect(await store.has(KEY_A)).toBe(true)
    expect(await store.has(KEY_B)).toBe(false) // evicted from disk
    expect(await store.has(keyC)).toBe(true)
  })

  it('evicts by maxBytes', async () => {
    const dir = await tempDir()
    const bigCss = 'x'.repeat(1000)
    const store = new DiskCacheStore(dir, { maxBytes: 1500 })
    await store.set(KEY_A, entryFor(KEY_A, bigCss))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.set(KEY_B, entryFor(KEY_B, bigCss))
    expect(await store.has(KEY_A)).toBe(false)
    expect(await store.has(KEY_B)).toBe(true)
  })

  it('declares honest capabilities: persistent, shared, evicting', async () => {
    const store = new DiskCacheStore(await tempDir())
    expect(store.capabilities).toEqual({
      persistent: true,
      sharedAcrossProcesses: true,
      evicts: true,
    })
  })

  it('warm start: index.json is written and read by a new instance', async () => {
    const dir = await tempDir()
    const first = new DiskCacheStore(dir)
    await first.set(KEY_A, entryFor(KEY_A))
    const raw = await readFile(join(dir, 'index.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version: number; entries: Record<string, unknown> }
    expect(parsed.version).toBe(1)
    expect(Object.keys(parsed.entries)).toEqual([KEY_A])

    const second = new DiskCacheStore(dir, { maxEntries: 1 })
    // The warm-started index drives eviction accounting immediately.
    await second.set(KEY_B, entryFor(KEY_B))
    expect(await second.has(KEY_B)).toBe(true)
    expect(await second.has(KEY_A)).toBe(false) // evicted using warm-start LRU data
  })

  it('lastAccessedAt and hitCount survive a new store instance', async () => {
    const dir = await tempDir()
    const first = new DiskCacheStore(dir)
    await first.set(KEY_A, entryFor(KEY_A))
    const written = await first.get(KEY_A)
    const bumpedAt = written?.meta.lastAccessedAt
    expect(written?.meta.hitCount).toBe(1)

    const second = new DiskCacheStore(dir)
    const summaries = await second.entries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.hitCount).toBe(1) // persisted, not dropped
    expect(summaries[0]?.lastAccessedAt).toBe(bumpedAt)

    const reread = await second.get(KEY_A)
    expect(reread?.meta.hitCount).toBe(2) // accumulates across instances
  })

  it('a missing index.json degrades gracefully: accounting rebuilt by scan', async () => {
    const dir = await tempDir()
    const first = new DiskCacheStore(dir)
    await first.set(KEY_A, entryFor(KEY_A))
    await rm(join(dir, 'index.json'))
    const second = new DiskCacheStore(dir)
    expect((await second.entries()).map((m) => m.key)).toEqual([KEY_A])
    expect((await second.get(KEY_A))?.css).toBe('body{color:red}')
  })
})

describe('TieredCacheStore', () => {
  it('probes tiers in order and back-fills faster tiers on a slow hit', async () => {
    const fast = new MemoryCacheStore()
    const slow = new MemoryCacheStore()
    const tiered = new TieredCacheStore([fast, slow])
    await slow.set(KEY_A, entryFor(KEY_A))

    const got = await tiered.get(KEY_A)
    expect(got?.css).toBe('body{color:red}')
    expect(await fast.has(KEY_A)).toBe(true) // back-filled
  })

  it('writes through to all tiers and fans out deletes', async () => {
    const fast = new MemoryCacheStore()
    const slow = new MemoryCacheStore()
    const tiered = new TieredCacheStore([fast, slow])
    await tiered.set(KEY_A, entryFor(KEY_A))
    expect(await fast.has(KEY_A)).toBe(true)
    expect(await slow.has(KEY_A)).toBe(true)
    expect(await tiered.delete(KEY_A)).toBe(true)
    expect(await fast.has(KEY_A)).toBe(false)
    expect(await slow.has(KEY_A)).toBe(false)
  })
})

describe('RemoteCacheStore (806 hook)', () => {
  function fakeClient(map: Map<string, string>, failing = false): RemoteCacheClient {
    return {
      async get(key) {
        if (failing) throw new Error('network timeout')
        return map.get(key) ?? null
      },
      async put(key, value) {
        if (failing) throw new Error('network timeout')
        map.set(key, value)
      },
      async has(key) {
        if (failing) throw new Error('network timeout')
        return map.has(key)
      },
      async delete(key) {
        if (failing) throw new Error('network timeout')
        map.delete(key)
      },
      async list() {
        return [...map.keys()]
      },
    }
  }

  it('round-trips through a fake remote client', async () => {
    const store = new RemoteCacheStore(fakeClient(new Map()))
    await store.set(KEY_A, entryFor(KEY_A))
    expect((await store.get(KEY_A))?.css).toBe('body{color:red}')
  })

  it('every remote fault degrades to a soft miss, never an error', async () => {
    const store = new RemoteCacheStore(fakeClient(new Map(), true))
    expect(await store.get(KEY_A)).toBeNull()
    expect(await store.has(KEY_A)).toBe(false)
    await expect(store.set(KEY_A, entryFor(KEY_A))).resolves.toBeUndefined()
    expect(await store.delete(KEY_A)).toBe(false)
  })
})
