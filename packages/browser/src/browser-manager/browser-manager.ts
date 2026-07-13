/**
 * BrowserManager — the browser pool (docs/design/102-Browser-Pool.md,
 * docs/tasks/001-Implement-Browser-Pool.md, BI-02.2).
 *
 * Fixed-size ceiling (default 2) with lazy warm-up; fresh, isolated
 * BrowserContext per acquisition; health-checked handles; shared in-flight
 * launch; graceful teardown with no orphaned browser processes.
 */

import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright'
import { ExtractionError } from '@critical-css/shared'
import type { EngineKind, SandboxPolicy, ViewportProfile } from '@critical-css/shared'
import { getRaw, registerRaw } from '../internal/raw.js'
import type { RawPageState } from '../internal/raw.js'
import { Semaphore } from '../internal/semaphore.js'
import { NavigationEngine } from '../navigation/navigation-engine.js'
import { DOMSnapshot } from '../snapshot/dom-snapshot.js'
import type { DOMSnapshotResult } from '../types/dom-snapshot-result.js'
import type { CoverageSession, RawCssCoverage } from '../coverage/coverage-session.js'
import type { NavigateOptions, NavigationResult, PageHandle } from '../types/page-handle.js'
import { ViewportManager } from '../viewport/viewport-manager.js'

export class BrowserAcquisitionError extends ExtractionError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super('BROWSER_ACQUISITION_FAILED', message, options)
  }
}

export interface BrowserManagerOptions {
  /** Pool concurrency ceiling. Default 2 (AGENT_IMPL_BRIEF). */
  readonly maxConcurrency?: number
  readonly engine?: EngineKind
  readonly headless?: boolean
  readonly sandboxPolicy?: SandboxPolicy
  readonly launchTimeoutMs?: number
  /** Bounded wait when the pool is saturated (102 §8.6). */
  readonly acquisitionTimeoutMs?: number
  /** Health-check probe budget; an order of magnitude below navigation timeouts (102 §11). */
  readonly healthCheckTimeoutMs?: number
}

interface ResolvedOptions {
  maxConcurrency: number
  engine: EngineKind
  headless: boolean
  sandboxPolicy: SandboxPolicy
  launchTimeoutMs: number
  acquisitionTimeoutMs: number
  healthCheckTimeoutMs: number
}

/** Chromium sandbox args per docs/design/101-Playwright-Adapter.md §8.8. */
export function buildLaunchArgs(engine: EngineKind, policy: SandboxPolicy): string[] {
  if (engine !== 'chromium') return []
  switch (policy) {
    case 'full':
      return []
    case 'ci-container':
      return ['--disable-dev-shm-usage']
    case 'unsafe-no-sandbox':
      return ['--no-sandbox', '--disable-dev-shm-usage']
    default: {
      const exhaustive: never = policy
      throw new ExtractionError('CONFIGURATION_INVALID', `Unknown sandboxPolicy: ${String(exhaustive)}`)
    }
  }
}

function browserTypeFor(engine: EngineKind): BrowserType {
  switch (engine) {
    case 'chromium':
      return chromium
    case 'firefox':
      return firefox
    case 'webkit':
      return webkit
  }
}

class PageHandleImpl implements PageHandle {
  constructor(
    private readonly navigation: NavigationEngine,
    private readonly viewport: ViewportManager,
    private readonly snapshot: DOMSnapshot,
  ) {}

  navigate(url: string, options?: NavigateOptions): Promise<NavigationResult> {
    return this.navigation.navigate(this, url, options)
  }

