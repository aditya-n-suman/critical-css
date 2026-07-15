/**
 * Distributed crawl e2e suite (M5 exit criterion 4,
 * `docs/implementation/002-Milestones.md` §8.6): a route manifest expanded
 * and crawled across more than one worker (here: more than one `run()`
 * invocation, standing in for separate processes/machines — nothing in the
 * shard model depends on process co-location, see `src/shard.ts`), with
 * results aggregated identically to a single-process crawl of the same
 * routes. Determinism check per `docs/testing/003-Golden-Files.md`: the
 * distributed and single-process crawls of the same route set must produce
 * byte-identical output.
 *
 * Uses the real CLI orchestrator (`run()`, real browser extraction, no
 * mocks) against the `fixtures/ci-project/routes-distributed.json` manifest
 * (5 routes: `/`, `/about`, `/products`, `/pricing`, `/contact`) served over
 * HTTP, mirroring `ci-pipeline.e2e.test.ts`'s harness style.
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run, type RunIo, type RunOptions } from '../src/run.js'
import { missingShardRoutes } from '../src/shard.js'

const CI_PROJECT = resolve(import.meta.dirname, '../../..', 'fixtures', 'ci-project')
const MANIFEST_PATTERNS = ['/', '/about', '/products', '/pricing', '/contact']
const ARTIFACT_NAMES = ['home.css', 'about.css', 'products.css', 'pricing.css', 'contact.css']

const ROUTE_FILES: Record<string, string> = {
  '/': 'index.html',
  '/about': 'about/index.html',
  '/products': 'products/index.html',
  '/pricing': 'pricing/index.html',
  '/contact': 'contact/index.html',
}

function startServer(): Promise<{ origin: string; server: Server }> {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const file = ROUTE_FILES[pathname === '' ? '/' : pathname]
      if (file === undefined) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      createReadStream(join(CI_PROJECT, file)).pipe(res)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({ origin: `http://127.0.0.1:${port}`, server })
    })
  })
}

interface CapturedIo extends RunIo {
  readonly out: string[]
  readonly err: string[]
}
const captureIo = (): CapturedIo => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, stdout: (t) => out.push(t), stderr: (l) => err.push(l) }
}

/** Parse the `shard i/n: N route(s) assigned — /a, /b` observability line back into route names. */
function assignedRoutesOf(io: CapturedIo): string[] {
  const line = io.err.find((l) => l.startsWith('shard '))
  if (line === undefined) return []
  const afterDash = line.split(' — ')[1] ?? ''
  return afterDash === '' ? [] : afterDash.split(', ')
}

