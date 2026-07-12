/**
 * M0 integration suite (AGENT_IMPL_BRIEF §6, BI-02.6) — real Playwright
 * Chromium, real fixtures, no mocks (Design Principle 1).
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NavigationTimeoutError } from '@critical-css/shared'
import { BrowserManager, BUILT_IN_PROFILES } from '../src/index.js'

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures')
const fixtureUrl = (name: string): string => pathToFileURL(resolve(FIXTURES, name, 'index.html')).href

describe('packages/browser M0 integration', () => {
  let manager: BrowserManager

  beforeAll(() => {
    manager = new BrowserManager({ maxConcurrency: 2 })
  })

  afterAll(async () => {
    await manager.teardown()
  })

  it('BrowserManager navigates all 3 fixtures without crash', async () => {
    for (const fixture of ['static', 'async', 'mobile']) {
      const handle = await manager.acquire()
      try {
        const result = await handle.navigate(fixtureUrl(fixture))
        expect(result.finalUrl).toContain(fixture)
        expect(result.stabilization.stable).toBe(true)
      } finally {
        await manager.release(handle)
      }
    }
  })

  it('acquire/release repeated 5 times leaks no permits or contexts', async () => {
    const before = manager.stats
    for (let i = 0; i < 5; i++) {
      const handle = await manager.acquire()
      await handle.navigate(fixtureUrl('static'))
      await manager.release(handle)
    }
    const after = manager.stats
    expect(after.inUse).toBe(0)
    expect(after.queued).toBe(0)
    // Every grant was matched by a release (102 §11 leak detection).
    expect(after.granted - before.granted).toBe(5)
    expect(after.released - before.released).toBe(5)
  })

  it('ViewportManager applies the mobile profile: window.innerWidth === 375 in-page', async () => {
    const handle = await manager.acquire()
    try {
      await handle.applyViewport(BUILT_IN_PROFILES.mobile)
      await handle.navigate(fixtureUrl('mobile'))
      const width = await handle.evaluate(() => window.innerWidth, undefined as never)
      expect(width).toBe(375)
      // The 600px media query must actually flip the layout (browser truth).
      const navDisplay = await handle.evaluate(
        () => getComputedStyle(document.getElementById('desktop-nav') as Element).display,
        undefined as never,
      )
      expect(navDisplay).toBe('none')
    } finally {
      await manager.release(handle)
    }
  })

  it('acquire(profile) honors context-time mobile emulation natively', async () => {
    const handle = await manager.acquire(BUILT_IN_PROFILES.mobile)
    try {
      await handle.navigate(fixtureUrl('mobile'))
      const facts = await handle.evaluate(
        () => ({
          width: window.innerWidth,
          dpr: window.devicePixelRatio,
          touch: navigator.maxTouchPoints > 0,
        }),
        undefined as never,
      )
      expect(facts.width).toBe(375)
      expect(facts.dpr).toBe(2)
      expect(facts.touch).toBe(true)
    } finally {
      await manager.release(handle)
    }
  })

  it('stabilization reports stable only after the async element appears', async () => {
    const handle = await manager.acquire()
    try {
      const result = await handle.navigate(fixtureUrl('async'))
      expect(result.stabilization.stable).toBe(true)
      // The 100ms-delayed element must be present at the stable point —
      // stabilization may not settle before the async mutation lands.
      const latePresent = await handle.evaluate(
        () => document.getElementById('late') !== null,
        undefined as never,
      )
      expect(latePresent).toBe(true)
      expect(result.stabilization.elapsedMs).toBeGreaterThanOrEqual(100)
    } finally {
      await manager.release(handle)
    }
  })

  it('DOMSnapshot captures above-fold nodes and excludes below-fold content', async () => {
    const handle = await manager.acquire(BUILT_IN_PROFILES.desktop)
    try {
      await handle.navigate(fixtureUrl('static'))
      const snapshot = await handle.captureSnapshot()
      expect(snapshot.foldPx).toBe(1080)
      const tags = snapshot.nodes.map((n) => `${n.tagName}#${n.attributes['id'] ?? ''}`)
      expect(tags).toContain('H1#title')
      expect(tags).not.toContain('FOOTER#below-fold')
      const hidden = snapshot.nodes.find((n) => n.attributes['id'] === 'hidden')
      expect(hidden?.visible).toBe(false)
      const title = snapshot.nodes.find((n) => n.attributes['id'] === 'title')
      expect(title?.visible).toBe(true)
      expect(title?.computedStyles['display']).toBeDefined()
    } finally {
      await manager.release(handle)
    }
  })

  it('throws NavigationTimeoutError when the target is unreachable', async () => {
    const handle = await manager.acquire()
    try {
      await expect(handle.navigate('http://127.0.0.1:9/unreachable', { timeoutMs: 5_000 })).rejects.toBeInstanceOf(
        NavigationTimeoutError,
      )
    } finally {
      await manager.release(handle)
    }
  })

  it('teardown leaves no dangling acquisitions (fresh manager)', async () => {
    const local = new BrowserManager({ maxConcurrency: 1 })
    const handle = await local.acquire()
    await handle.navigate(fixtureUrl('static'))
    await local.teardown()
    expect(local.stats.inUse).toBe(0)
    await expect(local.acquire()).rejects.toThrow()
  })
})
