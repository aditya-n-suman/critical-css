/**
 * @critical-css/reporter — public API barrel (AT-10). M3 shipped four
 * required reports + dependency-graph JSON; M5 (docs/design/1003-Tracing.md)
 * adds the extraction trace, the sixth and final §2.12 diagnostic. HTML
 * overlay / Debug UI (1004–1005) remain out of scope for this package.
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
export { buildExtractionTrace, withSerializationStage } from './trace.js'
export type {
  ExtractionTraceReport,
  ExtractionTraceInput,
  Span,
  SpanEvent,
  SpanKind,
  SpanStatus,
} from './trace.js'
