/**
 * @critical-css/coverage — public API barrel (AT-05).
 *
 * Depends ONLY on @critical-css/browser + @critical-css/shared. MUST NEVER
 * import @critical-css/matcher or @critical-css/collector (ADR-0005 /
 * design principle 4) — the Hybrid composer in @critical-css/dependency-graph
 * is the single sanctioned point that composes coverage + matcher output.
 */

export { CoverageCollector, sheetKeyFor } from './coverage-mode.js'
export type { CoverageResult } from './coverage-mode.js'
