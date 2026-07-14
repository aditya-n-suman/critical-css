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

/** Rectangular crop in CSS pixels (scaled by DPR into the returned PNG). */
export interface ScreenshotClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ScreenshotOptions {
  /** Crop rectangle in CSS pixels. Omit for the whole viewport. */
  readonly clip?: ScreenshotClip
  /**
   * Freeze CSS animations/transitions at their end state before capture
   * (Playwright `animations: 'disabled'`). Default `true` — the visual-diff
   * contract (703 §8.2) requires a time-phase-independent capture.
   */
  readonly disableAnimations?: boolean
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
  /**
   * Capture a PNG screenshot of the current page (703-Visual-Diff.md §8.1).
   * Uses Playwright's native screenshot (never a canvas read — cross-origin
   * taint-safe, 703 §12). Returns raw PNG bytes so the visual-diff layer can
   * decode them without a Playwright dependency of its own.
   */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>
  /** Current page URL. */
  url(): string
}
