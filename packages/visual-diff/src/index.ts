/**
 * @critical-css/visual-diff — public API barrel.
 *
 * The dual-render pixel-diff capability (docs/design/703-Visual-Diff.md) and
 * its test-suite application (docs/testing/002-Visual-Tests.md). Exposes the
 * pure noise-tolerant diff algorithm, the dual-render setup over the browser
 * abstraction, the baseline store, and the CI gate contract.
 */

export {
  visualDiff,
  decodePng,
  DEFAULT_DIFF_THRESHOLDS,
  type RasterImage,
  type DiffThresholds,
  type DiffResult,
  type DiffVerdict,
} from './diff/pixel-diff.js'

export {
  renderReference,
  renderCandidate,
  type RenderOptions,
} from './render/dual-render.js'

export {
  testId,
  baselineImagePath,
  baselineMetaPath,
  readBaselineImage,
  writeBaselineImage,
  type BaselineMeta,
} from './baseline/store.js'

export {
  runParityTest,
  runBaselineTest,
  aggregateGateExit,
  VISUAL_GATE_EXIT,
  type VisualVerdict,
  type VisualTestResult,
  type VisualTestArtifacts,
  type VisualGateExit,
} from './gate/gate.js'

export {
  renderCase,
  runCaseGate,
  runVisualGate,
  type VisualCase,
  type CaseRenders,
  type CaseGateResult,
  type BuiltInViewport,
} from './gate/orchestrate.js'
