/**
 * Viewport / device profile DTOs, per docs/design/105-Viewport-Manager.md §8.1
 * and docs/architecture/004-Terminology.md.
 *
 * A profile is strictly more than width×height: it carries the correlated
 * device characteristics (DPR, UA, touch, emulated media features) that gate
 * `@media` matching, plus the fold boundary.
 */

export type ColorScheme = 'light' | 'dark' | 'no-preference'
export type ReducedMotion = 'reduce' | 'no-preference'
export type ForcedColors = 'active' | 'none'

export interface ViewportProfile {
  /** Human-readable, non-authoritative name ("mobile", "desktop", …). */
  readonly name: string
  /** Viewport width, CSS pixels. */
  readonly width: number
  /** Viewport height, CSS pixels. */
  readonly height: number
  /** Device pixel ratio (1, 2, 3 …). */
  readonly deviceScaleFactor: number
  /** Affects viewport meta-tag interpretation and touch-event synthesis. */
  readonly isMobile: boolean
  /** Affects `@media (pointer:)` / `(hover:)` resolution. */
  readonly hasTouch: boolean
  /** User agent override. `null` = browser engine default. */
  readonly userAgent: string | null
  readonly colorScheme: ColorScheme
  readonly reducedMotion: ReducedMotion
  readonly forcedColors: ForcedColors
  /**
   * Above-fold cutoff in CSS pixels. When non-null it REPLACES the default
   * fold (`height`) outright — it is not an additive delta
   * (docs/design/105-Viewport-Manager.md §8.3).
   */
  readonly foldOffset: number | null
}

/**
 * Fold computation — singularly owned here so stabilization's near-fold
 * scoping and the Visibility Engine's above-fold classification agree by
 * construction (105 §8.3).
 */
export function computeFold(profile: ViewportProfile): number {
  return profile.foldOffset ?? profile.height
}
