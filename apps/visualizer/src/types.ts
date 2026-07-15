/**
 * apps/visualizer's own view-facing types (docs/design/1005-Debug-UI.md §8.4).
 *
 * These are NOT new upstream data — every field here is derived from
 * `@critical-css/reporter`'s `ReportBundle` (see README "Data model and its
 * gap vs 1004/1005" for the one documented exception: 1004/1005 assume a
 * `DiagnosticsBundle` carrying a `DomSnapshot`, per-node
 * `VisibilityAnnotation`s, and a `foldY` scalar. `packages/reporter`'s actual
 * `ReportBundle` (src/reports.ts) carries none of those — no DOM snapshot, no
 * visibility classification, no fold line. This file's types reflect what is
 * GENUINELY available, not the aspirational 1004/1005 shape.
 */

import type { ReportBundle } from '@critical-css/reporter'

/** One (route, viewport, mode) run, as discovered from a report-dir scan. */
export interface RunRecord {
  readonly id: string
  readonly reportFilePath: string
  readonly route: string
  readonly viewportProfileId: string
  readonly mode: ReportBundle['mode']
  readonly bundle: ReportBundle
}

/** 1005 §8.3.1 — Route/viewport picker row. */
export interface RunSummary {
  readonly id: string
  readonly route: string
  readonly viewportProfileId: string
  readonly mode: ReportBundle['mode']
  readonly matchedCount: number
  readonly unmatchedCount: number
  readonly totalTimingMs: number
  readonly dependencyNodeCount: number
  readonly dependencyEdgeCount: number
}
