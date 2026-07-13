/**
 * Reporter unit tests (AT-10, task 009 M3 subset): pure, no browser.
 */

import { describe, expect, it } from 'vitest'
import type { CssomRuleList, RuleNode } from '@critical-css/collector'
import type { CssomRuleMatch } from '@critical-css/matcher'
import type { DependencyNode } from '@critical-css/shared'
import { Reporter } from '../src/index.js'

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

function cssom(rules: RuleNode[], href: string | null = 'https://x.test/app.css'): CssomRuleList {
  return {
    snapshotId: 's',
    diagnostics: [],
    stylesheets: [
      { sourceStylesheetIndex: 0, origin: 'link', href, disabled: false, accessible: true, rules, diagnostics: [] },
    ],
  }
}

function match(rule: RuleNode, nodeIds: number[]): CssomRuleMatch {
  return {
    stylesheetIndex: 0,
    ruleIndexPath: rule.ruleIndexPath,
    selectorText: rule.selectorText ?? '',
    matchedSelectorBranches: [rule.selectorText ?? ''],
    matchedNodeIds: nodeIds,
    declarationText: rule.declarationText,
    atRuleChain: [],
  }
}

describe('Reporter.build (four M3 reports + dep-graph)', () => {
  const a = styleRule('.a', [0])
  const b = styleRule('.b', [1])
  const cUnused = styleRule('.c', [2])
  ruleIdCounter = 0
  const tree = cssom([styleRule('.a', [0]), styleRule('.b', [1]), styleRule('.c', [2])])
  const matched = [match(a, [1, 2]), match(b, [3])]
  const manifest: DependencyNode[] = [
    { id: 'keyframes:fade', type: 'keyframes', value: 'fade', cssText: '@keyframes fade {}', dependents: ['rule:0:0'], dependencies: [] },
  ]

  const bundle = new Reporter().build({
    route: '/',
    viewportProfileId: 'desktop',
    mode: 'cssom',
    cssom: tree,
    matched,
    manifest,
    timing: [
      { stage: 'navigate', elapsedMs: 100 },
      { stage: 'match', elapsedMs: 20 },
    ],
  })

  it('matched-selector report lists matched rules with node counts', () => {
    expect(bundle.matchedSelectors.count).toBe(2)
    expect(bundle.matchedSelectors.rows.map((r) => r.selectorText)).toEqual(['.a', '.b'])
    expect(bundle.matchedSelectors.rows[0]?.matchedNodeCount).toBe(2)
  })

  it('unmatched-selector report = all source style rules minus matched', () => {
    expect(bundle.unmatchedSelectors.count).toBe(1)
    expect(bundle.unmatchedSelectors.rows[0]?.selectorText).toBe('.c')
    void cUnused
  })

  it('timing report sums stage durations', () => {
    expect(bundle.timing.totalMs).toBe(120)
    expect(bundle.timing.stages).toHaveLength(2)
  })

  it('per-stylesheet contribution reports retained/total + bytes', () => {
    const row = bundle.stylesheetContribution.stylesheets[0]
    expect(row?.stylesheetHref).toBe('https://x.test/app.css')
    expect(row?.retainedRuleCount).toBe(2)
    expect(row?.totalRuleCount).toBe(3)
    expect(row?.byteContribution).toBeGreaterThan(0)
    expect(bundle.stylesheetContribution.totalBytes).toBe(row?.byteContribution)
  })

  it('dependency-graph report emits nodes (REQ-460 structured JSON)', () => {
    expect(bundle.dependencyGraph.nodes.map((n) => n.id)).toContain('keyframes:fade')
    const json = new Reporter().toJson(bundle)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('does not mutate its inputs (pure sink)', () => {
    const before = matched.map((m) => m.selectorText)
    new Reporter().build({
      route: '/',
      viewportProfileId: 'desktop',
      mode: 'cssom',
      cssom: tree,
      matched,
      manifest,
      timing: [],
    })
    expect(matched.map((m) => m.selectorText)).toEqual(before)
  })
})
