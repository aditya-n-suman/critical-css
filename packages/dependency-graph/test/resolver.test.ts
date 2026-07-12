/**
 * FixedPointResolver unit tests (task 004): synthetic rule trees, no browser.
 */

import { describe, expect, it } from 'vitest'
import type { CssomRuleList, RuleNode } from '@critical-css/collector'
import type { MatchedRuleSet } from '@critical-css/matcher'
import { DependencyResolutionError } from '@critical-css/shared'
import {
  buildLayerOrderRegistry,
  extractVarReferences,
  FixedPointResolver,
  UNLAYERED_RANK,
} from '../src/index.js'

let ruleIdCounter = 0
function styleRule(selector: string, declarationText: string, path: number[] = [ruleIdCounter]): RuleNode {
  return {
    ruleId: ruleIdCounter++,
    parentRuleId: null,
    childRuleIds: [],
    sourceStylesheetIndex: 0,
    sourceRuleIndex: path[0] ?? 0,
    ruleIndexPath: path,
    ruleType: 'style',
    selectorText: selector,
    declarationText,
    conditionText: null,
    conditionActive: null,
    rawCssText: null,
  }
}

function atRule(type: RuleNode['ruleType'], name: string, cssText: string, path: number[]): RuleNode {
  return {
    ruleId: ruleIdCounter++,
    parentRuleId: null,
    childRuleIds: [],
    sourceStylesheetIndex: 0,
    sourceRuleIndex: path[0] ?? 0,
    ruleIndexPath: path,
    ruleType: type,
    selectorText: null,
    declarationText: cssText,
    conditionText: name,
    conditionActive: null,
    rawCssText: null,
  }
}

