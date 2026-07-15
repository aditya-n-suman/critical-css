import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadReportDir } from '../src/adapters/report-store.js'
import { buildRunIndex, filterRunIndex } from '../src/viewmodel/run-index.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

describe('buildRunIndex / filterRunIndex', () => {
  it('projects RunRecord[] into RunSummary[] with counts drawn from the real bundle', async () => {
    const { runs } = await loadReportDir(join(FIXTURES, 'reports'))
    const index = buildRunIndex(runs)
    expect(index.length).toBe(runs.length)
    const home = index.find((r) => r.route.endsWith('/') && r.viewportProfileId === 'desktop')
    expect(home).toBeDefined()
    expect(home?.matchedCount).toBe(7)
    expect(home?.unmatchedCount).toBe(1)
    expect(home?.dependencyNodeCount).toBe(7)
    expect(home?.dependencyEdgeCount).toBe(0)
    expect(home?.totalTimingMs).toBeGreaterThan(0)
  })

  it('filters by free-text route substring', async () => {
    const { runs } = await loadReportDir(join(FIXTURES, 'reports'))
    const index = buildRunIndex(runs)
    const filtered = filterRunIndex(index, { routeQuery: 'about' })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((r) => r.route.includes('about'))).toBe(true)
  })

  it('filters by exact viewport and mode', async () => {
    const { runs } = await loadReportDir(join(FIXTURES, 'reports'))
    const index = buildRunIndex(runs)
    const filtered = filterRunIndex(index, { viewportProfileId: 'mobile', mode: 'cssom' })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((r) => r.viewportProfileId === 'mobile' && r.mode === 'cssom')).toBe(true)
  })

  it('returns an empty list when no run matches the filter', async () => {
    const { runs } = await loadReportDir(join(FIXTURES, 'reports'))
    const index = buildRunIndex(runs)
    expect(filterRunIndex(index, { viewportProfileId: 'nonexistent-viewport' })).toEqual([])
  })
})
