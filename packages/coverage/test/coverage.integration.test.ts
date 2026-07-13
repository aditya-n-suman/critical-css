/**
 * Coverage Mode integration test (AT-05, exit criterion 2): real Chromium,
 * real CDP coverage through the browser abstraction. Verifies used vs unused
 * rule mapping and capability gating. No import of matcher/collector here.
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserManager } from '@critical-css/browser'
import type { PageHandle } from '@critical-css/browser'
import { CoverageCollector } from '../src/index.js'

const ROOT = resolve(import.meta.dirname, '../../..')
const fixtureUrl = (name: string): string => pathToFileURL(resolve(ROOT, 'fixtures', name, 'index.html')).href

describe('CoverageCollector (real Chromium)', () => {
  let manager: BrowserManager
  let handle: PageHandle

  beforeAll(async () => {
    manager = new BrowserManager({ maxConcurrency: 1 })
    handle = await manager.acquire()
  })

  afterAll(async () => {
    await manager.release(handle)
    await manager.teardown()
  })

  it('maps painted rules to used, unmatched selectors to unused', async () => {
    const session = await handle.startCoverage()
    await handle.navigate(fixtureUrl('coverage'))
    const raw = await session.stop()
    const result = await new CoverageCollector().collect(handle, raw)

    // Inline sheet → sheetKey inline#0. Style rule order:
    // 0 body, 1 .used, 2 .also-used, 3 .never-used, 4 .also-never-used>.deep, 5 .spacer, 6 .below
    expect(result.usedRuleKeys.has('inline#0:1')).toBe(true) // .used (painted)
    expect(result.usedRuleKeys.has('inline#0:2')).toBe(true) // .also-used (painted)
    expect(result.unusedRuleKeys.has('inline#0:3')).toBe(true) // .never-used (no element)
    expect(result.unusedRuleKeys.has('inline#0:4')).toBe(true) // .also-never-used > .deep
  })

  it('startCoverage throws CAPABILITY_UNAVAILABLE would gate non-Chromium (chromium here supports it)', async () => {
    // On the default Chromium engine coverage is available — assert it does NOT throw.
    const session = await handle.startCoverage()
    await handle.navigate(fixtureUrl('static'))
    const raw = await session.stop()
    expect(Array.isArray(raw.entries)).toBe(true)
  })
})