function cssom(rules: RuleNode[]): CssomRuleList {
  return {
    snapshotId: 's',
    diagnostics: [],
    stylesheets: [
      {
        sourceStylesheetIndex: 0,
        origin: 'style',
        href: null,
        disabled: false,
        accessible: true,
        rules,
        diagnostics: [],
      },
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

describe('extractVarReferences (501 §10.2)', () => {
  it('finds simple and nested-fallback references', () => {
    expect(extractVarReferences('color: var(--a);')).toEqual([{ propertyName: '--a', isFallbackBranch: false }])
    expect(extractVarReferences('color: var(--a, var(--b, red));')).toEqual([
      { propertyName: '--a', isFallbackBranch: false },
      { propertyName: '--b', isFallbackBranch: true },
    ])
  })

  it('literal fallbacks create no dependency', () => {
    expect(extractVarReferences('color: var(--a, red);')).toEqual([
      { propertyName: '--a', isFallbackBranch: false },
    ])
  })
})

describe('FixedPointResolver', () => {
  it('resolves a variable chain to fixed point, pulling declaring rules transitively', () => {
    ruleIdCounter = 0
    const root = styleRule(':root', '--base: #123456; --chained: var(--base);', [0])
    const card = styleRule('.card', 'color: var(--chained);', [1])
    const result = new FixedPointResolver().resolve(matchedSet([card]), cssom([root, card]))
    // :root declares --chained (and --base) → pulled in transitively once.
    expect(result.transitiveRules).toHaveLength(1)
    expect(result.transitiveRules[0]?.rule.selectorText).toBe(':root')
    const varNodes = result.manifest.filter((n) => n.type === 'variable')
    expect(varNodes.map((n) => n.value).sort()).toEqual(['--base', '--chained'])
  })

  it('terminates on a variable cycle with a CYCLIC_DEPENDENCY diagnostic — never hangs', () => {
    ruleIdCounter = 0
    const a = styleRule('.cyc-a', '--a: var(--b);', [0])
    const b = styleRule('.cyc-b', '--b: var(--a);', [1])
    const user = styleRule('.uses', 'color: var(--a);', [2])
    const result = new FixedPointResolver().resolve(matchedSet([user]), cssom([a, b, user]))
    const cycleDiag = result.diagnostics.find((d) => d.code === 'CYCLIC_DEPENDENCY')
    expect(cycleDiag).toBeDefined()
    // Cycle recorded, not rejected: nodes marked cyclic, resolution completed.
    const cyclic = [...result.graph.nodesById.values()].filter((n) => n.resolutionState === 'cyclic')
    expect(cyclic.length).toBeGreaterThan(0)
  })

  it('keyframes: duplicate names resolve last-wins (502)', () => {
    ruleIdCounter = 0
    const kf1 = atRule('keyframes', 'fade', '@keyframes fade { from { opacity: 0; } }', [0])
    const kf2 = atRule('keyframes', 'fade', '@keyframes fade { from { opacity: 0.5; } }', [1])
    const hero = styleRule('.hero', 'animation-name: fade;', [2])
    const result = new FixedPointResolver().resolve(matchedSet([hero]), cssom([kf1, kf2, hero]))
    const kfNodes = result.manifest.filter((n) => n.type === 'keyframes')
    expect(kfNodes).toHaveLength(1)
    expect(kfNodes[0]?.cssText).toContain('0.5')
  })

  it('missing keyframes surfaces MISSING_KEYFRAMES (REQ-452)', () => {
    ruleIdCounter = 0
    const hero = styleRule('.hero', 'animation-name: ghost;', [0])
    const result = new FixedPointResolver().resolve(matchedSet([hero]), cssom([hero]))
    expect(result.diagnostics.some((d) => d.code === 'MISSING_KEYFRAMES')).toBe(true)
  })

  it('font-face: all faces of a referenced family included as a set (503)', () => {
    ruleIdCounter = 0
    const f1 = atRule('font-face', '', "font-family: 'Brand'; font-weight: 400;", [0])
    ;(f1 as { declarationText: string }).declarationText = "font-family: 'Brand'; font-weight: 400;"
    const f2 = atRule('font-face', '', "font-family: 'Brand'; font-weight: 700;", [1])
    const hero = styleRule('.hero', "font-family: 'Brand', sans-serif;", [2])
    const result = new FixedPointResolver().resolve(matchedSet([hero]), cssom([f1, f2, hero]))
    expect(result.manifest.filter((n) => n.type === 'font-face')).toHaveLength(2)
  })

  it('@property registration attaches to every referencing variable, first-wins (504)', () => {
    ruleIdCounter = 0
    const p1 = atRule('property', '--accent', "@property --accent { syntax: '<color>'; inherits: true; initial-value: red; }", [0])
    const p2 = atRule('property', '--accent', "@property --accent { syntax: '<color>'; inherits: true; initial-value: blue; }", [1])
    const decl = styleRule(':root', '--accent: #06a;', [2])
    const card = styleRule('.card', 'color: var(--accent);', [3])
    const result = new FixedPointResolver().resolve(matchedSet([card]), cssom([p1, p2, decl, card]))
    const propNodes = result.manifest.filter((n) => n.type === 'property')
    expect(propNodes).toHaveLength(1)
    expect(propNodes[0]?.cssText).toContain('red') // FIRST wins — 504's explicit trap
  })

  it('counter-style: last-wins (505 — opposite of 504)', () => {
    ruleIdCounter = 0
    const c1 = atRule('counter-style', 'dots', "@counter-style dots { symbols: 'a'; }", [0])
    const c2 = atRule('counter-style', 'dots', "@counter-style dots { symbols: 'b'; }", [1])
    const counted = styleRule('.counted::before', 'content: counter(section, dots);', [2])
    const result = new FixedPointResolver().resolve(matchedSet([counted]), cssom([c1, c2, counted]))
    const csNodes = result.manifest.filter((n) => n.type === 'counter-style')
    expect(csNodes).toHaveLength(1)
    expect(csNodes[0]?.cssText).toContain("'b'")
  })

  it('throws DependencyResolutionError when the budget is exceeded — fail-fast, no hang', () => {
    ruleIdCounter = 0
    // Chain: --v0 → --v1 → … → --v50 (each declared in its own rule).
    const rules: RuleNode[] = []
    for (let i = 0; i < 50; i++) {
      rules.push(styleRule(`.decl-${i}`, `--v${i}: var(--v${i + 1});`, [i]))
    }
    const user = styleRule('.user', 'color: var(--v0);', [99])
    rules.push(user)
    expect(() => new FixedPointResolver().resolve(matchedSet([user]), cssom(rules), 10)).toThrow(
      DependencyResolutionError,
    )
  })
})

describe('buildLayerOrderRegistry (506/305)', () => {
  it('ranks by first-occurrence declaration order; unlayered LAST', () => {
    ruleIdCounter = 0
    const statement = atRule('layer-statement', 'base, overrides', '', [0])
    const block = atRule('layer-block', 'overrides', '', [1])
    const registry = buildLayerOrderRegistry(cssom([statement, block]))
    expect(registry.declarationOrder).toEqual(['base', 'overrides'])
    expect(registry.rankOf('base')).toBe(0)
    expect(registry.rankOf('overrides')).toBe(1)
    expect(registry.rankOf(null)).toBe(UNLAYERED_RANK)
    expect(registry.rankOf('base')).toBeLessThan(registry.rankOf(null))
  })
})
