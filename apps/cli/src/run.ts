/**
 * Batch orchestration for the CLI (task 011, BI-11.2/BI-11.3; BRIEF.md
 * §2.11 CI pipeline: Crawl routes → Generate critical CSS → Compare against
 * baseline → Publish artifacts).
 *
 * Work-unit sequencing per unit:
 *   CacheChecked (fingerprint + lookup, NO browser) → on miss/stale only:
 *   the full extraction pipeline (browser acquisition happens inside the
 *   `getOrProduce` produce callback — REQ-301: a hit provably never reaches
 *   `BrowserAcquired`) → CacheWritten → artifact published.
 *
 * CI semantics (REQ-451–453): every work unit in the batch is attempted;
 * failures are collected, and the nonzero exit happens only after the whole
 * batch — never on first failure.
 *
 * Exit codes: 0 success · 1 extraction error · 2 usage · 3 CI gate failed
 * (baseline growth beyond --max-growth, or missing dependencies detected
 * while --compare-baseline is active). Extraction errors take precedence
 * over gate failures.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { BrowserManager } from '@critical-css/browser'
import { createCacheEntry, type CacheEntryMeta, type RouteCache } from '@critical-css/cache'
import { ExtractionError } from '@critical-css/shared'
import type { Diagnostic, SandboxPolicy } from '@critical-css/shared'
import { compareBaseline, loadBaseline, writeBaseline, type Baseline } from './baseline.js'
import {
  buildFingerprint,
  createCacheContext,
  viewportProfileIdOf,
  type CacheContext,
} from './cache-wiring.js'
import type { Format, Mode, ViewportName } from './config.js'
import { ENGINE_VERSION, extract, type ExtractOutcome, type ExtractRequest } from './extract.js'
import { collectFingerprintInputs, InputCollectionError } from './inputs.js'
import { loadRoutes, type RouteWorkUnit } from './routes.js'

export interface RunOptions {
  readonly url: string | null
  readonly routes: string | null
  readonly baseUrl: string | null
  readonly outDir: string
  readonly output: string | null
  readonly reportOutput: string | null
  readonly viewports: readonly ViewportName[]
  readonly mode: Mode
  readonly minify: boolean
  readonly format: Format
  readonly sandboxPolicy: SandboxPolicy
  readonly cacheDir: string | null
  readonly noCache: boolean
  readonly compareBaseline: string | null
  readonly writeBaseline: string | null
  readonly maxGrowth: number
}

export interface RunIo {
  readonly stdout: (text: string) => void
  readonly stderr: (line: string) => void
}

/** Injectable seams for tests: the extract fn is the browser-launching seam. */
export interface RunDeps {
  readonly extractFn?: (request: ExtractRequest) => Promise<ExtractOutcome>
  readonly collectInputs?: typeof collectFingerprintInputs
}

interface WorkUnit {
  /** Baseline/report key: the route pattern (routes mode) or the URL. */
  readonly name: string
  readonly url: string
  /** Artifact path (routes mode); `null` = single-URL --output/stdout. */
  readonly artifactPath: string | null
  readonly route: RouteWorkUnit | null
}

interface UnitResult {
  readonly name: string
  readonly bytes: number
  readonly cacheOutcome: 'hit' | 'miss' | 'stale' | 'uncached'
  readonly missingDependencyCodes: readonly string[]
}

function formatDiagnostic(diagnostic: Diagnostic, prefix: string): string {
  const location =
    diagnostic.source?.url !== null && diagnostic.source?.url !== undefined
      ? ` (${diagnostic.source.url})`
      : ''
  return `${prefix}[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`
}

/**
 * The §2.11 missing-dependency gate must evaluate identically on a cache hit
 * and a miss, so MISSING_* diagnostics are persisted into the cache entry's
 * metadata at write time and rehydrated here on a hit. Defensive parse: the
 * entry came from disk, so an absent/malformed field degrades to [] rather
 * than throwing (802 §8.2 spirit — corruption is never an error).
 */
