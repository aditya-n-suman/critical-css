/**
 * Visibility classification DTOs, per docs/design/200-Visibility-Engine-Overview.md
 * §8.2/§8.3. Defined once here (200 §11) so collector, matcher, and reporter
 * share one vocabulary.
 */

export type VisibilityReasonCode =
  | 'VISIBLE'
  | 'DISPLAY_NONE'
  | 'ZERO_DIMENSIONS'
  | 'VISIBILITY_HIDDEN'
  | 'OPACITY_HIDDEN'
  | 'TRANSFORMED_OFFSCREEN'
  | 'BELOW_FOLD'
  | 'CLIPPED_BY_ANCESTOR'
  | 'STICKY_RESTING_OFFSCREEN'

export interface VisibilityAnnotation {
  readonly nodeId: number
  readonly isVisible: boolean
  /** First-sufficient-reason wins — never compound (200 §12). */
  readonly reason: VisibilityReasonCode
  /** Set when the reason implicates an ancestor (e.g. CLIPPED_BY_ANCESTOR). */
  readonly contributingAncestorNodeId: number | null
  /** Fold overlap fraction of the node's own height (202) — diagnostics. */
  readonly overlapFraction: number
}

export interface VisibilityAnnotatedNodeSet {
  readonly snapshotId: string
  readonly annotations: readonly VisibilityAnnotation[]
}

export type OpacityMode = 'ignore' | 'treatZeroAsHidden' | 'treatBelowThresholdAsHidden'
export type StickyPolicy = 'always-critical' | 'geometry-only'
export type FixedTreatment = 'always-critical' | 'fold-intersection'

/** One consolidated config object, fingerprinted as a unit (200 §8.2). */
export interface VisibilityConfig {
  readonly honorVisibilityHidden: boolean
  readonly opacityMode: OpacityMode
  readonly opacityThreshold: number
  /** REQ-103 "Could": transform-offscreen exclusion is opt-in, default false. */
  readonly ignoreTransformedOffscreen: boolean
  readonly stickyPolicy: StickyPolicy
  readonly fixedTreatment: FixedTreatment
  /** Signed, additive on top of the profile fold (202). Default 0. */
  readonly foldMarginPx: number
  /** Fraction of the node's own height that must overlap. Default 0 (any overlap). */
  readonly visibilityThreshold: number
}

export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  honorVisibilityHidden: true,
  opacityMode: 'ignore',
  opacityThreshold: 0,
  ignoreTransformedOffscreen: false,
  stickyPolicy: 'always-critical',
  fixedTreatment: 'always-critical',
  foldMarginPx: 0,
  visibilityThreshold: 0,
}
