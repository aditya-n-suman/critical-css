/**
 * Selector Matcher acceptance tests (docs/tasks/003): full selector surface
 * against a real Playwright page; matching exclusively via element.matches().
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserManager } from '@critical-css/browser'
import type { PageHandle } from '@critical-css/browser'
import { collect } from '@critical-css/collector'
import type { CollectionResult } from '@critical-css/collector'
import { SelectorMatcher } from '../src/index.js'
import type { MatchedRuleSet } from '../src/index.js'

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/selectors.html')).href

describe('SelectorMatcher (real Chromium)', () => {
  let manager: BrowserManager
  let handle: PageHandle
  let collection: CollectionResult
  let result: MatchedRuleSet

  beforeAll(async () => {
    manager = new BrowserManager({ maxConcurrency: 1 })
    handle = await manager.acquire()
    await handle.navigate(FIXTURE)
    collection = await collect(handle)
    result = await new SelectorMatcher().matchRules(handle, collection.dom, collection.cssom, 'desktop')
  })

  afterAll(async () => {
    await manager.release(handle)
    await manager.teardown()
  })

  const selectorsMatched = (): string[] => result.matches.map((m) => m.selectorText)

  it('matches combinator selectors (child, sibling, adjacent)', () => {
    expect(selectorsMatched()).toContain('.card > a')
    expect(selectorsMatched()).toContain('.card ~ .sibling')
    expect(selectorsMatched()).toContain('h1 + p')
  })

  it('matches :is() and :where() via native delegation — no special-case code', () => {
    expect(selectorsMatched()).toContain(':is(.card, .panel) .label')
    expect(selectorsMatched()).toContain(':where(.card) .hint')
  })

  it('matches attribute selectors', () => {
    expect(selectorsMatched()).toContain('[data-role="cta"]')
  })

  it('tracks which comma branch matched (bookkeeping over browser-verified results)', () => {
    const commaRule = result.matches.find((m) => m.selectorText === '.card, .never-present')
    expect(commaRule).toBeDefined()
    expect(commaRule?.matchedSelectorBranches).toEqual(['.card'])
  })

  it('retains pseudo-element rules via base-selector host matching (402)', () => {
    const before = result.matches.find((m) => m.selectorText === '.card::before')
    expect(before).toBeDefined()
    // Serialized selector stays verbatim, including the pseudo-element.
    expect(before?.selectorText).toContain('::before')
  })

  it('excludes dynamic pseudo-class rules by design, with a diagnostic (403)', () => {
    expect(selectorsMatched()).not.toContain('.card:hover')
    const diag = result.diagnostics.find((d) => d.code === 'DYNAMIC_PSEUDO_CLASS_EXCLUDED_BY_DESIGN')
    expect(diag).toBeDefined()
    expect(diag?.severity).toBe('info')
  })

  it('excludes rules matching nothing, without diagnostics noise', () => {
    expect(selectorsMatched()).not.toContain('.absent-everywhere')
  })

  it('reports matched node ids resolvable against the DOM snapshot', () => {
    const card = result.matches.find((m) => m.selectorText === '.card, .never-present')
    const nodeIds = new Set(collection.dom.snapshot.nodes.map((n) => n.nodeId))
    expect(card?.matchedNodeIds.length).toBeGreaterThan(0)
    for (const id of card?.matchedNodeIds ?? []) expect(nodeIds.has(id)).toBe(true)
  })

  it('survives a stylesheet injected between collection passes (isolation)', async () => {
    // Chromium rejects unparseable selectors at CSSOM insert time, so an
    // "accepted by CSSOM, thrown by matches()" probe is not constructible
    // deterministically here — the per-pair try/catch is exercised at the
    // unit level. What IS testable: the matcher re-running cleanly against a
    // rule tree that grew a new sheet since the last pass.
    await handle.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.card { letter-spacing: 1px; }'
      document.head.appendChild(style)
    }, undefined as never)
    const fresh = await collect(handle)
    const rerun = await new SelectorMatcher().matchRules(handle, fresh.dom, fresh.cssom, 'desktop')
    const injected = rerun.matches.filter((m) => m.selectorText === '.card')
    expect(injected).toHaveLength(1)
    expect(injected[0]?.stylesheetIndex).toBe(1)
    // The original sheet's matches are unaffected.
    expect(rerun.matches.map((m) => m.selectorText)).toContain('.card > a')
  })

  it('MatchedRuleSet carries join keys unchanged (016 §11)', () => {
    expect(result.snapshotId).toBe(collection.snapshotId)
    expect(result.strategy).toBe('cssom')
    expect(result.viewportProfileId).toBe('desktop')
    for (const m of result.matches) {
      expect(m.stylesheetIndex).toBeGreaterThanOrEqual(0)
      expect(m.ruleIndexPath.length).toBeGreaterThan(0)
    }
  })
})
