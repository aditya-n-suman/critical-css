/**
 * Route/viewport picker view-model (docs/design/1005-Debug-UI.md §8.3.1,
 * §10.1's `buildRunIndex`). A pure projection of `RunRecord[]` — no I/O.
 *
 * 1005 §10.1 additionally speccs staleness (fingerprint mismatch against
 * current source) and regression flags (vs a baseline build). Both require
 * inputs this app deliberately does not read (801 fingerprinting logic /
 * `apps/cli`'s baseline JSON) — see README "Scope cuts". `RunSummary` omits
 * both fields rather than fabricating them.
 */

import type { RunRecord, RunSummary } from '../types.js'

export function buildRunIndex(runs: readonly RunRecord[]): RunSummary[] {
  return runs.map((run) => ({
    id: run.id,
    route: run.route,
    viewportProfileId: run.viewportProfileId,
    mode: run.mode,
    matchedCount: run.bundle.matchedSelectors.count,
    unmatchedCount: run.bundle.unmatchedSelectors.count,
    totalTimingMs: run.bundle.timing.totalMs,
    dependencyNodeCount: run.bundle.dependencyGraph.nodes.length,
    dependencyEdgeCount: run.bundle.dependencyGraph.edges.length,
  }))
}

export interface RunFilter {
  readonly routeQuery?: string
  readonly viewportProfileId?: string
  readonly mode?: string
}

/** Free-text route search + exact viewport/mode filter, per 1005 §8.3.1. */
export function filterRunIndex(index: readonly RunSummary[], filter: RunFilter): RunSummary[] {
  return index.filter((r) => {
    if (filter.routeQuery !== undefined && filter.routeQuery !== '' && !r.route.includes(filter.routeQuery)) {
      return false
    }
    if (filter.viewportProfileId !== undefined && r.viewportProfileId !== filter.viewportProfileId) return false
    if (filter.mode !== undefined && r.mode !== filter.mode) return false
    return true
  })
}
