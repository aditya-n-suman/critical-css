/**
 * Serializer input/output DTOs, per docs/architecture/016-Data-Flow.md §9.3
 * and docs/design/600-Serialization-Overview.md §8.1 / 606 §8.1.
 */

import type { AtRuleCondition, CascadeOrigin, DependencyNode } from '@critical-css/shared'

export interface MergedRule {
  readonly selectorText: string
  /** Verbatim browser-reported declaration list (no re-normalization, token determinism). */
  readonly declarationText: string
  readonly origin: CascadeOrigin
  /** Layer rank from the LayerOrderRegistry; `null` = unlayered (sorts LAST, 601 §10.2). */
  readonly layerOrder: number | null
  /** Structured enclosing condition chain, outermost first (302 §8.4). */
  readonly atRuleChain: readonly AtRuleCondition[]
  readonly contributingViewports: readonly string[]
  /** Join keys carried through unchanged (016 §11). */
  readonly stylesheetIndex: number
  readonly ruleIndex: readonly number[]
}

export interface MergedMultiViewportRuleSet {
  readonly rules: readonly MergedRule[]
  /** Dependency at-rules (fonts/keyframes/@property/@counter-style) — INV-2. */
  readonly dependencyManifest: readonly DependencyNode[]
  /** `@layer a, b;` declared order (first occurrence) — emitted as prelude (601 §8.4). */
  readonly layerDeclarationOrder?: readonly string[]
}

export type OutputFormat = 'raw-css' | 'inline-style' | 'json-envelope'

export interface SerializerConfig {
  readonly format: OutputFormat
  /** Conservative structural minification (603 safe-transform subset). */
  readonly minify: boolean
  /** Structural determinism knobs (600 §8.2 obligation 3), locked by goldens: */
  readonly indent: string
  readonly lineEnding: '\n'
  readonly trailingNewline: boolean
}

export const DEFAULT_SERIALIZER_CONFIG: SerializerConfig = {
  format: 'raw-css',
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
  /** Source maps are deferred (605: opt-in diagnostics tier). */
  readonly sourceMap: null
  readonly stats: SerializationStats
}
