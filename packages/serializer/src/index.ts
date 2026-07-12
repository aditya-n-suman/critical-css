/**
 * @critical-css/serializer — public API barrel (AT-07, M1 basic slice:
 * canonical rule ordering + deterministic pretty output).
 */

export { serialize, compareMergedRules, toInlineStyle, toJsonEnvelope } from './serialize.js'
// The rule-index-path comparator lives in @critical-css/shared (single source
// of ordering truth for matcher + serializer); re-exported for convenience.
export { compareRuleIndexPaths } from '@critical-css/shared'
export { DEFAULT_SERIALIZER_CONFIG } from './types.js'
export type {
  MergedMultiViewportRuleSet,
  MergedRule,
  SerializerConfig,
  SerializedArtifact,
  SerializationStats,
  OutputFormat,
} from './types.js'
