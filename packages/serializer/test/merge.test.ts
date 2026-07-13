/**
 * Multi-viewport merge unit tests (016 §10.1, 602 §8.6): pure, no browser.
 */

import { describe, expect, it } from 'vitest'
import { mergeViewports, serialize, synthesizeBand } from '../src/index.js'
import type { MergedRule, PerViewportRuleSet, ViewportBand } from '../src/index.js'

const BANDS: ViewportBand[] = [
  { viewportProfileId: 'mobile', width: 375 },
  { viewportProfileId: 'tablet', width: 768 },
  { viewportProfileId: 'desktop', width: 1920 },
]

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

function set(viewportProfileId: string, rules: MergedRule[]): PerViewportRuleSet {
  return { viewportProfileId, rules, dependencyManifest: [], layerDeclarationOrder: [] }
}

describe('synthesizeBand (602 §8.6.2)', () => {
  it('smallest profile → max-width band', () => {
    expect(synthesizeBand(new Set(['mobile']), BANDS)).toBe('(max-width: 767px)')
  })
  it('largest profile → min-width band', () => {
    expect(synthesizeBand(new Set(['desktop']), BANDS)).toBe('(min-width: 1920px)')
  })
  it('middle profile → bounded range', () => {
    expect(synthesizeBand(new Set(['tablet']), BANDS)).toBe('(min-width: 768px) and (max-width: 1919px)')
  })
  it('contiguous subset spanning the small edge → max-width only', () => {
    expect(synthesizeBand(new Set(['mobile', 'tablet']), BANDS)).toBe('(max-width: 1919px)')
  })
  it('non-contiguous subset (mobile+desktop, tablet skipped) → no band (emit unconditionally)', () => {
    // A single min/max range cannot exclude the skipped middle; banding it
    // would wrongly re-include tablet. Empty string → caller emits everywhere.
    expect(synthesizeBand(new Set(['mobile', 'desktop']), BANDS)).toBe('')
  })
})

describe('mergeViewports', () => {
  it('single viewport: every rule matched-in-all → unconditional, chain unchanged', () => {
    const merged = mergeViewports([set('desktop', [rule({ contributingViewports: ['desktop'] })])], [
      { viewportProfileId: 'desktop', width: 1920 },
    ])
    expect(merged.rules).toHaveLength(1)
    expect(merged.rules[0]?.atRuleChain).toEqual([]) // no synthetic wrapper
    expect(merged.rules[0]?.contributingViewports).toEqual(['desktop'])
  })

  it('matched in ALL profiles → emitted unconditionally (no synthetic band)', () => {
    const r = (vp: string): MergedRule => rule({ selectorText: '.shared', contributingViewports: [vp] })
    const merged = mergeViewports(
      [set('mobile', [r('mobile')]), set('tablet', [r('tablet')]), set('desktop', [r('desktop')])],
      BANDS,
    )
    expect(merged.rules).toHaveLength(1)
    expect(merged.rules[0]?.atRuleChain).toEqual([])
    expect(merged.rules[0]?.contributingViewports).toEqual(['desktop', 'mobile', 'tablet'])
  })

  it('matched in a subset with no intrinsic media → synthetic band wrapper', () => {
    const r = rule({ selectorText: '.mobile-only', contributingViewports: ['mobile'] })
    const merged = mergeViewports([set('mobile', [r])], BANDS) // only mobile ran... but bands has 3
    // matchedIn={mobile}, allProfiles={mobile,tablet,desktop} → subset → synthetic.
    expect(merged.rules[0]?.atRuleChain).toEqual([{ kind: 'media', conditionText: '(max-width: 767px)' }])
  })

  it('subset match WITH intrinsic media → keeps original chain, no synthetic wrapper', () => {
    const r = rule({
      selectorText: '.responsive',
      contributingViewports: ['mobile'],
      atRuleChain: [{ kind: 'media', conditionText: '(max-width: 600px)' }],
    })
    const merged = mergeViewports([set('mobile', [r])], BANDS)
    expect(merged.rules[0]?.atRuleChain).toEqual([{ kind: 'media', conditionText: '(max-width: 600px)' }])
  })

  it('is order-independent over input branch order', () => {
    const r = (vp: string): MergedRule => rule({ selectorText: '.x', contributingViewports: [vp] })
    const a = mergeViewports([set('mobile', [r('mobile')]), set('desktop', [r('desktop')])], BANDS)
    const b = mergeViewports([set('desktop', [r('desktop')]), set('mobile', [r('mobile')])], BANDS)
    expect(serialize(a).css).toBe(serialize(b).css)
  })

  it('unions dependency manifests by id', () => {
    const dep = { id: 'keyframes:fade', type: 'keyframes' as const, value: 'fade', cssText: '@keyframes fade {}', dependents: [], dependencies: [] }
    const merged = mergeViewports(
      [
        { viewportProfileId: 'mobile', rules: [], dependencyManifest: [dep], layerDeclarationOrder: [] },
        { viewportProfileId: 'desktop', rules: [], dependencyManifest: [dep], layerDeclarationOrder: [] },
      ],
      BANDS,
    )
    expect(merged.dependencyManifest).toHaveLength(1)
  })
})
