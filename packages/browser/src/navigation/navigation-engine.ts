/**
 * NavigationEngine — navigation plus the Stability Window Algorithm
 * (docs/design/103-Navigation-Engine.md, 104-Rendering-Stabilization.md,
 * BI-02.3).
 *
 * Navigation's own responsibility ends when `goto`'s waitUntil signal fires
 * (103 §8.5); stabilization then waits for RAF-gated mutation quiescence,
 * corroborated by `document.readyState` and `document.fonts.ready`, bounded
 * by a hard deadline (104 §8.6).
 */

import { ExtractionError, NavigationTimeoutError } from '@critical-css/shared'
import type { Diagnostic, StabilizationPolicy } from '@critical-css/shared'
import { getRaw } from '../internal/raw.js'
import type { NavigateOptions, NavigationResult, PageHandle, StabilizationResult } from '../types/page-handle.js'

export const DEFAULT_STABILIZATION_POLICY: StabilizationPolicy = {
  requiredQuietFrames: 6,
  stabilizationTimeoutMs: 5_000,
  maxAnimationSettleFrames: 120,
  ignoredMutationAttributes: ['data-'],
  ignoredMutationSelectors: [],
  customReadinessSelector: null,
  customReadinessGlobal: null,
  strictStabilization: false,
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000

interface StabilizationReading {
  quietFrames: number
  readyState: string
  fontsReady: boolean
  customReady: boolean
}

interface MonitorConfig {
  ignoredAttributePrefixes: readonly string[]
  ignoredSelectors: readonly string[]
  customReadinessSelector: string | null
  customReadinessGlobal: string | null
}

/**
 * Installed once per page via a single evaluate() round trip. A persistent
 * in-page RAF loop counts quiet frames (104 §11: never one evaluate per
 * frame); the host polls the counter alongside the corroborating gates.
 */
export function installStabilizationMonitor(cfg: MonitorConfig): void {
  const w = window as unknown as Record<string, unknown>
  const existing = w['__ccssStabilization'] as { reset: () => void; isStopped: () => boolean } | undefined
  if (existing !== undefined && !existing.isStopped()) {
    existing.reset()
    return
  }
  const state = { quietFrames: 0, dirty: false, fontsReady: false, stopped: false, baselined: false }

  const isRelevant = (m: MutationRecord): boolean => {
    const target = m.target instanceof Element ? m.target : null
    if (target !== null && cfg.ignoredSelectors.length > 0) {
      for (const sel of cfg.ignoredSelectors) {
        try {
          // Delegated to the browser's own matcher (ADR-0002) — never parsed.
          if (target.closest(sel) !== null) return false
        } catch {
          /* invalid selector: conservatively treat mutation as relevant */
        }
      }
    }
    if (m.type === 'attributes') {
      const name = m.attributeName ?? ''
      for (const prefix of cfg.ignoredAttributePrefixes) {
        if (name.startsWith(prefix)) return false
      }
    }
    return true
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (isRelevant(m)) {
        state.dirty = true
        return
      }
    }
  })
  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    subtree: true,
    characterData: true,
  })

  document.fonts?.ready.then(() => {
    state.fontsReady = true
  })

  const tick = (): void => {
    if (state.stopped) return
    if (document.readyState !== 'complete') {
      // The quiet window is post-load by contract (104 §8.6 gates on the
      // corroborating readiness signals): frames elapsed while the document
      // is still loading must not pre-fill the counter, or the readyState
      // gate could pass with zero post-load quiet frames observed.
      state.quietFrames = 0
      state.dirty = false
      state.baselined = false
    } else if (state.dirty) {
      state.quietFrames = 0
      state.dirty = false
    } else if (!state.baselined) {
      // A "quiet frame" is a full RAF-to-RAF interval observed with no
      // relevant mutation (104 §8.1: "settled paint cycles", not elapsed
      // callbacks). The interval ending at this first eligible callback is
      // partial — it began mid-frame at monitor install or at the moment
      // readyState flipped — so it only establishes the frame baseline;
      // counting starts with the next full interval. Without this, N
      // required frames close the window up to a frame early, racing page
      // timers scheduled ~N-frame-lengths out.
      state.baselined = true
    } else {
      state.quietFrames += 1
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  w['__ccssStabilization'] = {
    read: (): StabilizationReading => {
      let customReady = true
      if (cfg.customReadinessGlobal !== null) {
        customReady = (w[cfg.customReadinessGlobal] as boolean | undefined) === true
      }
      if (customReady && cfg.customReadinessSelector !== null) {
        customReady = document.querySelector(cfg.customReadinessSelector) !== null
      }
      return {
        // A relevant mutation already delivered to the observer but not yet
        // folded in by the next RAF tick must block a stable verdict (104
        // §10.1 drains pending mutations *before* deciding each tick):
        // report the window as empty rather than the stale counter.
        quietFrames: state.dirty ? 0 : state.quietFrames,
        readyState: document.readyState,
        fontsReady: state.fontsReady || document.fonts === undefined,
        customReady,
      }
    },
    reset: (): void => {
      state.quietFrames = 0
      state.dirty = false
      state.baselined = false
    },
    // Stop the RAF loop + observer once stabilization concludes, so the
    // monitor does not keep churning during snapshot/matching evaluates.
    // A later stabilize() on the same page reinstalls from scratch.
    stop: (): void => {
      state.stopped = true
      observer.disconnect()
    },
    isStopped: (): boolean => state.stopped,
  }
}

function stopStabilizationMonitor(): void {
  const monitor = (window as unknown as Record<string, unknown>)['__ccssStabilization'] as
    | { stop: () => void }
    | undefined
  monitor?.stop()
}

function readStabilizationMonitor(): StabilizationReading {
  const monitor = (window as unknown as Record<string, unknown>)['__ccssStabilization'] as
    | { read: () => StabilizationReading }
    | undefined
  if (monitor === undefined) {
    return { quietFrames: 0, readyState: document.readyState, fontsReady: false, customReady: false }
  }
  return monitor.read()
}

export class NavigationEngine {
  async navigate(handle: PageHandle, url: string, options: NavigateOptions = {}): Promise<NavigationResult> {
    const raw = getRaw(handle)
    const waitUntil = options.waitUntil ?? 'domcontentloaded'
    const timeoutMs = options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS
    const policy: StabilizationPolicy = { ...DEFAULT_STABILIZATION_POLICY, ...options.stabilization }

    const start = Date.now()
    let statusCode: number | null = null
    try {
      const response = await raw.page.goto(url, { waitUntil, timeout: timeoutMs })
      statusCode = response?.status() ?? null
    } catch (cause) {
      // Raw Playwright errors never escape the adapter boundary (101 §8.1).
      // M1 note: every goto failure (DNS, refused, SSL, timeout) maps to
      // NavigationTimeoutError per AGENT_IMPL_BRIEF's M0/M1 contract; 103's
      // full NavigationError subtype taxonomy (dnsFailure/connectionRefused/
      // redirectLoop/…) is M2 work — the true cause is preserved in `cause`.
      throw new NavigationTimeoutError(
        `Navigation to ${url} failed or timed out after ${Date.now() - start}ms`,
        { cause, source: { url }, context: { waitUntil, timeoutMs } },
      )
    }

    const stabilization = await this.stabilize(handle, policy)
    if (!stabilization.stable && policy.strictStabilization) {
      throw new ExtractionError(
        'STABILIZATION_TIMEOUT',
        `Page did not stabilize within ${policy.stabilizationTimeoutMs}ms (strictStabilization)`,
        { source: { url }, context: { quietFrames: stabilization.quietFrames } },
      )
    }

    return {
      finalUrl: raw.page.url(),
      statusCode,
      elapsedMs: Date.now() - start,
      stabilization,
    }
  }

  /** The Stability Window Algorithm (104 §10.1), soft-timeout by default. */
  async stabilize(handle: PageHandle, policy: StabilizationPolicy = DEFAULT_STABILIZATION_POLICY): Promise<StabilizationResult> {
    const raw = getRaw(handle)
    const start = Date.now()
    const deadline = start + policy.stabilizationTimeoutMs
    const diagnostics: Diagnostic[] = []

    const monitorConfig: MonitorConfig = {
      ignoredAttributePrefixes: policy.ignoredMutationAttributes,
      ignoredSelectors: policy.ignoredMutationSelectors,
      customReadinessSelector: policy.customReadinessSelector,
      customReadinessGlobal: policy.customReadinessGlobal,
    }
    await raw.page.evaluate(installStabilizationMonitor, monitorConfig)
    raw.stabilizationMonitorInstalled = true

    let lastReading: StabilizationReading = {
      quietFrames: 0,
      readyState: 'loading',
      fontsReady: false,
      customReady: false,
    }
    // Poll cadence ~roughly every couple of frames; the counting itself is
    // in-page, so polling frequency affects latency only, not correctness.
    const pollIntervalMs = 40
    while (Date.now() < deadline) {
      lastReading = await raw.page.evaluate(readStabilizationMonitor, undefined as never)
      const stable =
        lastReading.quietFrames >= policy.requiredQuietFrames &&
        lastReading.readyState === 'complete' &&
        lastReading.fontsReady &&
        lastReading.customReady
      if (stable) {
        await raw.page.evaluate(stopStabilizationMonitor, undefined as never)
        return {
          stable: true,
          elapsedMs: Date.now() - start,
          quietFrames: lastReading.quietFrames,
          diagnostics,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    await raw.page.evaluate(stopStabilizationMonitor, undefined as never).catch(() => undefined)
    diagnostics.push({
      severity: 'warning',
      code: 'STABILIZATION_TIMEOUT',
      message: `Stabilization deadline (${policy.stabilizationTimeoutMs}ms) reached before the page settled`,
      context: {
        quietFrames: lastReading.quietFrames,
        requiredQuietFrames: policy.requiredQuietFrames,
        readyState: lastReading.readyState,
        fontsReady: lastReading.fontsReady,
      },
    })
    return {
      stable: false,
      elapsedMs: Date.now() - start,
      quietFrames: lastReading.quietFrames,
      diagnostics,
    }
  }
}