  async evaluate<TArgs, TResult>(fn: (args: TArgs) => TResult, args: TArgs): Promise<TResult> {
    try {
      // Playwright's PageFunction generics (Unboxed<TArgs>) don't unify with
      // the abstraction's plain-serializable contract (100 §8.2); the runtime
      // shape is identical, so bridge the nominal gap explicitly.
      return (await getRaw(this).page.evaluate(fn as never, args as never)) as TResult
    } catch (cause) {
      // Raw Playwright errors never escape the adapter boundary (101 §8.1).
      throw new ExtractionError('EVALUATION_FAILED', `In-page evaluation failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
        cause,
        source: { url: getRaw(this).page.url() },
      })
    }
  }

  applyViewport(profile: ViewportProfile): Promise<void> {
    return this.viewport.applyProfile(this, profile)
  }

  captureSnapshot(): Promise<DOMSnapshotResult> {
    return this.snapshot.capture(this)
  }

  async startCoverage(): Promise<CoverageSession> {
    const raw = getRaw(this)
    // Playwright's CSS coverage is its sanctioned CDP integration; present
    // only on Chromium. Capability-gate rather than silently no-op (700 §8.5).
    const coverage = (raw.page as unknown as { coverage?: PlaywrightCssCoverage }).coverage
    if (raw.engine !== 'chromium' || coverage === undefined) {
      throw new ExtractionError(
        'CAPABILITY_UNAVAILABLE',
        `CSS coverage requires Chromium; engine '${raw.engine}' does not support it`,
        { context: { engine: raw.engine } },
      )
    }
    await coverage.startCSSCoverage({ resetOnNavigation: false })
    return {
      stop: async (): Promise<RawCssCoverage> => {
        const entries = await coverage.stopCSSCoverage()
        return {
          entries: entries.map((e) => ({
            url: e.url,
            text: e.text,
            ranges: e.ranges.map((r) => ({ start: r.start, end: r.end })),
          })),
        }
      },
    }
  }

  url(): string {
    return getRaw(this).page.url()
  }
}

/** Minimal shape of Playwright's Chromium `page.coverage` we depend on. */
interface PlaywrightCssCoverage {
  startCSSCoverage(options?: { resetOnNavigation?: boolean }): Promise<void>
  stopCSSCoverage(): Promise<Array<{ url: string; text: string; ranges: Array<{ start: number; end: number }> }>>
}

export class BrowserManager {
  private readonly options: ResolvedOptions
  private readonly semaphore: Semaphore
  private warmBrowser: Browser | null = null
  private inFlightLaunch: Promise<Browser> | null = null
  private tornDown = false
  private readonly activeHandles = new Set<PageHandle>()

  private readonly navigation = new NavigationEngine()
  private readonly viewport = new ViewportManager()
  private readonly snapshot = new DOMSnapshot()

  /** Diagnostic counters (102 §11). */
  crashCount = 0
  coldStarts = 0

  constructor(options: BrowserManagerOptions = {}) {
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 2,
      engine: options.engine ?? 'chromium',
      headless: options.headless ?? true,
      sandboxPolicy: options.sandboxPolicy ?? 'full',
      launchTimeoutMs: options.launchTimeoutMs ?? 30_000,
      acquisitionTimeoutMs: options.acquisitionTimeoutMs ?? 30_000,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs ?? 1_000,
    }
    this.semaphore = new Semaphore(this.options.maxConcurrency)
  }

  get stats(): { inUse: number; queued: number; granted: number; released: number } {
    return {
      inUse: this.semaphore.inUse,
      queued: this.semaphore.queueDepth,
      granted: this.semaphore.granted,
      released: this.semaphore.released,
    }
  }

  /**
   * Lease a fresh, isolated, health-checked page from the pool.
   * Optionally parameterize the context with a full device profile so
   * context-creation-time emulation (UA, isMobile, hasTouch, DPR, media
   * features) is honored natively (105 §8.2).
   */
  async acquire(profile?: ViewportProfile): Promise<PageHandle> {
    if (this.tornDown) throw new BrowserAcquisitionError('BrowserManager has been torn down')
    await this.semaphore.acquire(this.options.acquisitionTimeoutMs)

    let context: BrowserContext | null = null
    try {
      const handle = await this.createHandle(profile)
      return handle
    } catch (firstFailure) {
      // One bounded retry against a fresh browser (102 §8.4): a nominally
      // successful launch can still yield an unhealthy renderer.
      try {
        await this.discardWarmBrowser()
        const handle = await this.createHandle(profile)
        return handle
      } catch (secondFailure) {
        // No context leak on failure: permit returned, contexts closed inside
        // createHandle's own cleanup.
        void context
        this.semaphore.release()
        throw new BrowserAcquisitionError(
          `Failed to acquire a healthy page (after one retry): ${String(
            secondFailure instanceof Error ? secondFailure.message : secondFailure,
          )}`,
          { cause: firstFailure },
        )
      }
    }
  }

  /** Return a leased page to the pool; always closes its context (102 §8.3). */
  async release(handle: PageHandle): Promise<void> {
    const raw = getRaw(handle)
    if (!this.activeHandles.delete(handle)) {
      throw new BrowserAcquisitionError('release() called with a handle not currently leased')
    }
    try {
      await raw.context.close()
    } catch {
      // A double-close on an already-invalid (crashed) context is expected.
    }
    this.semaphore.release()
  }

  /** Close all contexts and the browser; leaves no orphaned processes. */
  async teardown(): Promise<void> {
    this.tornDown = true
    this.semaphore.drain()
    for (const handle of Array.from(this.activeHandles)) {
      const raw = getRaw(handle)
      await raw.context.close().catch(() => undefined)
      this.activeHandles.delete(handle)
      this.semaphore.release()
    }
    if (this.inFlightLaunch !== null) {
      // Wait out an in-flight launch so its browser is not orphaned.
      const browser = await this.inFlightLaunch.catch(() => null)
      if (browser !== null) await browser.close().catch(() => undefined)
      this.inFlightLaunch = null
    }
    await this.discardWarmBrowser()
  }

  private async createHandle(profile?: ViewportProfile): Promise<PageHandle> {
    const browser = await this.ensureBrowser()
    let context: BrowserContext | null = null
    try {
      context = await browser.newContext(
        profile !== undefined
          ? {
              viewport: { width: profile.width, height: profile.height },
              deviceScaleFactor: profile.deviceScaleFactor,
              isMobile: profile.isMobile,
              hasTouch: profile.hasTouch,
              ...(profile.userAgent !== null ? { userAgent: profile.userAgent } : {}),
              colorScheme: profile.colorScheme,
              reducedMotion: profile.reducedMotion,
              forcedColors: profile.forcedColors,
            }
          : {},
      )
      const page = await context.newPage()
      page.on('crash', () => {
        this.crashCount += 1
      })
      await this.healthCheck(page)

      const handle = new PageHandleImpl(this.navigation, this.viewport, this.snapshot)
      const rawState: RawPageState = {
        page,
        context,
        engine: this.options.engine,
        appliedProfile: profile ?? null,
        stabilizationMonitorInstalled: false,
        crashed: false,
      }
      registerRaw(handle, rawState)
      this.activeHandles.add(handle)
      return handle
    } catch (err) {
      if (context !== null) await context.close().catch(() => undefined)
      throw err
    }
  }

  /** Liveness probe before handing out the handle (102 §8.4). */
  private async healthCheck(page: Page): Promise<void> {
    const probe = page.evaluate(() => 1 + 1)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new BrowserAcquisitionError('Health check timed out')),
        this.options.healthCheckTimeoutMs,
      ),
    )
    const result = await Promise.race([probe, timeout])
    if (result !== 2) throw new BrowserAcquisitionError('Health check returned an unexpected result')
  }

  /** Shared in-flight launch: N concurrent callers → exactly one launch (102 §10.2). */
  private ensureBrowser(): Promise<Browser> {
    if (this.warmBrowser !== null && this.warmBrowser.isConnected()) {
      return Promise.resolve(this.warmBrowser)
    }
    if (this.inFlightLaunch !== null) return this.inFlightLaunch

    const launch = browserTypeFor(this.options.engine)
      .launch({
        headless: this.options.headless,
        args: buildLaunchArgs(this.options.engine, this.options.sandboxPolicy),
        timeout: this.options.launchTimeoutMs,
      })
      .then((browser) => {
        this.coldStarts += 1
        this.warmBrowser = browser
        this.inFlightLaunch = null
        browser.on('disconnected', () => {
          if (this.warmBrowser === browser) this.warmBrowser = null
        })
        return browser
      })
      .catch((err: unknown) => {
        this.inFlightLaunch = null
        throw new BrowserAcquisitionError('Browser launch failed', { cause: err })
      })
    this.inFlightLaunch = launch
    return launch
  }

  private async discardWarmBrowser(): Promise<void> {
    const browser = this.warmBrowser
    this.warmBrowser = null
    if (browser !== null) await browser.close().catch(() => undefined)
  }
}
