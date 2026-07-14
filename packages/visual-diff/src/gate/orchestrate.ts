/**
 * Browser orchestration for the visual gate (703 §9.2 / 002 §9).
 *
 * Per (fixture, viewport) case: acquire ONE profiled page from the pool,
 * capture R_full, then re-navigate the same page to capture R_crit (the
 * critical-CSS-only render). Both screenshots then feed:
 *  - the 703 parity verdict (R_full vs R_crit), and
 *  - the 002 baseline verdict (R_full vs the committed baseline image).
 *
 * R_full is captured once and reused as both the parity reference and the
 * baseline candidate, so a case costs exactly two renders (703 §14).
 */

import { BrowserManager, BUILT_IN_PROFILES } from '@critical-css/browser'
import type { ViewportProfile } from '@critical-css/shared'
import { DEFAULT_DIFF_THRESHOLDS, type DiffThresholds } from '../diff/pixel-diff.js'
import { renderCandidate, renderReference } from '../render/dual-render.js'
import { readBaselineImage } from '../baseline/store.js'
import {
  aggregateGateExit,
  runBaselineTest,
  runParityTest,
  type VisualGateExit,
  type VisualTestResult,
} from './gate.js'

export type BuiltInViewport = 'desktop' | 'tablet' | 'mobile'

export interface VisualCase {
  readonly fixtureId: string
  readonly viewport: BuiltInViewport
  readonly url: string
  /** The extracted critical CSS whose parity is being proven (703). */
  readonly criticalCss: string
  readonly stubSelectors?: readonly string[]
}

export interface CaseRenders {
  readonly full: Uint8Array
  readonly crit: Uint8Array
}

/** Capture R_full and R_crit for one case on a single profiled page. */
export async function renderCase(manager: BrowserManager, testCase: VisualCase): Promise<CaseRenders> {
  const profile: ViewportProfile = BUILT_IN_PROFILES[testCase.viewport]
  const opts = testCase.stubSelectors !== undefined ? { stubSelectors: testCase.stubSelectors } : {}
  const handle = await manager.acquire(profile)
  try {
    const full = await renderReference(handle, testCase.url, profile, opts)
    const crit = await renderCandidate(handle, testCase.url, profile, testCase.criticalCss, opts)
    return { full, crit }
  } finally {
    await manager.release(handle)
  }
}

export interface CaseGateResult {
  readonly fixtureId: string
  readonly viewport: BuiltInViewport
  /** 703 dual-render parity (critical CSS sufficiency). */
  readonly parity: VisualTestResult
  /** 002 regression vs committed baseline. */
  readonly baseline: VisualTestResult
}

/**
 * Run both the 703 parity check and the 002 baseline check for one case.
 * `baselineDir` is where committed baseline PNGs live.
 */
export async function runCaseGate(
  manager: BrowserManager,
  testCase: VisualCase,
  baselineDir: string,
  thresholds: DiffThresholds = DEFAULT_DIFF_THRESHOLDS,
): Promise<CaseGateResult> {
  const { full, crit } = await renderCase(manager, testCase)
  const parityId = `parity::${testCase.fixtureId}::${testCase.viewport}`
  const baselineId = `visual::${testCase.fixtureId}::${testCase.viewport}`
  const parity = await runParityTest(
    parityId,
    () => Promise.resolve(full),
    () => Promise.resolve(crit),
    thresholds,
  )
  const storedBaseline = await readBaselineImage(baselineDir, testCase.fixtureId, testCase.viewport)
  const baseline = await runBaselineTest(baselineId, storedBaseline, () => Promise.resolve(full), thresholds)
  return { fixtureId: testCase.fixtureId, viewport: testCase.viewport, parity, baseline }
}

/**
 * Run the full case matrix and reduce it to a single hard-gate exit code
 * (703 §8.6 / 002 §8.4). Both the parity and baseline verdicts of every case
 * are aggregated; the caller decides hard-fail (use the code) vs soft-report.
 */
export async function runVisualGate(
  cases: readonly VisualCase[],
  baselineDir: string,
  thresholds: DiffThresholds = DEFAULT_DIFF_THRESHOLDS,
  managerOverride?: BrowserManager,
): Promise<{ exit: VisualGateExit; results: readonly CaseGateResult[] }> {
  const manager = managerOverride ?? new BrowserManager({ maxConcurrency: 1 })
  const results: CaseGateResult[] = []
  try {
    for (const testCase of cases) {
      results.push(await runCaseGate(manager, testCase, baselineDir, thresholds))
    }
  } finally {
    if (managerOverride === undefined) await manager.teardown()
  }
  const verdicts = results.flatMap((r) => [r.parity, r.baseline])
  return { exit: aggregateGateExit(verdicts), results }
}
