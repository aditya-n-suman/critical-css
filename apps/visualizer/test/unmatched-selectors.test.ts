import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ReportBundle } from '@critical-css/reporter'
import { buildUnmatchedRuleGroups, filterUnmatchedRows } from '../src/viewmodel/unmatched-selectors.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function loadAboutDesktop(): Promise<ReportBundle> {
  const raw = await readFile(join(FIXTURES, 'reports', 'about.css.report.json'), 'utf8')
  const bundles = JSON.parse(raw) as ReportBundle[]
  const bundle = bundles.find((b) => b.viewportProfileId === 'desktop')
  if (bundle === undefined) throw new Error('fixture missing desktop bundle')
  return bundle
}

describe('buildUnmatchedRuleGroups', () => {
  it('groups unmatched rows and attaches the disclosed hint verbatim', async () => {
    const bundle = await loadAboutDesktop()
    const groups = buildUnmatchedRuleGroups(bundle.unmatchedSelectors.rows)
    expect(groups.length).toBe(1)
    expect(groups[0]?.rows.length).toBe(bundle.unmatchedSelectors.count)
    for (const row of groups[0]?.rows ?? []) {
      expect(row.hint).toContain('no element')
      expect(row.hint).toContain('README')
    }
  })

  it('preserves original row fields alongside the hint', async () => {
    const bundle = await loadAboutDesktop()
    const groups = buildUnmatchedRuleGroups(bundle.unmatchedSelectors.rows)
    const row = groups[0]?.rows[0]
    const original = bundle.unmatchedSelectors.rows[0]
    expect(row?.selectorText).toBe(original?.selectorText)
    expect(row?.stylesheetHref).toBe(original?.stylesheetHref)
    expect(row?.ruleIndexPath).toEqual(original?.ruleIndexPath)
  })

  it('returns no groups for an empty row list', () => {
    expect(buildUnmatchedRuleGroups([])).toEqual([])
  })
})

describe('filterUnmatchedRows', () => {
  it('filters by selector-text substring', async () => {
    const bundle = await loadAboutDesktop()
    const filtered = filterUnmatchedRows(bundle.unmatchedSelectors.rows, { selectorQuery: 'footer' })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((r) => r.selectorText.includes('footer'))).toBe(true)
  })

  it('filters by exact stylesheetHref', async () => {
    const bundle = await loadAboutDesktop()
    const filtered = filterUnmatchedRows(bundle.unmatchedSelectors.rows, { stylesheetHref: null })
    expect(filtered.every((r) => r.stylesheetHref === null)).toBe(true)
  })

  it('returns an empty array when no row matches', async () => {
    const bundle = await loadAboutDesktop()
    expect(filterUnmatchedRows(bundle.unmatchedSelectors.rows, { selectorQuery: 'does-not-exist' })).toEqual([])
  })
})
