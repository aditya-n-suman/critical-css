/**
 * Batch orchestrator unit tests (BI-11; 800 §10.1; REQ-301/451–453):
 * the extract fn is the browser-launching seam, so a spy on it proves a cache
 * hit never reaches browser acquisition; baseline gate exit codes; --no-cache.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Diagnostic } from '@critical-css/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractOutcome } from '../src/extract.js'
import { InputCollectionError, type CollectedInputs } from '../src/inputs.js'
import { run, type RunIo, type RunOptions } from '../src/run.js'

const outcomeOf = (css: string, diagnostics: readonly Diagnostic[] = []): ExtractOutcome => ({
  output: css,
  css,
  diagnostics,
  reports: [],
  stats: { mode: 'cssom', viewports: ['desktop'], matchedRules: 1, mergedRules: 1, dependencies: 0 },
})

const fakeInputs = async (): Promise<CollectedInputs> => ({
  htmlContent: '<html><body>fixed</body></html>',
  cssAssets: [{ url: 'https://example.com/a.css', contentHash: 'a'.repeat(64) }],
})

interface CapturedIo extends RunIo {
  readonly out: string[]
  readonly err: string[]
}

const captureIo = (): CapturedIo => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, stdout: (text) => out.push(text), stderr: (line) => err.push(line) }
}

describe('run()', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-run-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const options = (overrides: Partial<RunOptions> = {}): RunOptions => ({
    url: 'https://example.com/',
    routes: null,
    baseUrl: null,
    outDir: '.',
    output: join(dir, 'out.css'),
    reportOutput: null,
    viewports: ['desktop'],
    mode: 'cssom',
    minify: false,
    format: 'raw-css',
    sandboxPolicy: 'full',
    cacheDir: null,
    noCache: false,
    compareBaseline: null,
    writeBaseline: null,
    maxGrowth: 5,
    ...overrides,
  })

  it('cache hit skips the extract fn entirely — the browser is never acquired (REQ-301)', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{color:red}\n'))
    const opts = options({ cacheDir: join(dir, 'cache') })
    const deps = { extractFn, collectInputs: fakeInputs }

    expect(await run(opts, captureIo(), deps)).toBe(0)
    expect(extractFn).toHaveBeenCalledTimes(1)

    const io = captureIo()
    expect(await run(opts, io, deps)).toBe(0)
    expect(extractFn).toHaveBeenCalledTimes(1) // NOT called again: provable hit
    expect(await readFile(join(dir, 'out.css'), 'utf8')).toBe('.a{color:red}\n')
    expect(io.err.some((l) => l.includes('1 reused from cache, 0 freshly extracted'))).toBe(true)
  })

  it('a changed fingerprint input misses the cache and re-extracts', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n'))
    const opts = options({ cacheDir: join(dir, 'cache') })
    await run(opts, captureIo(), { extractFn, collectInputs: fakeInputs })
    const changedInputs = async (): Promise<CollectedInputs> => ({
      htmlContent: '<html><body>CHANGED</body></html>',
      cssAssets: [],
    })
    await run(opts, captureIo(), { extractFn, collectInputs: changedInputs })
    expect(extractFn).toHaveBeenCalledTimes(2)
  })

  it('--no-cache forces every lookup to miss while staying observable (800 §12)', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n'))
    const opts = options({ cacheDir: join(dir, 'cache'), noCache: true })
    const deps = { extractFn, collectInputs: fakeInputs }
    await run(opts, captureIo(), deps)
    const io = captureIo()
    await run(opts, io, deps)
    expect(extractFn).toHaveBeenCalledTimes(2)
    expect(io.err.some((l) => l.includes('cache disabled by --no-cache'))).toBe(true)
  })

  it('an unreadable fingerprint input fails CLOSED to a fresh, uncached extraction', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n'))
    const throwingInputs = async (): Promise<CollectedInputs> => {
      throw new InputCollectionError('could not fetch page (HTTP 503)')
    }
    const io = captureIo()
    expect(
      await run(options({ cacheDir: join(dir, 'cache') }), io, { extractFn, collectInputs: throwingInputs }),
    ).toBe(0)
    expect(extractFn).toHaveBeenCalledTimes(1)
    expect(io.err.some((l) => l.includes('CACHE_FINGERPRINT_UNAVAILABLE'))).toBe(true)
  })

  it('baseline gate: passes at threshold, fails over it with exit 3', async () => {
    const css = '.a{color:red}\n' // 14 bytes
    const extractFn = vi.fn(async () => outcomeOf(css))
    const baselinePath = join(dir, 'baseline.json')

    await writeFile(baselinePath, JSON.stringify({ 'https://example.com/': 14 }), 'utf8')
    expect(await run(options({ compareBaseline: baselinePath }), captureIo(), { extractFn, collectInputs: fakeInputs })).toBe(0)

    // 13 * 1.05 = 13.65 < 14 → strictly over the threshold → gate fails.
    await writeFile(baselinePath, JSON.stringify({ 'https://example.com/': 13 }), 'utf8')
    const io = captureIo()
    expect(await run(options({ compareBaseline: baselinePath }), io, { extractFn, collectInputs: fakeInputs })).toBe(3)
    expect(io.err.some((l) => l.includes('baseline: FAILED'))).toBe(true)
  })

  it('baseline gate: new and removed routes warn without failing', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n'))
    const baselinePath = join(dir, 'baseline.json')
    await writeFile(baselinePath, JSON.stringify({ 'https://old.example.com/': 100 }), 'utf8')
    const io = captureIo()
    expect(await run(options({ compareBaseline: baselinePath }), io, { extractFn, collectInputs: fakeInputs })).toBe(0)
    expect(io.err.some((l) => l.includes('has no baseline entry'))).toBe(true)
    expect(io.err.some((l) => l.includes('is in the baseline but was not produced'))).toBe(true)
  })

  it('baseline gate: missing dependencies fail the build (BRIEF §2.11)', async () => {
    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'MISSING_KEYFRAMES',
      message: 'animation references undeclared @keyframes',
    }
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n', [diagnostic]))
    const baselinePath = join(dir, 'baseline.json')
    await writeFile(baselinePath, JSON.stringify({ 'https://example.com/': 6 }), 'utf8')
    expect(await run(options({ compareBaseline: baselinePath }), captureIo(), { extractFn, collectInputs: fakeInputs })).toBe(3)
  })

  it('§2.11 gate is not defeated by cache warmth: a hit replays persisted MISSING_* diagnostics and still exits 3 (G7 #2)', async () => {
    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'MISSING_KEYFRAMES',
      message: 'animation references undeclared @keyframes',
    }
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n', [diagnostic]))
    const baselinePath = join(dir, 'baseline.json')
    await writeFile(baselinePath, JSON.stringify({ 'https://example.com/': 6 }), 'utf8')
    const opts = options({ cacheDir: join(dir, 'cache'), compareBaseline: baselinePath })
    const deps = { extractFn, collectInputs: fakeInputs }

    // Miss run: fresh extraction sees the diagnostic → gate fails.
    expect(await run(opts, captureIo(), deps)).toBe(3)
    expect(extractFn).toHaveBeenCalledTimes(1)

    // Identical HIT run: no browser, but the persisted diagnostic is replayed
    // and the gate must fail identically.
    const io = captureIo()
    expect(await run(opts, io, deps)).toBe(3)
    expect(extractFn).toHaveBeenCalledTimes(1) // provable hit
    expect(io.err.some((l) => l.includes('MISSING_KEYFRAMES'))).toBe(true)
    expect(io.err.some((l) => l.includes('baseline: FAILED'))).toBe(true)
  })

  it('a gate-failing run never overwrites its own baseline (G7 #3)', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{color:red}\n')) // 14 bytes
    const baselinePath = join(dir, 'baseline.json')
    // 10 → 14 bytes = +40% growth, over the 5% threshold.
    const original = JSON.stringify({ 'https://example.com/': 10 }, null, 2) + '\n'
    await writeFile(baselinePath, original, 'utf8')
    const io = captureIo()
    expect(
      await run(options({ compareBaseline: baselinePath, writeBaseline: baselinePath }), io, {
        extractFn,
        collectInputs: fakeInputs,
      }),
    ).toBe(3)
    // Byte-unchanged baseline + an explicit skip note on stderr.
    expect(await readFile(baselinePath, 'utf8')).toBe(original)
    expect(io.err.some((l) => l.includes('baseline: not written') && l.includes('refusing to overwrite'))).toBe(true)
  })

  it('--report on a cache hit rewrites the persisted report bundles without a browser (G7 #4)', async () => {
    const marker = [{ route: 'marker-bundle' }] as unknown as ExtractOutcome['reports']
    const extractFn = vi.fn(async () => ({ ...outcomeOf('.a{}\n'), reports: marker }))
    const reportPath = join(dir, 'report.json')
    const opts = options({ cacheDir: join(dir, 'cache'), reportOutput: reportPath })
    const deps = { extractFn, collectInputs: fakeInputs }

    expect(await run(opts, captureIo(), deps)).toBe(0)
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual([{ route: 'marker-bundle' }])

    await rm(reportPath)
    expect(await run(opts, captureIo(), deps)).toBe(0)
    expect(extractFn).toHaveBeenCalledTimes(1) // hit — no browser
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual([{ route: 'marker-bundle' }])
  })

  it('--report on a hit against an entry written WITHOUT --report warns loudly instead of writing nothing silently (G7 #4)', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{}\n'))
    const cacheDir = join(dir, 'cache')
    const deps = { extractFn, collectInputs: fakeInputs }
    // Warm the cache without --report: no bundles are persisted.
    expect(await run(options({ cacheDir }), captureIo(), deps)).toBe(0)

    const reportPath = join(dir, 'report.json')
    const io = captureIo()
    expect(await run(options({ cacheDir, reportOutput: reportPath }), io, deps)).toBe(0)
    expect(extractFn).toHaveBeenCalledTimes(1) // hit
    await expect(readFile(reportPath, 'utf8')).rejects.toThrow() // nothing written…
    expect(io.err.some((l) => l.includes('REPORT_UNAVAILABLE_ON_CACHE_HIT'))).toBe(true) // …but loudly
  })

  it('extraction errors take precedence over gate failures (exit 1), and no partial baseline is written', async () => {
    const extractFn = vi.fn(async () => {
      throw new Error('boom')
    })
    const baselinePath = join(dir, 'baseline.json')
    await writeFile(baselinePath, JSON.stringify({ 'https://example.com/': 1 }), 'utf8')
    const writePath = join(dir, 'new-baseline.json')
    const io = captureIo()
    expect(
      await run(options({ compareBaseline: baselinePath, writeBaseline: writePath }), io, {
        extractFn,
        collectInputs: fakeInputs,
      }),
    ).toBe(1)
    await expect(readFile(writePath, 'utf8')).rejects.toThrow()
    expect(io.err.some((l) => l.includes('extraction failed for https://example.com/'))).toBe(true)
  })

  it('--write-baseline records produced sizes keyed by route/URL', async () => {
    const extractFn = vi.fn(async () => outcomeOf('.a{color:red}\n'))
    const writePath = join(dir, 'baseline.json')
    expect(await run(options({ writeBaseline: writePath }), captureIo(), { extractFn, collectInputs: fakeInputs })).toBe(0)
    expect(JSON.parse(await readFile(writePath, 'utf8'))).toEqual({ 'https://example.com/': 14 })
  })

  it('route manifest mode: every unit is attempted; failures collected after the batch (REQ-453)', async () => {
    const manifestPath = join(dir, 'routes.json')
    await writeFile(manifestPath, JSON.stringify({ '/fails': 'fails.css', '/works': 'works.css' }), 'utf8')
    const extractFn = vi.fn(async (request: { url: string }) => {
      if (request.url.endsWith('/fails')) throw new Error('boom')
      return outcomeOf('.b{}\n')
    })
    const io = captureIo()
    const code = await run(
      options({ url: null, output: null, routes: manifestPath, baseUrl: 'https://example.com', outDir: join(dir, 'out') }),
      io,
      { extractFn, collectInputs: fakeInputs },
    )
    expect(code).toBe(1)
    expect(extractFn).toHaveBeenCalledTimes(2) // the batch continued past the failure
    expect(await readFile(join(dir, 'out', 'works.css'), 'utf8')).toBe('.b{}\n')
  })
})
