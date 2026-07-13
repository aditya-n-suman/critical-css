/**
 * M3 end-to-end (exit criteria 1–4): multi-viewport merge, coverage mode,
 * hybrid mode, and reporter — against real Chromium fixtures.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../src/index.js'

const ROOT = resolve(import.meta.dirname, '../../..')
const fixtureUrl = (name: string): string => pathToFileURL(resolve(ROOT, 'fixtures', name, 'index.html')).href
const goldenPath = (name: string): string => resolve(ROOT, 'fixtures', 'golden', `${name}.css`)

describe('M3: multi-viewport merge (exit criterion 1)', () => {
  it('runs desktop + mobile independently and merges', async () => {
    const outcome = await extract({ url: fixtureUrl('mobile'), viewports: ['desktop', 'mobile'] })
    expect(outcome.stats.viewports).toEqual(['desktop', 'mobile'])
    // desktop-nav is visible on desktop; mobile-menu-button only on mobile.
    expect(outcome.css).toContain('.desktop-nav')
    expect(outcome.css).toContain('.mobile-menu-button')
    // Two independent per-viewport reports were produced.
    expect(outcome.reports).toHaveLength(2)
  })

  it('single-viewport output is unchanged vs the committed golden (merge is identity for V=1)', async () => {
    const golden = await readFile(goldenPath('static'), 'utf8')
    const outcome = await extract({ url: fixtureUrl('static'), viewport: 'desktop' })
    expect(outcome.css).toBe(golden)
  })
})

describe('M3: coverage mode (exit criterion 2)', () => {
  it('coverage-only selects painted rules, drops unmatched selectors', async () => {
    const outcome = await extract({ url: fixtureUrl('coverage'), viewport: 'desktop', mode: 'coverage' })
    expect(outcome.stats.mode).toBe('coverage')
    expect(outcome.css).toContain('.used')
    expect(outcome.css).toContain('.also-used')
    // .never-used has no matching element → not painted → excluded.
    expect(outcome.css).not.toContain('.never-used')
  })
})

describe('M3: hybrid mode (exit criterion 3)', () => {
  it('composes CSSOM + coverage, keeps every above-fold match (fidelity bias), emits reconciliation diagnostic', async () => {
    const outcome = await extract({ url: fixtureUrl('coverage'), viewport: 'desktop', mode: 'hybrid' })
    expect(outcome.stats.mode).toBe('hybrid')
    expect(outcome.css).toContain('.used')
    expect(outcome.diagnostics.some((d) => d.code === 'HYBRID_RECONCILED')).toBe(true)
    // Below-fold .below is coverage-used but not above-fold-matched → not output.
    expect(outcome.css).not.toContain('.below')
  })
})

describe('M3: reporter (exit criterion 4)', () => {
  it('emits matched/unmatched/timing/contribution + dependency-graph reports', async () => {
    const outcome = await extract({ url: fixtureUrl('deps'), viewport: 'desktop' })
    const report = outcome.reports[0]
    expect(report).toBeDefined()
    expect(report?.matchedSelectors.count).toBeGreaterThan(0)
    expect(report?.unmatchedSelectors.count).toBeGreaterThan(0) // below-fold + no-match rules
    expect(report?.timing.stages.map((s) => s.stage)).toContain('collect')
    expect(report?.timing.totalMs).toBeGreaterThanOrEqual(0)
    expect(report?.stylesheetContribution.stylesheets.length).toBeGreaterThan(0)
    // deps fixture pulls in @keyframes/@font-face/@property/@counter-style deps.
    expect(report?.dependencyGraph.nodes.length).toBeGreaterThan(0)
  })
})
