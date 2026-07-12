import { describe, expect, it } from 'vitest'
import { compareMergedRules, serialize } from '../src/index.js'
import type { MergedRule } from '../src/index.js'

function rule(overrides: Partial<MergedRule>): MergedRule {
  return {
    selectorText: '.a',
    declarationText: 'color: red;',
    origin: 'author',
    layerOrder: null,
    atRuleChain: [],
    contributingViewports: ['desktop'],
    stylesheetIndex: 0,
    ruleIndex: [0],
    ...overrides,
  }
}

describe('canonical ordering (601)', () => {
  it('orders by source order within the same (un)layer', () => {
    const a = rule({ selectorText: '.first', ruleIndex: [0] })
    const b = rule({ selectorText: '.second', ruleIndex: [1] })
    expect(compareMergedRules(a, b)).toBeLessThan(0)
    expect(serialize({ rules: [b, a], dependencyManifest: [] }).css.indexOf('.first')).toBeLessThan(
      serialize({ rules: [b, a], dependencyManifest: [] }).css.indexOf('.second'),
    )
  })

  it('orders across stylesheets by document position', () => {
    const sheet1 = rule({ selectorText: '.s1', stylesheetIndex: 1, ruleIndex: [0] })
    const sheet0 = rule({ selectorText: '.s0', stylesheetIndex: 0, ruleIndex: [9] })
    expect(compareMergedRules(sheet0, sheet1)).toBeLessThan(0)
  })

  it('nested rule index paths compare lexicographically', () => {
    const outer = rule({ ruleIndex: [2] })
    const nested = rule({ ruleIndex: [2, 0] })
    expect(compareMergedRules(outer, nested)).toBeLessThan(0)
  })

  it('unlayered rules are emitted LAST (601 §10.2)', () => {
    const layered = rule({ selectorText: '.layered', layerOrder: 0, ruleIndex: [5] })
    const unlayered = rule({ selectorText: '.unlayered', layerOrder: null, ruleIndex: [0] })
    const css = serialize({ rules: [unlayered, layered], dependencyManifest: [] }).css
    expect(css.indexOf('.layered')).toBeLessThan(css.indexOf('.unlayered'))
  })
})

describe('wrapper reconstruction (601 §8.3)', () => {
  it('re-emits @media wrappers and groups identical chains under one wrapper set', () => {
    const plain = rule({ selectorText: '.plain', ruleIndex: [0] })
    const m1 = rule({
      selectorText: '.m1',
      atRuleChain: ['@media (max-width: 600px)'],
      ruleIndex: [1, 0],
    })
    const m2 = rule({
      selectorText: '.m2',
      atRuleChain: ['@media (max-width: 600px)'],
      ruleIndex: [1, 1],
    })
    const css = serialize({ rules: [plain, m1, m2], dependencyManifest: [] }).css
    expect(css).toBe(
      [
        '.plain {',
        '  color: red;',
        '}',
        '@media (max-width: 600px) {',
        '  .m1 {',
        '    color: red;',
        '  }',
        '  .m2 {',
        '    color: red;',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('preserves nested wrapper chains in order, never hoisted', () => {
    const nested = rule({
      selectorText: '.deep',
      atRuleChain: ['@media (min-width: 600px)', '@supports (display: grid)'],
      ruleIndex: [0, 0, 0],
    })
    const css = serialize({ rules: [nested], dependencyManifest: [] }).css
    expect(css).toBe(
      [
        '@media (min-width: 600px) {',
        '  @supports (display: grid) {',
        '    .deep {',
        '      color: red;',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })
})

describe('determinism (600 §8.2, INV-3)', () => {
  it('double-serialize yields byte-identical output', () => {
    const rules = [
      rule({ selectorText: '.b', ruleIndex: [1] }),
      rule({ selectorText: '.a', ruleIndex: [0] }),
      rule({ selectorText: '.m', atRuleChain: ['@media screen'], ruleIndex: [2, 0] }),
    ]
    const first = serialize({ rules, dependencyManifest: [] }).css
    const second = serialize({ rules, dependencyManifest: [] }).css
    expect(first).toBe(second)
  })

  it('input array order does not affect output (sort is total over identity keys)', () => {
    const rules = [
      rule({ selectorText: '.a', ruleIndex: [0] }),
      rule({ selectorText: '.b', ruleIndex: [1] }),
    ]
    const forward = serialize({ rules, dependencyManifest: [] }).css
    const reversed = serialize({ rules: [...rules].reverse(), dependencyManifest: [] }).css
    expect(forward).toBe(reversed)
  })

  it('uses LF line endings and a single trailing newline (pinned)', () => {
    const css = serialize({ rules: [rule({})], dependencyManifest: [] }).css
    expect(css).not.toContain('\r')
    expect(css.endsWith('\n')).toBe(true)
    expect(css.endsWith('\n\n')).toBe(false)
  })
})

describe('edge cases', () => {
  it('empty rule set serializes to an empty string, never null', () => {
    const artifact = serialize({ rules: [], dependencyManifest: [] })
    expect(artifact.css).toBe('')
    expect(artifact.stats.ruleCount).toBe(0)
  })

  it('does not mutate its input', () => {
    const rules = [rule({ selectorText: '.b', ruleIndex: [1] }), rule({ selectorText: '.a', ruleIndex: [0] })]
    const snapshot = rules.map((r) => r.selectorText)
    serialize({ rules, dependencyManifest: [] })
    expect(rules.map((r) => r.selectorText)).toEqual(snapshot)
  })
})
