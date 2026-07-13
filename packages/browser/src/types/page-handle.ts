/**
 * PageHandle — the opaque handle wrapping a live browser page
 * (docs/design/100-Browser-Abstraction.md, BI-02.5).
 *
 * Downstream packages see ONLY this surface; raw Playwright objects never
 * escape `packages/browser` (ADR-0003).
 */

import type { Diagnostic, StabilizationPolicy, ViewportProfile, WaitUntil } from '@critical-css/shared'
import type { DOMSnapshotResult } from './dom-snapshot-result.js'
import type { CoverageSession } from '../coverage/coverage-session.js'

export interface NavigateOptions {
  /** Default `'domcontentloaded'` — the weakest signal; stabilization takes over (103 §8.5). */
  readonly waitUntil?: WaitUntil
  /** Navigation timeout. Default 30 000 ms (REQ-554: always finite). */
  readonly timeoutMs?: number
  readonly stabilization?: Partial<StabilizationPolicy>
}

/** Result of the post-navigation Stability Window Algorithm (104 §10.1). */
export interface StabilizationResult {
  readonly stable: boolean
  readonly elapsedMs: number
  readonly quietFrames: number
  readonly diagnostics: readonly Diagnostic[]
}

export interface NavigationResult {
  readonly finalUrl: string
  /** HTTP status of the main resource; `null` for non-HTTP navigations (file://). */
  readonly statusCode: number | null
  readonly elapsedMs: number
  readonly stabilization: StabilizationResult
}

export interface PageHandle {
  /** Navigate and stabilize. Throws `NavigationTimeoutError` on unreachable/timed-out targets. */
  navigate(url: string, options?: NavigateOptions): Promise<NavigationResult>
  /**
   * Run a serializable function in-page. The single universal cross-boundary
   * primitive (100 §8.2) — no closures over Node-side state.
   */
  evaluate<TArgs, TResult>(fn: (args: TArgs) => TResult, args: TArgs): Promise<TResult>
  /** Apply a viewport/device profile to the live page (105 §8.2). */
  applyViewport(profile: ViewportProfile): Promise<void>
  /** Capture the above-fold DOM snapshot (106). */
  captureSnapshot(): Promise<DOMSnapshotResult>
  /**
   * Begin CSS coverage tracking. MUST be called before `navigate()` (700:
   * render-blocking usage is lost otherwise). Throws an ExtractionError with
   * code `CAPABILITY_UNAVAILABLE` on non-Chromium engines (100 §8.5) — never
   * silently returns empty coverage.
   */
  startCoverage(): Promise<CoverageSession>
  /** Current page URL. */
  url(): string
}
