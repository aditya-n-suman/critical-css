import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ReportBundle } from '@critical-css/reporter'
import { buildWaterfall, compareWaterfalls } from '../src/viewmodel/waterfall.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function loadBundle(file: string, viewport: string): Promise<ReportBundle> {
  const raw = await readFile(join(FIXTURES, 'reports', file), 'utf8')
  const bundles = JSON.parse(raw) as ReportBundle[]
  const bundle = bundles.find((b) => b.viewportProfileId === viewport)
  if (bundle === undefined) throw new Error(`fixture missing ${viewport} bundle`)
  return bundle
}

describe('buildWaterfall', () => {
  it('builds one row per real stage span, in start-time order', async () => {
    const bundle = await loadBundle('home.css.report.json', 'desktop')
    const wf = buildWaterfall(bundle.extractionTrace.spans)
    const stageSpans = bundle.extractionTrace.spans.filter((s) => s.kind === 'stage')
    expect(wf.rows.length).toBe(stageSpans.length)
    // Every measured `timing.stages` entry has a corresponding waterfall row;
    // the trace may carry one additional cross-viewport "serialize" stage
    // (trace.ts's `withSerializationStage`) not present in this bundle's own
    // `timing.stages` list — see that file's header comment.
    for (const stage of bundle.timing.stages) {
      expect(wf.rows.map((r) => r.name)).toContain(stage.stage)
    }
    for (let i = 1; i < wf.rows.length; i += 1) {
      expect(wf.rows[i]!.startOffsetMs).toBeGreaterThanOrEqual(wf.rows[i - 1]!.startOffsetMs)
    }
  })

  it('totalMs matches the last row\'s end offset', async () => {
    const bundle = await loadBundle('home.css.report.json', 'desktop')
    const wf = buildWaterfall(bundle.extractionTrace.spans)
    const maxEnd = Math.max(...wf.rows.map((r) => r.startOffsetMs + r.durationMs))
    expect(wf.totalMs).toBe(maxEnd)
  })

  it('rolls decision spans up into decisionCount rather than emitting zero-duration rows', async () => {
    const bundle = await loadBundle('home.css.report.json', 'desktop')
    const wf = buildWaterfall(bundle.extractionTrace.spans)
    const matchRow = wf.rows.find((r) => r.name === 'match')
    // matched(7) + unmatched(1) decision spans nest under the match stage span
    expect(matchRow?.decisionCount).toBe(bundle.matchedSelectors.count + bundle.unmatchedSelectors.count)
  })

  it('returns an empty waterfall when there are no stage spans', () => {
    expect(buildWaterfall([])).toEqual({ rows: [], totalMs: 0 })
  })
})

describe('compareWaterfalls', () => {
  it('aligns two runs\' waterfalls by stage name, computing a delta', async () => {
    const a = buildWaterfall((await loadBundle('home.css.report.json', 'desktop')).extractionTrace.spans)
    const b = buildWaterfall((await loadBundle('home.css.report.json', 'mobile')).extractionTrace.spans)
    const cmp = compareWaterfalls(a, b)
    expect(cmp.length).toBeGreaterThan(0)
    for (const row of cmp) {
      if (row.a !== null && row.b !== null) {
        expect(row.deltaMs).toBe(row.b.durationMs - row.a.durationMs)
      } else {
        expect(row.deltaMs).toBeNull()
      }
    }
  })

  it('keeps a stage present in only one run, with a null counterpart', () => {
    const a = { rows: [{ spanId: 's1', name: 'only-a', startOffsetMs: 0, durationMs: 5, decisionCount: 0 }], totalMs: 5 }
    const b = { rows: [], totalMs: 0 }
    const cmp = compareWaterfalls(a, b)
    expect(cmp).toEqual([{ name: 'only-a', a: a.rows[0], b: null, deltaMs: null }])
  })
})
