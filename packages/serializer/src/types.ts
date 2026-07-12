/**
 * Serializer input/output DTOs, per docs/architecture/016-Data-Flow.md §9.3
 * and docs/design/600-Serialization-Overview.md §8.1.
 *
 * The single-viewport (M1) path runs the identical code path as the merged
 * multi-viewport case (016 §12): merge is an identity with one contributor.
 */

import type { CascadeOrigin, DependencyNode } from '@critical-css/shared'

export interface MergedRule {
  readonly selectorText: string
  /** Verbatim browser-reported declaration list (no re-normalization, INV token determinism). */
  readonly declarationText: string
  readonly origin: CascadeOrigin
  /** Browser-resolved layer rank; `null` = unlayered (sorts LAST, 601 §10.2). */
  readonly layerOrder: number | null
  /** Enclosing condition chain, outermost first (e.g. `@media …`, `@supports …`). */
  readonly atRuleChain: readonly string[]
  readonly contributingViewports: readonly string[]
  /** Join keys carried through unchanged (016 §11). */
  readonly stylesheetIndex: number
  readonly ruleIndex: readonly number[]
}

export interface MergedMultiViewportRuleSet {
  readonly rules: readonly MergedRule[]
  /** Dependency at-rules (fonts/keyframes/…); M1: may be empty. */
  readonly dependencyManifest: readonly DependencyNode[]
}

export type OutputFormat = 'raw'

export interface SerializerConfig {
  readonly format: OutputFormat
  /** M1: always false — Minified is a pass-through stage. */
  readonly minify: boolean
  /**
   * Structural determinism knobs (600 §8.2 obligation 3) — pinned defaults,
   * locked by golden files:
   */
  readonly indent: string
  readonly lineEnding: '\n'
  readonly trailingNewline: boolean
}

export const DEFAULT_SERIALIZER_CONFIG: SerializerConfig = {
  format: 'raw',
  minify: false,
  indent: '  ',
  lineEnding: '\n',
  trailingNewline: true,
}

export interface SerializationStats {
  readonly ruleCount: number
  readonly dependencyCount: number
  readonly byteLength: number
}

export interface SerializedArtifact {
  readonly format: OutputFormat
  readonly css: string
  /** M1: always null (source maps are M2). */
  readonly sourceMap: null
  readonly stats: SerializationStats
}
