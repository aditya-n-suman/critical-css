import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadReportDir } from '../src/adapters/report-store.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

describe('loadReportDir', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-visualizer-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('flattens each report file\'s ReportBundle[] into one RunRecord per viewport', async () => {
    const { runs, skipped } = await loadReportDir(join(FIXTURES, 'reports'))
    expect(skipped).toEqual([])
    // home.css.report.json + about.css.report.json, each with desktop+mobile
    expect(runs.length).toBe(4)
    const homeDesktop = runs.find((r) => r.route.endsWith('/') && r.viewportProfileId === 'desktop')
    expect(homeDesktop).toBeDefined()
    expect(homeDesktop?.bundle.matchedSelectors.count).toBe(7)
    expect(homeDesktop?.mode).toBe('cssom')
  })

  it('produces deterministic, sorted run ordering', async () => {
    const first = await loadReportDir(join(FIXTURES, 'reports'))
    const second = await loadReportDir(join(FIXTURES, 'reports'))
    expect(first.runs.map((r) => r.id)).toEqual(second.runs.map((r) => r.id))
    const sorted = [...first.runs.map((r) => r.id)].sort()
    expect(first.runs.map((r) => r.id)).toEqual(sorted)
  })

  it('skips malformed report files rather than throwing, and surfaces them', async () => {
    const { runs, skipped } = await loadReportDir(join(FIXTURES, 'malformed'))
    expect(runs).toEqual([])
    expect(skipped.length).toBe(2)
    expect(skipped.some((s) => s.reason.includes('invalid JSON'))).toBe(true)
    expect(skipped.some((s) => s.reason.includes('not a ReportBundle[]'))).toBe(true)
  })

  it('recursively walks nested directories', async () => {
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(
      join(dir, 'nested', 'x.report.json'),
      JSON.stringify([{ route: '/x', viewportProfileId: 'desktop', mode: 'cssom' }]),
    )
    const { runs } = await loadReportDir(dir)
    expect(runs.length).toBe(1)
    expect(runs[0]?.route).toBe('/x')
  })

  it('returns an empty result for a report-dir with no report files', async () => {
    const { runs, skipped } = await loadReportDir(dir)
    expect(runs).toEqual([])
    expect(skipped).toEqual([])
  })
})
