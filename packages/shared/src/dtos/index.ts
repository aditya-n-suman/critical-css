export type { Diagnostic, DiagnosticSeverity, DiagnosticSourceLocation } from './diagnostic.js'
export type {
  ViewportProfile,
  ColorScheme,
  ReducedMotion,
  ForcedColors,
} from './viewport-profile.js'
export { computeFold } from './viewport-profile.js'
export type { MatchedRule, CascadeOrigin, Specificity } from './matched-rule.js'
export type { DependencyNode, DependencyNodeType } from './dependency-node.js'
export type {
  CacheFingerprint,
  CacheFingerprintInput,
  CssAssetFingerprint,
} from './cache-fingerprint.js'
export { computeCacheFingerprint, fnv1a64, canonicalJsonStringify } from './cache-fingerprint.js'
export type {
  ExtractionOptions,
  ExtractionMode,
  EngineKind,
  SandboxPolicy,
  WaitUntil,
  StabilizationPolicy,
  NavigationOptions,
  BrowserOptions,
  CacheOptions,
  OutputOptions,
} from './extraction-options.js'
export type { ExtractionResult, StageTiming } from './extraction-result.js'
export type { PluginHookContext, PluginHookName } from './plugin-hook-context.js'
export type { RouteManifestEntry } from './route-manifest-entry.js'
