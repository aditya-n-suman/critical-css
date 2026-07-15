/**
 * CLI end-to-end + golden-file suite (M1 exit criteria 1/3/4/5).
 *
 * Golden files live in fixtures/golden/ (AGENT_IMPL_BRIEF §Phase M1) and are
 * compared byte-exactly — no whitespace or line-ending normalization
 * (docs/testing/003-Golden-Files.md).
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../src/index.js'

const ROOT = resolve(import.meta.dirname, '../../..')
const fixtureUrl = (name: string): string =>
  pathToFileURL(resolve(ROOT, 'fixtures', name, 'index.html')).href
const goldenPath = (name: string): string => resolve(ROOT, 'fixtures', 'golden', `${name}.css`)

describe('extract() end-to-end', () => {
  it('emits valid, non-empty CSS for the static fixture', async () => {
    const outcome = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    expect(outcome.css).toContain('.hero {')
    expect(outcome.css).toContain('.hero h1 {')
    // Below-fold-only and display:none-only selectors: .footer styles the
    // below-fold footer — it must not be extracted.
    expect(outcome.css).not.toContain('.footer')
    expect(outcome.stats.matchedRules).toBeGreaterThan(0)
  })

  it('is byte-deterministic across two runs (REQ-250/REQ-500)', async () => {
    const first = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    const second = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    expect(first.css).toBe(second.css)
  })

  it('extracts mobile-only rules under the mobile viewport, wrapped in their @media', async () => {
    const outcome = await extract({ url: fixtureUrl('mobile'), viewport: 'mobile' })
    expect(outcome.css).toContain('@media (max-width: 600px) {')
    expect(outcome.css).toContain('.mobile-menu-button {')
  })

  it('includes the async fixture element that appears post-load (stabilization)', async () => {
    const outcome = await extract({ url: fixtureUrl('async'), viewport: 'desktop' })
    expect(outcome.css).toContain('.late {')
  })
})

describe('golden baseline (byte-exact, M1 exit criterion 5)', () => {
  const CASES = [
    { fixture: 'static', viewport: 'desktop' },
    { fixture: 'async', viewport: 'desktop' },
    { fixture: 'mobile', viewport: 'mobile' },
  ] as const

  for (const { fixture, viewport } of CASES) {
    it(`golden::${fixture}::${viewport} matches byte-for-byte`, async () => {
      const golden = await readFile(goldenPath(fixture), 'utf8')
      const outcome = await extract({ url: fixtureUrl(fixture), viewport })
      expect(outcome.css).toBe(golden)
    })
  }
})

describe('extraction trace (M5 A1/A3 regression)', () => {
  it('two different routes at the same viewport get distinct runId/traceId/run-span spanId (A1)', async () => {
    const staticOutcome = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    const mobileOutcome = await extract({ url: fixtureUrl('mobile'), viewport: 'desktop' })

    const staticRunSpan = staticOutcome.reports[0]?.extractionTrace.spans.find((s) => s.kind === 'run')
    const mobileRunSpan = mobileOutcome.reports[0]?.extractionTrace.spans.find((s) => s.kind === 'run')
    expect(staticRunSpan).toBeDefined()
    expect(mobileRunSpan).toBeDefined()

    // Before the A1 fix, runId was derived from the viewport profile name
    // only (`run-desktop`) — identical for both fixtures here despite being
    // different routes, which collapsed traceId and the run-span spanId too.
    expect(staticRunSpan!.runId).not.toBe(mobileRunSpan!.runId)
    expect(staticRunSpan!.traceId).not.toBe(mobileRunSpan!.traceId)
    expect(staticRunSpan!.spanId).not.toBe(mobileRunSpan!.spanId)
  })

  it('every span in a built ExtractionTraceReport has a defined endTime >= startTime (A3)', async () => {
    const outcome = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    for (const report of outcome.reports) {
      for (const span of report.extractionTrace.spans) {
        expect(span.endTime).toBeDefined()
        expect(span.endTime as number).toBeGreaterThanOrEqual(span.startTime)
      }
    }
  })
})
