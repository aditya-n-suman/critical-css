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
