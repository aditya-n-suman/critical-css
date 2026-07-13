/**
 * CLI cache wiring (docs/design/800-Cache-Overview.md §9.1,
 * docs/design/801-Fingerprinting.md §8.1.5/§8.3, task 011: the `CacheChecked`
 * state sits BEFORE `BrowserAcquired`).
 *
 * The fingerprint is the canonical `computeCacheFingerprint` from
 * `@critical-css/cache` (SHA-256/64-hex — the shared FNV variant is
 * deprecated-in-place and its 16-hex keys are rejected by DiskCacheStore).
 *
 * `engineVersion` is `semver + ':' + configDigest` per 801 §8.1.5: the
 * output-affecting configuration subset (viewport set, minify, format) is
 * digested so a config change invalidates without a code change. The active
 * viewport *profile* is a separate fingerprint input; the multi-viewport
 * *set* (which drives the merge) rides the config digest.
 */

import { createHash } from 'node:crypto'
import { BUILT_IN_PROFILES } from '@critical-css/browser'
import {
  CacheManager,
  DiskCacheStore,
  computeCacheFingerprint,
  type CacheTraceEvent,
} from '@critical-css/cache'
import { canonicalJsonStringify, type CacheFingerprint } from '@critical-css/shared'
import { ENGINE_VERSION } from './extract.js'
import type { CollectedInputs } from './inputs.js'
import type { Format, Mode, ViewportName } from './config.js'

export interface CacheContext {
  readonly manager: CacheManager
  /** Every lookup outcome, in order — surfaced in the CI stderr summary. */
  readonly traces: CacheTraceEvent[]
}

/**
 * Build the cache context, or `null` when caching is not in play.
 * `--cache-dir` enables the persistent DiskCacheStore; `--no-cache` forces
 * every lookup to miss and every store to no-op while still emitting trace
 * events (800 §12 — a disabled cache is observable, not silent).
 */
export function createCacheContext(cacheDir: string | null, noCache: boolean): CacheContext | null {
  if (cacheDir === null) return null
  const traces: CacheTraceEvent[] = []
  const manager = new CacheManager({
    store: new DiskCacheStore(cacheDir),
    disabled: noCache,
    onTrace: (event) => traces.push(event),
  })
  return { manager, traces }
}

export interface FingerprintConfig {
  readonly viewports: readonly ViewportName[]
  readonly mode: Mode
  readonly minify: boolean
  readonly format: Format
}

/** 801 §8.3: digest over the output-affecting configuration subset only. */
export function configDigest(config: FingerprintConfig): string {
  return createHash('sha256')
    .update(
      canonicalJsonStringify({
        viewports: config.viewports,
        minify: config.minify,
        format: config.format,
      }),
      'utf8',
    )
    .digest('hex')
}

/** Compose the canonical 801 fingerprint for one CLI work unit. */
export function buildFingerprint(
  inputs: CollectedInputs,
  config: FingerprintConfig,
): CacheFingerprint {
  const primary = config.viewports[0] ?? 'desktop'
  return computeCacheFingerprint({
    htmlContent: inputs.htmlContent,
    cssAssets: inputs.cssAssets,
    viewportProfile: BUILT_IN_PROFILES[primary],
    extractionMode: config.mode,
    engineVersion: `${ENGINE_VERSION}:${configDigest(config)}`,
  })
}

/** Stable id for the viewport dimension of the cache entry metadata. */
export function viewportProfileIdOf(viewports: readonly ViewportName[]): string {
  return viewports.join('+')
}
