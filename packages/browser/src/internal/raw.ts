/**
 * Internal bridge between the opaque public `PageHandle` and the raw
 * Playwright objects. NEVER re-exported through the package barrel —
 * downstream packages must not reach raw Playwright (ADR-0003).
 */

import type { BrowserContext, Page } from 'playwright'
import type { EngineKind, ViewportProfile } from '@critical-css/shared'
import type { PageHandle } from '../types/page-handle.js'

export interface RawPageState {
  readonly page: Page
  readonly context: BrowserContext
  readonly engine: EngineKind
  /** Last profile applied via ViewportManager; drives fold computation. */
  appliedProfile: ViewportProfile | null
  /** Guard: the in-page stabilization monitor is installed once per page. */
  stabilizationMonitorInstalled: boolean
  crashed: boolean
}

const registry = new WeakMap<PageHandle, RawPageState>()

export function registerRaw(handle: PageHandle, state: RawPageState): void {
  registry.set(handle, state)
}

export function getRaw(handle: PageHandle): RawPageState {
  const state = registry.get(handle)
  if (state === undefined) {
    throw new Error('Unknown PageHandle: not issued by this BrowserManager (or already released)')
  }
  return state
}
