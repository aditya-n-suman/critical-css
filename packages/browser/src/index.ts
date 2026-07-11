/**
 * @critical-css/browser — public API barrel (AT-02).
 *
 * Only the abstraction surface is exported; raw Playwright types and the
 * internal adapter wiring never cross this boundary (ADR-0003, 100 §11).
 */

export { BrowserManager, BrowserAcquisitionError, buildLaunchArgs } from './browser-manager/browser-manager.js'
export type { BrowserManagerOptions } from './browser-manager/browser-manager.js'
export { NavigationEngine, DEFAULT_STABILIZATION_POLICY } from './navigation/navigation-engine.js'
export { ViewportManager, BUILT_IN_PROFILES } from './viewport/viewport-manager.js'
export { DOMSnapshot } from './snapshot/dom-snapshot.js'
export { PoolExhaustedTimeoutError, PoolDrainingError } from './internal/semaphore.js'
export type {
  PageHandle,
  NavigateOptions,
  NavigationResult,
  StabilizationResult,
  DOMSnapshotResult,
  DOMSnapshotNode,
  BoundingRect,
} from './types/index.js'
