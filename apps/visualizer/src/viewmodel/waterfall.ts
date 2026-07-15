/**
 * Timing waterfall view-model (docs/design/1005-Debug-UI.md §8.3.5). Pure
 * projection of `ExtractionTraceReport.spans` (packages/reporter/src/trace.ts)
 * into Gantt-style rows — no timing computation of its own.
 *
 * Renders `stage` spans as the primary bars (one row per pipeline stage, per
 * 1005 §8.3.5) and rolls `decision` spans up into a per-stage count
 * annotation, since decision spans are zero-duration (trace.ts) and would be
 * invisible as their own Gantt bars.
 */

import type { Span } from '@critical-css/reporter'

export interface WaterfallRow {
  readonly spanId: string
  readonly name: string
  readonly startOffsetMs: number
  readonly durationMs: number
  readonly decisionCount: number
}

export interface WaterfallViewModel {
  readonly rows: readonly WaterfallRow[]
  readonly totalMs: number
}

/** Builds one waterfall from a single work-unit's flat span list (trace.ts's `Span[]`). */
export function buildWaterfall(spans: readonly Span[]): WaterfallViewModel {
  const stageSpans = spans.filter((s) => s.kind === 'stage')
  if (stageSpans.length === 0) return { rows: [], totalMs: 0 }

  const origin = Math.min(...stageSpans.map((s) => s.startTime))
  const decisionCountByParent = new Map<string, number>()
  for (const s of spans) {
    if (s.kind !== 'decision' || s.parentSpanId === undefined) continue
    decisionCountByParent.set(s.parentSpanId, (decisionCountByParent.get(s.parentSpanId) ?? 0) + 1)
  }

  const rows: WaterfallRow[] = stageSpans
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map((s) => ({
      spanId: s.spanId,
      name: s.name,
      startOffsetMs: s.startTime - origin,
      durationMs: (s.endTime ?? s.startTime) - s.startTime,
      decisionCount: decisionCountByParent.get(s.spanId) ?? 0,
    }))

  const totalMs = Math.max(...rows.map((r) => r.startOffsetMs + r.durationMs))
  return { rows, totalMs }
}

/**
 * Aligns two runs' waterfalls on a shared time axis for side-by-side
 * comparison (1005 §8.3.5's "comparing two runs' waterfalls side by side").
 * Rows are matched by stage `name`; a stage present in only one run gets a
 * `null` counterpart rather than being dropped.
 */
export interface WaterfallComparisonRow {
  readonly name: string
  readonly a: WaterfallRow | null
  readonly b: WaterfallRow | null
  readonly deltaMs: number | null
}

export function compareWaterfalls(a: WaterfallViewModel, b: WaterfallViewModel): WaterfallComparisonRow[] {
  const names = [...new Set([...a.rows.map((r) => r.name), ...b.rows.map((r) => r.name)])].sort()
  return names.map((name) => {
    const rowA = a.rows.find((r) => r.name === name) ?? null
    const rowB = b.rows.find((r) => r.name === name) ?? null
    return {
      name,
      a: rowA,
      b: rowB,
      deltaMs: rowA !== null && rowB !== null ? rowB.durationMs - rowA.durationMs : null,
    }
  })
}