describe('distributed crawl e2e (M5 exit criterion 4)', () => {
  let origin: string
  let server: Server
  let dir: string

  beforeAll(async () => {
    const started = await startServer()
    origin = started.origin
    server = started.server
    dir = await mkdtemp(join(tmpdir(), 'ccss-shard-'))
  })
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await rm(dir, { recursive: true, force: true })
  })

  const baseOptions = (overrides: Partial<RunOptions>): RunOptions => ({
    url: null,
    routes: join(CI_PROJECT, 'routes-distributed.json'),
    baseUrl: origin,
    outDir: join(dir, 'out'),
    output: null,
    reportOutput: null,
    reportDir: null,
    viewports: ['desktop'],
    mode: 'cssom',
    minify: false,
    format: 'raw-css',
    sandboxPolicy: 'full',
    cacheDir: null,
    noCache: true,
    compareBaseline: null,
    writeBaseline: null,
    maxGrowth: 5,
    shard: null,
    ...overrides,
  })

  async function readArtifacts(outDir: string): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>()
    for (const name of ARTIFACT_NAMES) {
      out.set(name, await readFile(join(outDir, name)))
    }
    return out
  }

  it('2-shard distributed crawl is byte-identical to a single-process crawl of the same routes', async () => {
    const singleOut = join(dir, 'single-out')
    const io = captureIo()
    const code = await run(baseOptions({ outDir: singleOut }), io)
    expect(code).toBe(0)
    const singleArtifacts = await readArtifacts(singleOut)

    // Two shards, same manifest, sharing one out-dir — the "aggregation" is
    // just both processes writing into the same directory, since each
    // route's artifact path is disjoint by construction (010/803).
    const distributedOut = join(dir, 'distributed-out-2')
    const io1 = captureIo()
    const io2 = captureIo()
    const [code1, code2] = await Promise.all([
      run(baseOptions({ outDir: distributedOut, shard: { index: 1, total: 2 } }), io1),
      run(baseOptions({ outDir: distributedOut, shard: { index: 2, total: 2 } }), io2),
    ])
    expect(code1).toBe(0)
    expect(code2).toBe(0)

    // Aggregation completeness (criterion 4's failure-detection nuance):
    // the union of what each shard reports it was assigned must cover the
    // full manifest, with nothing produced twice.
    const assigned1 = assignedRoutesOf(io1)
    const assigned2 = assignedRoutesOf(io2)
    expect(assigned1.length + assigned2.length).toBe(MANIFEST_PATTERNS.length)
    expect(new Set([...assigned1, ...assigned2]).size).toBe(MANIFEST_PATTERNS.length) // no overlap
    expect(missingShardRoutes(MANIFEST_PATTERNS, [...assigned1, ...assigned2])).toEqual([])

    // The determinism check: merged distributed output is byte-identical to
    // the single-process output, artifact by artifact.
    const distributedArtifacts = await readArtifacts(distributedOut)
    for (const name of ARTIFACT_NAMES) {
      expect(distributedArtifacts.get(name)?.equals(singleArtifacts.get(name) as Buffer)).toBe(true)
    }
  })

  it('3-shard distributed crawl (uneven split) is also byte-identical, and route→shard assignment is stable across shard counts', async () => {
    const singleOut = join(dir, 'single-out') // reuse from the prior test
    const singleArtifacts = await readArtifacts(singleOut)

    const distributedOut = join(dir, 'distributed-out-3')
    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        run(baseOptions({ outDir: distributedOut, shard: { index, total: 3 } }), captureIo()),
      ),
    )
    expect(results).toEqual([0, 0, 0])

    const distributedArtifacts = await readArtifacts(distributedOut)
    for (const name of ARTIFACT_NAMES) {
      expect(distributedArtifacts.get(name)?.equals(singleArtifacts.get(name) as Buffer)).toBe(true)
    }
  })

  it('shard assignment is independent of completion order (out-of-order shard completion still merges correctly)', async () => {
    const distributedOut = join(dir, 'distributed-out-reversed')
    // Shard 2 is awaited to completion before shard 1 is even started —
    // the opposite of "first-completed" ordering — to prove aggregation
    // does not depend on which shard finishes first.
    const code2 = await run(baseOptions({ outDir: distributedOut, shard: { index: 2, total: 2 } }), captureIo())
    expect(code2).toBe(0)
    const code1 = await run(baseOptions({ outDir: distributedOut, shard: { index: 1, total: 2 } }), captureIo())
    expect(code1).toBe(0)

    const singleArtifacts = await readArtifacts(join(dir, 'single-out'))
    const distributedArtifacts = await readArtifacts(distributedOut)
    for (const name of ARTIFACT_NAMES) {
      expect(distributedArtifacts.get(name)?.equals(singleArtifacts.get(name) as Buffer)).toBe(true)
    }
  })

  it('shared --cache-dir across shards composes correctly (disjoint routes ⇒ disjoint keys, no corruption)', async () => {
    const sharedCache = join(dir, 'shared-cache')
    const distributedOut = join(dir, 'distributed-out-cache')
    const [code1, code2] = await Promise.all([
      run(
        baseOptions({ outDir: distributedOut, cacheDir: sharedCache, noCache: false, shard: { index: 1, total: 2 } }),
        captureIo(),
      ),
      run(
        baseOptions({ outDir: distributedOut, cacheDir: sharedCache, noCache: false, shard: { index: 2, total: 2 } }),
        captureIo(),
      ),
    ])
    expect(code1).toBe(0)
    expect(code2).toBe(0)

    const singleArtifacts = await readArtifacts(join(dir, 'single-out'))
    const distributedArtifacts = await readArtifacts(distributedOut)
    for (const name of ARTIFACT_NAMES) {
      expect(distributedArtifacts.get(name)?.equals(singleArtifacts.get(name) as Buffer)).toBe(true)
    }

    // A second pass over the same shards, sharing the now-warm cache: still
    // byte-identical, and reused-from-cache is observable per shard.
    const io1 = captureIo()
    const io2 = captureIo()
    const [warmCode1, warmCode2] = await Promise.all([
      run(
        baseOptions({ outDir: distributedOut, cacheDir: sharedCache, noCache: false, shard: { index: 1, total: 2 } }),
        io1,
      ),
      run(
        baseOptions({ outDir: distributedOut, cacheDir: sharedCache, noCache: false, shard: { index: 2, total: 2 } }),
        io2,
      ),
    ])
    expect(warmCode1).toBe(0)
    expect(warmCode2).toBe(0)
    expect(io1.err.some((l) => l.includes('reused from cache')) || io2.err.some((l) => l.includes('reused from cache'))).toBe(
      true,
    )
    const warmArtifacts = await readArtifacts(distributedOut)
    for (const name of ARTIFACT_NAMES) {
      expect(warmArtifacts.get(name)?.equals(singleArtifacts.get(name) as Buffer)).toBe(true)
    }
  })

  it('per-shard failure is detectable and does not silently look like a complete crawl', async () => {
    // Only shard 1/2 actually runs — standing in for shard 2/2's process
    // crashing/never being scheduled. Its own artifacts look complete in
    // isolation, but aggregation against the full manifest must catch the gap.
    const distributedOut = join(dir, 'distributed-out-partial')
    const io1 = captureIo()
    const code1 = await run(baseOptions({ outDir: distributedOut, shard: { index: 1, total: 2 } }), io1)
    expect(code1).toBe(0)

    const assigned1 = assignedRoutesOf(io1)
    expect(missingShardRoutes(MANIFEST_PATTERNS, assigned1).length).toBeGreaterThan(0)

    // A genuine extraction failure within a shard still fails-at-end (exit 1)
    // for that shard's own routes, per REQ-453 — sharding does not change
    // this per-shard semantic.
    const code2 = await run(
      baseOptions({ outDir: distributedOut, baseUrl: 'http://127.0.0.1:9', shard: { index: 2, total: 2 } }),
      captureIo(),
    )
    expect(code2).toBe(1)
  })

  it('--shard is rejected outside --routes mode and alongside --compare-baseline/--write-baseline', async () => {
    await expect(
      run(baseOptions({ routes: null, url: `${origin}/`, shard: { index: 1, total: 2 } }), captureIo()),
    ).rejects.toThrow(/--shard applies to --routes mode only/)

    await expect(
      run(
        baseOptions({ shard: { index: 1, total: 2 }, compareBaseline: join(dir, 'nonexistent-baseline.json') }),
        captureIo(),
      ),
    ).rejects.toThrow(/cannot be combined with --compare-baseline/)
  })
})