function persistedMissingDiagnosticsOf(meta: CacheEntryMeta): Diagnostic[] {
  const raw = meta['missingDependencyDiagnostics']
  if (!Array.isArray(raw)) return []
  const diagnostics: Diagnostic[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { code, message, severity } = item as Record<string, unknown>
    if (typeof code !== 'string' || !code.startsWith('MISSING_')) continue
    diagnostics.push({
      severity: severity === 'info' || severity === 'warning' || severity === 'error' ? severity : 'warning',
      code,
      message: typeof message === 'string' ? message : '',
    })
  }
  return diagnostics
}

/** Fail-Fast Diagnostics (Principle 6): surface the full cause chain. */
function formatErrorChain(err: unknown): string[] {
  // Render failures through the same diagnostic taxonomy as the success
  // path — stable machine-readable codes, not ad hoc Error.name strings.
  const head =
    err instanceof ExtractionError
      ? (() => {
          const diagnostic = err.toDiagnostic()
          return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`
        })()
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err)
  const lines: string[] = [head]
  let cause: unknown = err instanceof Error ? err.cause : undefined
  while (cause !== undefined) {
    lines.push(`  caused by: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`)
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return lines
}

async function runUnit(
  unit: WorkUnit,
  options: RunOptions,
  io: RunIo,
  cache: CacheContext | null,
  routeCache: RouteCache | null,
  sharedManager: BrowserManager | undefined,
  deps: Required<RunDeps>,
): Promise<UnitResult> {
  const prefix = unit.route !== null ? `route ${unit.name} — ` : ''
  const request: ExtractRequest = {
    url: unit.url,
    viewports: options.viewports,
    mode: options.mode,
    minify: options.minify,
    format: options.format,
    sandboxPolicy: options.sandboxPolicy,
    ...(sharedManager !== undefined ? { browserManager: sharedManager } : {}),
  }

  // CacheChecked — BEFORE any browser acquisition (task 011; 800 §9.1).
  // Fingerprint inputs are read over plain HTTP/file I/O (801 §8.4: hashing
  // cost ≈ reading the inputs); a fetch failure fails CLOSED to a fresh,
  // uncached extraction.
  let cacheKey: string | null = null
  if (cache !== null) {
    try {
      const inputs = await deps.collectInputs(unit.url)
      const fingerprint = buildFingerprint(inputs, options)
      cacheKey =
        routeCache !== null
          ? routeCache.resolveRouteKey(unit.url, fingerprint.hash, viewportProfileIdOf(options.viewports)).key
          : fingerprint.hash
    } catch (err) {
      if (!(err instanceof InputCollectionError)) throw err
      io.stderr(
        `${prefix}[warning] CACHE_FINGERPRINT_UNAVAILABLE: ${err.message} — extracting without cache`,
      )
    }
  }

  let freshOutcome: ExtractOutcome | null = null
  let hitEntryMeta: CacheEntryMeta | null = null
  let output: string
  let cacheOutcome: UnitResult['cacheOutcome']
  if (cache !== null && cacheKey !== null) {
    const produced = await cache.manager.getOrProduce(cacheKey, async () => {
      // MISS/STALE path only: browser acquisition lives inside this callback.
      freshOutcome = await deps.extractFn(request)
      // Persist what a hit must be able to replay without a browser: the
      // MISSING_* diagnostics that feed the §2.11 gate, and — only when this
      // run asked for --report (reports can be ~1MB, so storing them is
      // opt-in by construction) — the report bundles themselves.
      const missingDiagnostics = freshOutcome.diagnostics
        .filter((d) => d.code.startsWith('MISSING_'))
        .map((d) => ({ code: d.code, severity: d.severity, message: d.message }))
      return createCacheEntry({
        key: cacheKey as string,
        css: freshOutcome.output,
        engineVersion: ENGINE_VERSION,
        extractionMode: options.mode,
        viewportProfileId: viewportProfileIdOf(options.viewports),
        extraMeta: {
          missingDependencyDiagnostics: missingDiagnostics,
          ...(unit.route !== null ? { routePattern: unit.route.pattern } : {}),
          ...(unit.route === null && options.reportOutput !== null
            ? { reports: freshOutcome.reports }
            : {}),
        },
      })
    })
    output = produced.entry.css
    cacheOutcome = produced.outcome
    if (produced.outcome === 'hit') hitEntryMeta = produced.entry.meta
  } else {
    freshOutcome = await deps.extractFn(request)
    output = freshOutcome.output
    cacheOutcome = 'uncached'
  }

  const outcome: ExtractOutcome | null = freshOutcome
  let missingDependencyCodes: readonly string[] = []
  if (outcome !== null) {
    for (const diagnostic of outcome.diagnostics) {
      io.stderr(formatDiagnostic(diagnostic, prefix))
    }
    io.stderr(
      `${prefix}mode=${outcome.stats.mode} viewports=${outcome.stats.viewports.join('+')} — ${outcome.stats.mergedRules} merged rules, ${outcome.stats.dependencies} dependencies`,
    )
    missingDependencyCodes = outcome.diagnostics
      .filter((d) => d.code.startsWith('MISSING_'))
      .map((d) => d.code)
    if (unit.route === null && options.reportOutput !== null) {
      await writeFile(options.reportOutput, JSON.stringify(outcome.reports, null, 2), 'utf8')
    }
  } else if (hitEntryMeta !== null) {
    // Cache hit: replay the persisted MISSING_* diagnostics so the §2.11
    // gate (and the operator reading stderr) sees exactly what a fresh
    // extraction of this content saw.
    const persisted = persistedMissingDiagnosticsOf(hitEntryMeta)
    for (const diagnostic of persisted) {
      io.stderr(formatDiagnostic(diagnostic, prefix))
    }
    missingDependencyCodes = persisted.map((d) => d.code)
    if (unit.route === null && options.reportOutput !== null) {
      const persistedReports = hitEntryMeta['reports']
      if (Array.isArray(persistedReports)) {
        await writeFile(options.reportOutput, JSON.stringify(persistedReports, null, 2), 'utf8')
      } else {
        io.stderr(
          `${prefix}[warning] REPORT_UNAVAILABLE_ON_CACHE_HIT: --report skipped — the cache entry was written by a run without --report; rerun with --no-cache to regenerate the reports`,
        )
      }
    }
  }

  // Publish the artifact.
  if (unit.artifactPath !== null) {
    const target = resolve(options.outDir, unit.artifactPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, output, 'utf8')
    io.stderr(`${prefix}${cacheOutcome === 'hit' ? 'reused from cache' : 'freshly extracted'} → ${target}`)
  } else if (options.output !== null) {
    await writeFile(options.output, output, 'utf8')
  } else {
    io.stdout(output)
  }

  return {
    name: unit.name,
    bytes: Buffer.byteLength(output, 'utf8'),
    cacheOutcome,
    missingDependencyCodes,
  }
}

export async function run(options: RunOptions, io: RunIo, deps: RunDeps = {}): Promise<number> {
  const resolvedDeps: Required<RunDeps> = {
    extractFn: deps.extractFn ?? extract,
    collectInputs: deps.collectInputs ?? collectFingerprintInputs,
  }

  // Resolve the batch (validated before any browser launches, 010 §8.1).
  let units: WorkUnit[]
  let routeCache: RouteCache | null = null
  if (options.routes !== null) {
    const loaded = await loadRoutes(options.routes, options.baseUrl as string, options.outDir)
    routeCache = loaded.routeCache
    units = loaded.units.map((route) => ({
      name: route.pattern,
      url: route.url,
      artifactPath: route.outputPath,
      route,
    }))
  } else {
    units = [{ name: options.url as string, url: options.url as string, artifactPath: null, route: null }]
  }
  const baseline: Baseline | null =
    options.compareBaseline !== null ? await loadBaseline(options.compareBaseline) : null

  const cache = createCacheContext(options.cacheDir, options.noCache)

  // One BrowserManager shared across the batch (BI-11.3); launch is lazy, so
  // an all-hits batch never spawns Chromium.
  const sharedManager =
    units.length > 1
      ? new BrowserManager({ maxConcurrency: 1, sandboxPolicy: options.sandboxPolicy })
      : undefined

  const results: UnitResult[] = []
  const failures: { name: string; lines: string[] }[] = []
  try {
    for (const unit of units) {
      try {
        results.push(await runUnit(unit, options, io, cache, routeCache, sharedManager, resolvedDeps))
      } catch (err) {
        // Attempt every work unit; fail only after the whole batch (REQ-453).
        failures.push({ name: unit.name, lines: formatErrorChain(err) })
      }
    }
  } finally {
    if (sharedManager !== undefined) await sharedManager.teardown()
  }

  for (const failure of failures) {
    io.stderr(`extraction failed for ${failure.name} — ${failure.lines[0] ?? ''}`)
    for (const line of failure.lines.slice(1)) io.stderr(line)
  }

  // Cache observability (M4 exit criterion: hit/miss visible in CI output).
  if (cache !== null) {
    const hits = results.filter((r) => r.cacheOutcome === 'hit').length
    const misses = results.length - hits
    io.stderr(
      `cache: ${hits} reused from cache, ${misses} freshly extracted${options.noCache ? ' (cache disabled by --no-cache)' : ''}`,
    )
  }

  const produced: Record<string, number> = {}
  for (const result of results) produced[result.name] = result.bytes

  let gateFailed = false
  if (baseline !== null) {
    const comparison = compareBaseline(baseline, produced, options.maxGrowth)
    for (const failure of comparison.failures) {
      gateFailed = true
      io.stderr(
        `baseline: ${failure.route} grew ${failure.baselineBytes} → ${failure.producedBytes} bytes (+${failure.growthPercent.toFixed(1)}%, limit ${options.maxGrowth}%)`,
      )
    }
    for (const route of comparison.newRoutes) {
      io.stderr(`baseline: [warning] ${route} has no baseline entry — run --write-baseline to record it`)
    }
    for (const route of comparison.removedRoutes) {
      io.stderr(`baseline: [warning] ${route} is in the baseline but was not produced this run`)
    }
    // BRIEF §2.11: missing dependencies detected ⇒ fail the build.
    for (const result of results) {
      if (result.missingDependencyCodes.length > 0) {
        gateFailed = true
        io.stderr(
          `baseline: ${result.name} has missing dependencies (${[...new Set(result.missingDependencyCodes)].join(', ')})`,
        )
      }
    }
    io.stderr(gateFailed ? 'baseline: FAILED' : 'baseline: ok')
  }

  // --write-baseline happens AFTER the gate: a gate-failing run must never
  // overwrite the very baseline it just failed against (that would silently
  // ratchet the budget up and make the failure unreproducible).
  if (options.writeBaseline !== null) {
    if (failures.length > 0) {
      io.stderr('baseline: not written — the batch had extraction failures (a partial baseline would be misleading)')
    } else if (gateFailed) {
      io.stderr(
        `baseline: not written — the gate failed against ${options.compareBaseline}; refusing to overwrite the baseline with the failing sizes`,
      )
    } else {
      await writeBaseline(options.writeBaseline, produced)
      io.stderr(`baseline: wrote ${Object.keys(produced).length} route size(s) to ${options.writeBaseline}`)
    }
  }

  if (failures.length > 0) return 1
  if (gateFailed) return 3
  return 0
}
