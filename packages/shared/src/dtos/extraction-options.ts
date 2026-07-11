/**
 * ExtractionOptions — the full configuration schema consumed by the
 * Configuration Loader (apps/cli), per docs/implementation/001-Task-Breakdown.md
 * BI-01.2 and docs/architecture/003-Requirements.md REQ-105/REQ-150.
 */

import type { ViewportProfile } from './viewport-profile.js'

export type ExtractionMode = 'cssom' | 'coverage' | 'hybrid'
export type EngineKind = 'chromium' | 'firefox' | 'webkit'
export type SandboxPolicy = 'full' | 'ci-container' | 'unsafe-no-sandbox'
export type WaitUntil = 'domcontentloaded' | 'load' | 'networkidle'

/** Stabilization knobs, per docs/design/104-Rendering-Stabilization.md §10.1. */
export interface StabilizationPolicy {
  /** Consecutive quiet animation frames required. Default 6 (~100ms @60fps). */
  readonly requiredQuietFrames: number
  /** Outer hard deadline for the whole stabilization wait. Default 5000. */
  readonly stabilizationTimeoutMs: number
  /** Frames after which a pre-existing animation is steady-state. Default 120. */
  readonly maxAnimationSettleFrames: number
  /** Attribute name patterns whose mutations are ignored. Default `["data-*"]`. */
  readonly ignoredMutationAttributes: readonly string[]
  /** Selectors whose subtree mutations are ignored. Default `[]`. */
  readonly ignoredMutationSelectors: readonly string[]
  /** Optional app-declared readiness: selector that must match. */
  readonly customReadinessSelector: string | null
  /** Optional app-declared readiness: global boolean (e.g. `__APP_READY__`). */
  readonly customReadinessGlobal: string | null
  /** Escalate stabilization timeout to a hard failure. Default false. */
  readonly strictStabilization: boolean
}

export interface NavigationOptions {
  readonly waitUntil: WaitUntil
  /** Mandatory, finite (REQ-554). Default 30000. */
  readonly timeoutMs: number
}

export interface BrowserOptions {
  readonly engine: EngineKind
  readonly headless: boolean
  readonly sandboxPolicy: SandboxPolicy
  /** Pool concurrency ceiling. Default 2. */
  readonly maxConcurrency: number
  readonly launchTimeoutMs: number
}

export interface CacheOptions {
  readonly enabled: boolean
  readonly ttlMs: number | null
}

export interface OutputOptions {
  /** Output file path; `null` = stdout. */
  readonly path: string | null
  readonly minify: boolean
}

export interface ExtractionOptions {
  readonly mode: ExtractionMode
  readonly viewports: readonly ViewportProfile[]
  readonly navigation: NavigationOptions
  readonly stabilization: StabilizationPolicy
  readonly browser: BrowserOptions
  readonly cache: CacheOptions
  readonly output: OutputOptions
  /** Plugin module identifiers, executed in declared (stable) order. */
  readonly plugins: readonly string[]
}
