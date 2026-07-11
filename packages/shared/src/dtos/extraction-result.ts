/**
 * ExtractionResult — the final output shape of one extraction run
 * (one route × viewport profile × extraction mode triple), per
 * docs/architecture/004-Terminology.md and BI-01.2.
 */

import type { Diagnostic } from './diagnostic.js'
import type { MatchedRule } from './matched-rule.js'
import type { ExtractionMode } from './extraction-options.js'
import type { ViewportProfile } from './viewport-profile.js'

/** Per-pipeline-stage timing breakdown (REQ-463). */
export interface StageTiming {
  readonly stage: string
  readonly elapsedMs: number
}

export interface ExtractionResult {
  /** The serialized critical CSS payload. Deterministic (REQ-250/REQ-500). */
  readonly css: string
  readonly diagnostics: readonly Diagnostic[]
  readonly matchedRules: readonly MatchedRule[]
  readonly timing: readonly StageTiming[]
  readonly route: string
  readonly viewportProfile: ViewportProfile
  readonly mode: ExtractionMode
}
