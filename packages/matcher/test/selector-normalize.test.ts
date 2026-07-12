import { describe, expect, it } from 'vitest'
import { extractBaseSelector, splitSelectorList } from '../src/index.js'

describe('splitSelectorList (ADR-0002 sanctioned delimiter bookkeeping)', () => {
  it('splits on top-level commas', () => {
    expect(splitSelectorList('.a, .b , .c')).toEqual(['.a', '.b', '.c'])
  })

  it('never splits inside :is()/:where()/:has() argument lists', () => {
    expect(splitSelectorList(':is(.a, .b) .x, .y')).toEqual([':is(.a, .b) .x', '.y'])
    expect(splitSelectorList('div:has(> img, > svg)')).toEqual(['div:has(> img, > svg)'])
  })

  it('never splits inside attribute brackets or quoted strings', () => {
    expect(splitSelectorList('[data-x="a,b"], .z')).toEqual(['[data-x="a,b"]', '.z'])
  })
})

describe('extractBaseSelector (402 base-selector extraction)', () => {
  it('strips trailing pseudo-elements to the host selector', () => {
    expect(extractBaseSelector('.card::before')).toEqual({ baseSelector: '.card', pseudoElement: '::before' })
    expect(extractBaseSelector('p::first-line')).toEqual({ baseSelector: 'p', pseudoElement: '::first-line' })
  })

  it('normalizes legacy single-colon forms', () => {
    expect(extractBaseSelector('.card:after')).toEqual({ baseSelector: '.card', pseudoElement: '::after' })
  })

  it('does not touch pseudo-element look-alikes inside attribute strings', () => {
    const sel = '[data-foo="::before"]'
    expect(extractBaseSelector(sel)).toEqual({ baseSelector: sel, pseudoElement: null })
  })

  it('leaves pseudo-classes intact (they go to matches() verbatim)', () => {
    expect(extractBaseSelector('li:nth-child(2)')).toEqual({
      baseSelector: 'li:nth-child(2)',
      pseudoElement: null,
    })
  })

  it('bare pseudo-element hosts on every element', () => {
    expect(extractBaseSelector('::before')).toEqual({ baseSelector: '*', pseudoElement: '::before' })
  })

  it('does not amputate escaped-colon class names (Tailwind convention)', () => {
    expect(extractBaseSelector('.toggle\\:after')).toEqual({
      baseSelector: '.toggle\\:after',
      pseudoElement: null,
    })
  })
})

describe('containsDynamicPseudoClass', () => {
  it('detects real dynamic pseudo-classes', async () => {
    const { containsDynamicPseudoClass } = await import('../src/index.js')
    expect(containsDynamicPseudoClass('.card:hover')).toBe(true)
    expect(containsDynamicPseudoClass('a:visited span')).toBe(true)
  })

  it('ignores escaped-colon class-name look-alikes', async () => {
    const { containsDynamicPseudoClass } = await import('../src/index.js')
    expect(containsDynamicPseudoClass('.lg\\:hover-card')).toBe(false)
  })
})
