/**
 * CSSOM rule-tree DTOs, per docs/design/300-CSSOM-Walker.md §10.1 and
 * docs/design/302-Rule-Tree.md (M1 envelope: contexts captured verbatim,
 * not yet evaluated — 303/304/305 semantics land in M2).
 */

export type StylesheetOrigin = 'link' | 'style' | 'import' | 'constructable'

export type RuleType =
  | 'style'
  | 'media'
  | 'supports'
  | 'layer-block'
  | 'layer-statement'
  | 'import'
  | 'font-face'
  | 'keyframes'
  | 'page'
  | 'property'
  | 'container'
  | 'counter-style'
  | 'unknown'

export interface RuleNode {
  /** Sequential counter scoped to one stylesheet's walk (302). */
  readonly ruleId: number
  readonly parentRuleId: number | null
  readonly childRuleIds: readonly number[]
  readonly sourceStylesheetIndex: number
  /** Position within the immediate parent CSSRuleList. */
  readonly sourceRuleIndex: number
  /** Full index path from the stylesheet root — the rule identity (1000 §10.2). */
  readonly ruleIndexPath: readonly number[]
  readonly ruleType: RuleType
  /** Verbatim browser-reported selector; comma lists kept as one string. `null` for non-style rules. */
  readonly selectorText: string | null
  /** Verbatim `CSSStyleDeclaration.cssText` (style/font-face/…); opaque, never re-parsed. */
  readonly declarationText: string
  /**
   * Grouping condition, verbatim: `mediaText` for @media, `conditionText`
   * for @supports/@container, layer name(s) for @layer.
   */
  readonly conditionText: string | null
  /**
   * Browser-evaluated condition activity at capture time:
   * `matchMedia().matches` for @media, `CSS.supports()` for @supports
   * (303/304). `null` for rules without an evaluable condition.
   */
  readonly conditionActive: boolean | null
  /** Full raw cssText fallback, retained for `unknown` rules. */
  readonly rawCssText: string | null
}

export interface CollectorDiagnosticRecord {
  readonly code: string
  readonly message: string
  readonly href: string | null
}

export interface StylesheetRecord {
  readonly sourceStylesheetIndex: number
  readonly origin: StylesheetOrigin
  readonly href: string | null
  readonly disabled: boolean
  readonly accessible: boolean
  readonly rules: readonly RuleNode[]
  readonly diagnostics: readonly CollectorDiagnosticRecord[]
}

export interface CssomRuleList {
  /** Correlation key shared with the DomSnapshot from the same navigation (016 §8.4). */
  readonly snapshotId: string
  readonly stylesheets: readonly StylesheetRecord[]
  /** Walk-level diagnostics not attributable to a single stylesheet. */
  readonly diagnostics: readonly CollectorDiagnosticRecord[]
}
