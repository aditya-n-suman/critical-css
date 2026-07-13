/**
 * @critical-css/reporter — public API barrel (AT-10, M3 subset: the four
 * required reports + dependency-graph JSON). Extraction trace / HTML overlay
 * / Debug UI (1003–1005) are M5.
 */

export { Reporter } from './reports.js'
export type {
  ReportInput,
  ReportBundle,
  MatchedSelectorReport,
  MatchedSelectorRow,
  UnmatchedSelectorReport,
  UnmatchedSelectorRow,
  TimingReport,
  StylesheetContributionReport,
  StylesheetContributionRow,
  DependencyGraphReport,
} from './reports.js'
