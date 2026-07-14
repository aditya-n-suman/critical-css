/**
 * Multi-route CI-pipeline end-to-end suite (M4 exit criterion 2).
 *
 * Runs the full BRIEF §2.11 sequence — Build → Crawl routes → Generate
 * critical CSS → Compare against baseline → Publish artifacts → Upload
 * reports — via the real CLI orchestrator (`run()` with the real browser
 * extraction, no mocks) against the multi-route `fixtures/ci-project/`
 * project served over HTTP, and independently verifies each of the three
 * brief-named fail conditions produces a distinct non-zero exit + diagnostic:
 *   (1) CSS growth beyond --max-growth  → exit 3 (byte-size gate)
 *   (2) a missing dependency detected   → exit 3 (§2.11 gate) + MISSING_* diag
 *   (3) an extraction error             → exit 1 (unreachable route)
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run, type RunIo, type RunOptions } from '../src/run.js'

const CI_PROJECT = resolve(import.meta.dirname, '../../..', 'fixtures', 'ci-project')

const ROUTE_FILES: Record<string, string> = {
  '/': 'index.html',
  '/about': 'about/index.html',
  '/products': 'products/index.html',
  '/missing-dep': 'missing-dep/index.html',
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

describe('multi-route CI pipeline e2e (M4 exit criterion 2)', () => {
  let origin: string
  let server: Server
  let dir: string

  beforeAll(async () => {
    const started = await startServer()
    origin = started.origin
    server = started.server
  })
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  const baseOptions = (overrides: Partial<RunOptions>): RunOptions => ({
    url: null,
    routes: join(CI_PROJECT, 'routes.json'),
    baseUrl: origin,
    outDir: join(dir, 'out'),
    output: null,
    reportOutput: null,
    reportDir: join(dir, 'out'),
    viewports: ['desktop'],
    mode: 'cssom',
    minify: false,
    format: 'raw-css',
    sandboxPolicy: 'full',
    cacheDir: join(dir, 'cache'),
    noCache: false,
    compareBaseline: null,
    writeBaseline: null,
    maxGrowth: 5,
    ...overrides,
  })

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-ci-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('full §2.11 sequence against the multi-route project: artifacts + reports published, baseline gate ok (exit 0)', async () => {
    const baselinePath = join(dir, 'baseline.json')

    // Build → Crawl → Generate → Publish artifacts → Upload reports, and
    // record the baseline (first pass, no gate yet).
    const io1 = captureIo()
    const write = await run(baseOptions({ writeBaseline: baselinePath }), io1)
    expect(write).toBe(0)

    // All three route artifacts published under --out-dir.
    for (const css of ['home.css', 'about.css', 'products.css']) {
      const text = await readFile(join(dir, 'out', css), 'utf8')
      expect(text.length).toBeGreaterThan(0)
    }
    // Reports uploaded next to each artifact.
    for (const report of ['home.css.report.json', 'about.css.report.json', 'products.css.report.json']) {
      const parsed = JSON.parse(await readFile(join(dir, 'out', report), 'utf8'))
      expect(Array.isArray(parsed)).toBe(true)
    }
    // Cache hit/miss observable (crit-4).
    expect(io1.err.some((l) => l.includes('freshly extracted'))).toBe(true)

    // Second pass: Compare against baseline → gate passes (exit 0).
    const io2 = captureIo()
    const compare = await run(baseOptions({ compareBaseline: baselinePath }), io2)
    expect(compare).toBe(0)
    expect(io2.err.some((l) => l.includes('baseline: ok'))).toBe(true)
    // Cache warmth is observable on the second pass.
    expect(io2.err.some((l) => l.includes('reused from cache'))).toBe(true)
  })

  it('fail condition 1 — CSS growth beyond --max-growth → exit 3', async () => {
    // A baseline that under-reports every route's size forces growth past 5%.
    const baselinePath = join(dir, 'tiny-baseline.json')
    await writeFile(baselinePath, JSON.stringify({ '/': 1, '/about': 1, '/products': 1 }), 'utf8')
    const io = captureIo()
    const code = await run(baseOptions({ compareBaseline: baselinePath, noCache: true }), io)
    expect(code).toBe(3)
    expect(io.err.some((l) => l.includes('grew') && l.includes('limit 5%'))).toBe(true)
    expect(io.err.some((l) => l.includes('baseline: FAILED'))).toBe(true)
  })

  it('fail condition 2 — a missing dependency detected → exit 3 with a MISSING_* diagnostic', async () => {
    // Generous baseline sizes so growth cannot be the cause; the /missing-dep
    // route references an undeclared @keyframes → MISSING_KEYFRAMES fails §2.11.
    const baselinePath = join(dir, 'md-baseline.json')
    await writeFile(baselinePath, JSON.stringify({ '/': 100000, '/missing-dep': 100000 }), 'utf8')
    const io = captureIo()
    const code = await run(
      baseOptions({
        routes: join(CI_PROJECT, 'routes-missing-dep.json'),
        compareBaseline: baselinePath,
        noCache: true,
      }),
      io,
    )
    expect(code).toBe(3)
    expect(io.err.some((l) => l.includes('MISSING_KEYFRAMES'))).toBe(true)
    expect(io.err.some((l) => l.includes('has missing dependencies'))).toBe(true)
    expect(io.err.some((l) => l.includes('baseline: FAILED'))).toBe(true)
    // Growth was NOT the cause (isolates this fail condition).
    expect(io.err.some((l) => l.includes('grew'))).toBe(false)
  })

  it('fail condition 3 — an extraction error (unreachable route) → exit 1', async () => {
    const io = captureIo()
    // Point the crawl at a closed port: every route navigation fails.
    const code = await run(baseOptions({ baseUrl: 'http://127.0.0.1:9', noCache: true }), io)
    expect(code).toBe(1)
    expect(io.err.some((l) => l.includes('extraction failed for'))).toBe(true)
  })
})
