/**
 * Unmatched-selector browser view-model (docs/design/1005-Debug-UI.md
 * §8.3.4: "a sortable, filterable table over the unmatched-selector report,
 * grouped by source stylesheet, with a 'why unmatched' hint"). Pure
 * projection of `UnmatchedSelectorReport` — no new classification logic,
 * per 1005 §8.3.4's own constraint ("purely a rendering of existing fields,
 * adding no new classification logic").
 *
 * Gap vs 1005 §8.3.4: the spec's example hints ("matched element but
 * excluded by visibility", "excluded by plugin rule") imply a richer
 * per-selector reason taxonomy. `UnmatchedSelectorRow`
 * (packages/reporter/src/reports.ts) carries none of that — the Reporter
 * builds it as exactly "every source style rule minus matched" (1000 §10.2),
 * with no visibility or plugin provenance attached to the row. The single
 * hint below is therefore the one fact genuinely derivable — no element in
 * this route/viewport's DOM matched the selector — not the richer
 * multi-reason taxonomy 1005 describes. See README "Data model and its gap
 * vs 1004/1005" for the full disclosure.
 */

import type { UnmatchedSelectorRow } from '@critical-css/reporter'
import { groupKeyOf } from './group-key.js'

export interface UnmatchedRuleGroup {
  readonly stylesheetHref: string | null
  readonly rows: readonly (UnmatchedSelectorRow & { readonly hint: string })[]
}

const UNMATCHED_HINT =
  'no element in this route/viewport’s DOM matched this selector (element.matches() returned false for every candidate node) — ' +
  'the Reporter does not attach a finer-grained reason (see README "Data model and its gap vs 1004/1005")'

/** Group by source stylesheet, sorted by href for deterministic rendering (1005 §8.3.4). */
export function buildUnmatchedRuleGroups(rows: readonly UnmatchedSelectorRow[]): UnmatchedRuleGroup[] {
  const byHref = new Map<string, UnmatchedSelectorRow[]>()
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
      rows: groupRows.map((r) => ({ ...r, hint: UNMATCHED_HINT })),
    }))
}

export interface UnmatchedFilter {
  readonly selectorQuery?: string
  readonly stylesheetHref?: string | null
}

/** Free-text selector search + exact stylesheet filter, mirroring run-index.ts's `filterRunIndex`. */
export function filterUnmatchedRows(
  rows: readonly UnmatchedSelectorRow[],
  filter: UnmatchedFilter,
): UnmatchedSelectorRow[] {
  return rows.filter((r) => {
    if (filter.selectorQuery !== undefined && filter.selectorQuery !== '' && !r.selectorText.includes(filter.selectorQuery)) {
      return false
    }
    if (filter.stylesheetHref !== undefined && r.stylesheetHref !== filter.stylesheetHref) return false
    return true
  })
}
