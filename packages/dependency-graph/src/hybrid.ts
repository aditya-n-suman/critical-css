/**
 * Hybrid strategy composer (docs/design/701-Hybrid-Mode.md, BI-06.4).
 *
 * The SINGLE sanctioned point that composes CSSOM matcher output with
 * Coverage output — neither `packages/matcher` nor `packages/coverage` knows
 * about the other (ADR-0005). Structured set algebra, not global union:
 *   strongInclude      = matched ∩ coverageUsed      (both agree)
 *   provisionalInclude = matched \ coverageUsed       (CSSOM-matched, kept — fidelity bias)
 *   provisionalExclude = coverageUsed \ matched       (below-fold; deps only, not output)
 * Output rules = strongInclude ∪ provisionalInclude = every CSSOM match
 * (missing a rule causes FOUC; an extra rule costs only bytes — §2.18).
 */

import type { CssomRuleList, RuleNode } from '@critical-css/collector'
import type { CoverageResult } from '@critical-css/coverage'
import type { MatchedRuleSet } from '@critical-css/matcher'
import { sheetKeyFor } from '@critical-css/coverage'
import type { Diagnostic } from '@critical-css/shared'

export interface HybridReconciliation {
  readonly strongInclude: readonly string[]
  readonly provisionalInclude: readonly string[]
  readonly provisionalExclude: readonly string[]
  /** Coverage-used-but-unmatched rules — fed to the resolver for dependency
   *  completeness only, never emitted as output rules (701 §8.3). */
  readonly provisionalExcludeRules: readonly RuleNode[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Build the coverage-key ↔ rule maps from the CSSOM rule list (the walker's
 *  document-order style-rule ordinal, matching CoverageCollector's scheme). */
function buildKeyMaps(cssom: CssomRuleList): {
  keyByRule: Map<string, string>
  ruleByKey: Map<string, RuleNode>
} {
  const keyByRule = new Map<string, string>()
  const ruleByKey = new Map<string, RuleNode>()
  for (const sheet of cssom.stylesheets) {
    const sheetKey = sheetKeyFor(sheet.href, sheet.sourceStylesheetIndex)
    let ordinal = 0
    for (const rule of sheet.rules) {
      if (rule.ruleType !== 'style') continue
      const coverageKey = `${sheetKey}:${ordinal}`
      const ruleId = `${sheet.sourceStylesheetIndex}:${rule.ruleIndexPath.join('.')}`
      keyByRule.set(ruleId, coverageKey)
      ruleByKey.set(coverageKey, rule)
      ordinal += 1
    }
  }
  return { keyByRule, ruleByKey }
}

/**
 * Coverage-only rule selection (ADR-0005 CSSOM-free strategy): the style
 * rules whose coverage key was used. Page-wide / fold-blind by design.
 */
export function coverageOnlyRules(coverage: CoverageResult, cssom: CssomRuleList): RuleNode[] {
  const { ruleByKey } = buildKeyMaps(cssom)
  const rules: RuleNode[] = []
  for (const key of [...coverage.usedRuleKeys].sort()) {
    const rule = ruleByKey.get(key)
    if (rule !== undefined) rules.push(rule)
  }
  return rules
}

export function reconcileHybrid(
  matched: MatchedRuleSet,
  coverage: CoverageResult,
  cssom: CssomRuleList,
): HybridReconciliation {
  const { keyByRule, ruleByKey } = buildKeyMaps(cssom)

  const matchedKeys = new Set<string>()
  for (const m of matched.matches) {
    const key = keyByRule.get(`${m.stylesheetIndex}:${m.ruleIndexPath.join('.')}`)
    if (key !== undefined) matchedKeys.add(key)
  }
  const used = coverage.usedRuleKeys

  const strongInclude: string[] = []
  const provisionalInclude: string[] = []
  for (const key of matchedKeys) {
    if (used.has(key)) strongInclude.push(key)
    else provisionalInclude.push(key)
  }
  const provisionalExclude: string[] = []
  const provisionalExcludeRules: RuleNode[] = []
  for (const key of used) {
    if (!matchedKeys.has(key)) {
      provisionalExclude.push(key)
      const rule = ruleByKey.get(key)
      if (rule !== undefined) provisionalExcludeRules.push(rule)
    }
  }

  // Deterministic ordering before emitting (701 IN-7).
  strongInclude.sort()
  provisionalInclude.sort()
  provisionalExclude.sort()
  provisionalExcludeRules.sort((a, b) =>
    a.ruleIndexPath.join('.') < b.ruleIndexPath.join('.') ? -1 : 1,
  )

  const diagnostics: Diagnostic[] = [
    {
      severity: 'info',
      code: 'HYBRID_RECONCILED',
      message: `hybrid: ${strongInclude.length} strong-include, ${provisionalInclude.length} provisional-include (kept, fidelity bias), ${provisionalExclude.length} provisional-exclude (below-fold, deps only)`,
      context: {
        strongInclude: strongInclude.length,
        provisionalInclude: provisionalInclude.length,
        provisionalExclude: provisionalExclude.length,
      },
    },
  ]

  return { strongInclude, provisionalInclude, provisionalExclude, provisionalExcludeRules, diagnostics }
}
