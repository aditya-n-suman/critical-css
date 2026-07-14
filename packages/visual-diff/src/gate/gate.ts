/**
 * Visual-gate logic: the pass/fail verdicts and the CI exit-code contract.
 *
 * Two verdict producers, one shared pixel-diff algorithm (703 §10.1):
 *  - `runParityTest` (703 dual-render): R_full vs R_crit, both rendered NOW in
 *    the same session — "is this extraction's critical CSS sufficient?"
 *  - `runBaselineTest` (002 §10.1): current R_full vs a stored baseline image —
 *    "has this fixture's rendering drifted since the last approved baseline?",
 *    including the borderline-retry policy (002 §8.5.5).
 *
 * Both feed `aggregateGateExit`, which realizes the hard-gate contract of
 * 703 §8.6 / 002 §8.4: any FAIL or NEW_BASELINE_REQUIRED fails the build with
 * a distinct, documented non-zero exit code. Callers wanting a soft (report-
 * only) gate simply ignore the returned code.
 */

import {
  DEFAULT_DIFF_THRESHOLDS,
  decodePng,
  visualDiff,
  type DiffResult,
  type DiffThresholds,
} from '../diff/pixel-diff.js'

export type VisualVerdict = 'PASS' | 'FAIL' | 'NEW_BASELINE_REQUIRED'

export interface VisualTestArtifacts {
  readonly baseline: Uint8Array | null
  readonly candidate: Uint8Array
  readonly mask: Uint8Array | null
}

export interface VisualTestResult {
  readonly testId: string
  readonly verdict: VisualVerdict
  readonly diffRatio?: number
  readonly diffVerdict?: DiffResult['verdict']
  readonly artifacts?: VisualTestArtifacts
}

/**
 * Documented CI exit codes for the visual gate. Chosen disjoint from the
 * extraction CLI's 0–3 (0 ok · 1 extraction error · 2 usage · 3 byte-size
 * baseline gate) so a CI script aggregating both never conflates them.
 */
export const VISUAL_GATE_EXIT = {
  PASS: 0,
  /** A parity or baseline diff exceeded threshold (dropped/wrong rule, drift). */
  DIFF_FAILED: 4,
  /** A case has no committed baseline (hard gate: needs explicit review). */
  BASELINE_REQUIRED: 5,
  /** A render failed to paint, or images were dimension-mismatched (setup). */
  RENDER_ERROR: 6,
} as const

export type VisualGateExit = (typeof VISUAL_GATE_EXIT)[keyof typeof VISUAL_GATE_EXIT]

/**
 * 703 dual-render parity verdict. A PASS proves the critical CSS reproduces
 * the full-CSS above-fold appearance; a FAIL localizes a FOUC / layout shift.
 * DIMENSION_MISMATCH and RENDER_BLANK surface as a distinct render-error
 * verdict, never a silent PASS (703 §10.1 failure cases).
 */
export async function runParityTest(
  testId: string,
  renderReferenceFn: () => Promise<Uint8Array>,
  renderCandidateFn: () => Promise<Uint8Array>,
  thresholds: DiffThresholds = DEFAULT_DIFF_THRESHOLDS,
): Promise<VisualTestResult> {
  const reference = await renderReferenceFn()
  const candidate = await renderCandidateFn()
  const result = visualDiff(decodePng(reference), decodePng(candidate), thresholds)
  return {
    testId,
    verdict: result.verdict === 'PASS' ? 'PASS' : 'FAIL',
    diffRatio: result.diffRatio,
    diffVerdict: result.verdict,
    artifacts: { baseline: reference, candidate, mask: result.mask },
  }
}

/**
 * 002 baseline-vs-candidate test with borderline retry (002 §10.1). A missing
 * baseline yields NEW_BASELINE_REQUIRED (a required human action, never a
 * silent pass). A FAIL just inside `maxDiffRatio*(1+borderlineBand)` is
 * re-rendered once; a pass on retry is logged as a suspected transient. A diff
 * far above threshold, or a second failure, is reported as FAIL using the
 * FIRST result's artifacts (deterministic reporting).
 */
export async function runBaselineTest(
  testId: string,
  baseline: Uint8Array | null,
  renderCurrentFn: () => Promise<Uint8Array>,
  thresholds: DiffThresholds = DEFAULT_DIFF_THRESHOLDS,
  borderlineBand = 1,
  onSuspectedTransient?: (testId: string, first: number, second: number) => void,
): Promise<VisualTestResult> {
  const candidate = await renderCurrentFn()
  if (baseline === null) {
    return { testId, verdict: 'NEW_BASELINE_REQUIRED', artifacts: { baseline: null, candidate, mask: null } }
  }
  const decodedBaseline = decodePng(baseline)
  const result = visualDiff(decodedBaseline, decodePng(candidate), thresholds)
  if (result.verdict === 'PASS') {
    return { testId, verdict: 'PASS', diffRatio: result.diffRatio, diffVerdict: 'PASS' }
  }

  const withinBorderline =
    result.verdict === 'FAIL' && result.diffRatio <= thresholds.maxDiffRatio * (1 + borderlineBand)
  if (withinBorderline) {
    const candidate2 = await renderCurrentFn()
    const result2 = visualDiff(decodedBaseline, decodePng(candidate2), thresholds)
    if (result2.verdict === 'PASS') {
      onSuspectedTransient?.(testId, result.diffRatio, result2.diffRatio)
      return { testId, verdict: 'PASS', diffRatio: result2.diffRatio, diffVerdict: 'PASS' }
    }
  }
  return {
    testId,
    verdict: 'FAIL',
    diffRatio: result.diffRatio,
    diffVerdict: result.verdict,
    artifacts: { baseline, candidate, mask: result.mask },
  }
}

/**
 * Hard-gate aggregation (703 §8.6 / 002 §8.4). Render errors dominate (a setup
 * problem invalidates the verdict), then diff failures, then missing baselines.
 */
export function aggregateGateExit(results: readonly VisualTestResult[]): VisualGateExit {
  let sawFail = false
  let sawBaselineRequired = false
  for (const r of results) {
    if (r.diffVerdict === 'DIMENSION_MISMATCH' || r.diffVerdict === 'RENDER_BLANK') {
      return VISUAL_GATE_EXIT.RENDER_ERROR
    }
    if (r.verdict === 'FAIL') sawFail = true
    if (r.verdict === 'NEW_BASELINE_REQUIRED') sawBaselineRequired = true
  }
  if (sawFail) return VISUAL_GATE_EXIT.DIFF_FAILED
  if (sawBaselineRequired) return VISUAL_GATE_EXIT.BASELINE_REQUIRED
  return VISUAL_GATE_EXIT.PASS
}
