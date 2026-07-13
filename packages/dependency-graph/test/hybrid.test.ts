/**
 * Hybrid composer unit tests (701, BI-06.4): pure set-algebra reconciliation,
 * no browser. Verifies the strongInclude/provisionalInclude/provisionalExclude
 * classification and the fidelity bias (every CSSOM match survives).
 */

import { describe, expect, it } from 'vitest'
import type { CssomRuleList, RuleNode } from '@critical-css/collector'
import type { CoverageResult } from '@critical-css/coverage'
import type { MatchedRuleSet } from '@critical-css/matcher'
import { coverageOnlyRules, reconcileHybrid } from '../src/index.js'

let ruleIdCounter = 0
function styleRule(selector: string, path: number[]): RuleNode {
  return {
    ruleId: ruleIdCounter++,
    parentRuleId: null,
    childRuleIds: [],
    sourceStylesheetIndex: 0,
    sourceRuleIndex: path[0] ?? 0,
    ruleIndexPath: path,
    ruleType: 'style',
    selectorText: selector,
    declarationText: 'color: red;',
    conditionText: null,
    conditionActive: null,
    rawCssText: null,
  }
}

/** Inline sheet (href null) → sheetKey `inline#0`; style-rule ordinals 0..n. */
function cssom(rules: RuleNode[]): CssomRuleList {
  return {
    snapshotId: 's',
    diagnostics: [],
    stylesheets: [
      { sourceStylesheetIndex: 0, origin: 'style', href: null, disabled: false, accessible: true, rules, diagnostics: [] },
    ],
  }
}

function matchedSet(rules: RuleNode[]): MatchedRuleSet {
  return {
    snapshotId: 's',
    viewportProfileId: 'desktop',
    strategy: 'cssom',
    diagnostics: [],
    matches: rules.map((r) => ({
      stylesheetIndex: 0,
      ruleIndexPath: r.ruleIndexPath,
      selectorText: r.selectorText ?? '',
      matchedSelectorBranches: [r.selectorText ?? ''],
      matchedNodeIds: [1],
      declarationText: r.declarationText,
      atRuleChain: [],
    })),
  }
}

function coverage(used: string[], unused: string[] = []): CoverageResult {
  return { usedRuleKeys: new Set(used), unusedRuleKeys: new Set(unused), diagnostics: [] }
}

describe('reconcileHybrid (701 set algebra)', () => {
  it('classifies strong / provisional-include / provisional-exclude', () => {
    ruleIdCounter = 0
    const a = styleRule('.a', [0]) // matched + used → strong
    const b = styleRule('.b', [1]) // matched, coverage silent → provisional-include
    const c = styleRule('.c', [2]) // below-fold: coverage-used, not matched → provisional-exclude
    const tree = cssom([a, b, c])
    // Ordinals: .a=inline#0:0, .b=inline#0:1, .c=inline#0:2
    const result = reconcileHybrid(matchedSet([a, b]), coverage(['inline#0:0', 'inline#0:2']), tree)
    expect(result.strongInclude).toEqual(['inline#0:0'])
    expect(result.provisionalInclude).toEqual(['inline#0:1'])
    expect(result.provisionalExclude).toEqual(['inline#0:2'])
    // provisionalExclude yields the actual rule node (for dependency resolution).
    expect(result.provisionalExcludeRules.map((r) => r.selectorText)).toEqual(['.c'])
  })

  it('fidelity bias: strongInclude ∪ provisionalInclude covers every CSSOM match', () => {
    ruleIdCounter = 0
    const a = styleRule('.a', [0])
    const b = styleRule('.b', [1])
    const tree = cssom([a, b])
    const result = reconcileHybrid(matchedSet([a, b]), coverage([]), tree) // coverage silent on all
    expect([...result.strongInclude, ...result.provisionalInclude].sort()).toEqual(['inline#0:0', 'inline#0:1'])
    expect(result.provisionalExclude).toEqual([])
  })

  it('is deterministic (sorted output)', () => {
    ruleIdCounter = 0
    const rules = [styleRule('.a', [0]), styleRule('.b', [1]), styleRule('.c', [2])]
    const tree = cssom(rules)
    const r1 = reconcileHybrid(matchedSet(rules), coverage(['inline#0:2', 'inline#0:0']), tree)
    const r2 = reconcileHybrid(matchedSet(rules), coverage(['inline#0:0', 'inline#0:2']), tree)
    expect(r1.strongInclude).toEqual(r2.strongInclude)
  })
})

describe('coverageOnlyRules', () => {
  it('returns the used rules in document order, no matcher involvement', () => {
    ruleIdCounter = 0
    const a = styleRule('.a', [0])
    const b = styleRule('.b', [1])
    const c = styleRule('.c', [2])
    const tree = cssom([a, b, c])
    const rules = coverageOnlyRules(coverage(['inline#0:0', 'inline#0:2']), tree)
    expect(rules.map((r) => r.selectorText)).toEqual(['.a', '.c'])
  })
})
