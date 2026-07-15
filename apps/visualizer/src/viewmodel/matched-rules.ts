/**
 * Matched-selector view-model (docs/design/1004-Visualization.md §8.4's
 * companion match table, and the matched-selector half of
 * docs/design/1005-Debug-UI.md §8.3.4's report). Pure projection of
 * `MatchedSelectorReport` — no new classification logic.
 *
 * The unmatched-selector half (1005 §8.3.4's actual "Unmatched-selector
 * browser" view) lives in `./unmatched-selectors.ts`, split out because it
 * carries its own gap disclosure and is a distinct 1005 view; this module
 * feeds the 1004 overlay's match table (`overlay.ts`) instead.
 */

import type { MatchedSelectorRow } from '@critical-css/reporter'
import { groupKeyOf } from './group-key.js'

export interface MatchedRuleGroup {
  readonly stylesheetHref: string | null
  readonly rows: readonly MatchedSelectorRow[]
  readonly totalMatchedNodes: number
}

/** Group by source stylesheet, sorted by href for deterministic rendering. */
export function buildMatchedRuleGroups(rows: readonly MatchedSelectorRow[]): MatchedRuleGroup[] {
  const byHref = new Map<string, MatchedSelectorRow[]>()
  for (const row of rows) {
    const key = groupKeyOf(row.stylesheetHref)
    const list = byHref.get(key) ?? []
    list.push(row)
    byHref.set(key, list)
  }
  return [...byHref.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, groupRows]) => ({
      stylesheetHref: groupRows[0]?.stylesheetHref ?? null,
      rows: groupRows,
      totalMatchedNodes: groupRows.reduce((sum, r) => sum + r.matchedNodeCount, 0),
    }))
}
