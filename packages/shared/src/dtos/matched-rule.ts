/**
 * MatchedRule DTO, per docs/architecture/003-Requirements.md (Extraction Core)
 * and the canonical-ordering algorithm in docs/architecture/006-Design-Principles.md.
 *
 * Rule identity is `(stylesheetUrl, rule index path)` where the path includes
 * the full at-rule nesting chain (docs/design/1000-Diagnostics-Overview.md §10.2).
 */

export type CascadeOrigin = 'user-agent' | 'user' | 'author'

/** Specificity triple (a = ids, b = classes/attributes/pseudo-classes, c = types). */
export interface Specificity {
  readonly a: number
  readonly b: number
  readonly c: number
}

export interface MatchedRule {
  /** Full serialized rule text as reported by the browser CSSOM (`cssText`). */
  readonly cssText: string
  /** Browser-resolved selector text. */
  readonly selectorText: string
  readonly specificity: Specificity
  /** Owning stylesheet URL; `null` for inline `<style>` / constructable sheets. */
  readonly stylesheetUrl: string | null
  /** Position of the owning stylesheet in document order (browser-reported). */
  readonly sourceStylesheetIndex: number
  /**
   * Rule index path within the stylesheet — the full at-rule nesting chain
   * (e.g. `[3, 0]` = first rule inside the fourth top-level `@media` block),
   * never a flat index.
   */
  readonly sourceRuleIndex: readonly number[]
  readonly origin: CascadeOrigin
  /**
   * Enclosing at-rule conditions, outermost first
   * (e.g. `["@media (min-width: 600px)", "@supports (display: grid)"]`).
   */
  readonly atRuleChain: readonly string[]
}
