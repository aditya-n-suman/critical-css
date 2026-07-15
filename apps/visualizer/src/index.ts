/**
 * `@critical-css/visualizer` public barrel (AGENT_IMPL_BRIEF.md §5.4 — public
 * API surface only; internal helpers such as `viewmodel/group-key.ts` are not
 * re-exported).
 */

export type { RunRecord, RunSummary } from './types.js'

export { loadReportDir } from './adapters/report-store.js'
export type { LoadReportDirResult } from './adapters/report-store.js'

export { buildRunIndex, filterRunIndex } from './viewmodel/run-index.js'
export type { RunFilter } from './viewmodel/run-index.js'

export { buildMatchedRuleGroups } from './viewmodel/matched-rules.js'
export type { MatchedRuleGroup } from './viewmodel/matched-rules.js'

export { buildUnmatchedRuleGroups, filterUnmatchedRows } from './viewmodel/unmatched-selectors.js'
export type { UnmatchedRuleGroup, UnmatchedFilter } from './viewmodel/unmatched-selectors.js'

export { layoutDependencyGraph } from './viewmodel/dependency-graph.js'
export type { GraphNodePosition, LayoutResult } from './viewmodel/dependency-graph.js'

export { buildCriticalHtml } from './viewmodel/side-by-side.js'
export type { CriticalHtmlResult } from './viewmodel/side-by-side.js'

export { buildWaterfall, compareWaterfalls } from './viewmodel/waterfall.js'
export type { WaterfallRow, WaterfallViewModel, WaterfallComparisonRow } from './viewmodel/waterfall.js'

export { buildOverlayHtml } from './overlay.js'
export type { OverlayOptions } from './overlay.js'
