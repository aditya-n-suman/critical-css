/**
 * @critical-css/collector — public API barrel (AT-03, M1 slice:
 * DOM Collector + CSSOM Walker; Visibility Engine lands in M2).
 */

export { CssomWalker } from './cssom-walker/cssom-walker.js'
export type {
  CssomRuleList,
  StylesheetRecord,
  RuleNode,
  RuleType,
  StylesheetOrigin,
  CollectorDiagnosticRecord,
} from './cssom-walker/types.js'
export { DomCollector } from './dom-collector/dom-collector.js'
export type { CollectedDom } from './dom-collector/dom-collector.js'
export { collect, nextSnapshotId } from './collect.js'
export type { CollectionResult } from './collect.js'
