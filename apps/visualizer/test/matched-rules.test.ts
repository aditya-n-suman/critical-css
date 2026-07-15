import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ReportBundle } from '@critical-css/reporter'
import { buildMatchedRuleGroups } from '../src/viewmodel/matched-rules.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function loadHomeDesktop(): Promise<ReportBundle> {
  const raw = await readFile(join(FIXTURES, 'reports', 'home.css.report.json'), 'utf8')
  const bundles = JSON.parse(raw) as ReportBundle[]
  const bundle = bundles.find((b) => b.viewportProfileId === 'desktop')
  if (bundle === undefined) throw new Error('fixture missing desktop bundle')
  return bundle
}

describe('buildMatchedRuleGroups', () => {
  it('groups matched selector rows by stylesheet, inline rules under the " inline" key', async () => {
    const bundle = await loadHomeDesktop()
    const groups = buildMatchedRuleGroups(bundle.matchedSelectors.rows)
    expect(groups.length).toBe(1)
    expect(groups[0]?.stylesheetHref).toBeNull()
    expect(groups[0]?.rows.length).toBe(7)
  })

  it('sums matchedNodeCount into totalMatchedNodes per group', async () => {
    const bundle = await loadHomeDesktop()
    const groups = buildMatchedRuleGroups(bundle.matchedSelectors.rows)
    const expectedTotal = bundle.matchedSelectors.rows.reduce((sum, r) => sum + r.matchedNodeCount, 0)
    expect(groups[0]?.totalMatchedNodes).toBe(expectedTotal)
  })

  it('is a pure function: same input produces byte-identical output', async () => {
    const bundle = await loadHomeDesktop()
    const a = buildMatchedRuleGroups(bundle.matchedSelectors.rows)
    const b = buildMatchedRuleGroups(bundle.matchedSelectors.rows)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('returns no groups for an empty row list', () => {
    expect(buildMatchedRuleGroups([])).toEqual([])
  })
})
