/**
 * Extraction pipeline orchestration (docs/tasks/011, M3).
 *
 * Per viewport: BrowserManager → [startCoverage if coverage/hybrid] →
 * navigate → collect → classifyVisibility → matcher/coverage → hybrid
 * reconcile → FixedPointResolver → per-viewport MergedRule[]. Then
 * mergeViewports across profiles → serialize. Reporter builds the four M3
 * reports (+ the M5 extraction trace, docs/design/1003-Tracing.md) from each
 * viewport's terminal outputs; `withSerializationStage` (@critical-css/
 * reporter) then attaches the one cross-viewport stage — serialization,
 * timed here — into every viewport's trace. Six plugin hook seams dispatched
 * in order (ADR-0004).
 *
 * CSS payload is the ONLY thing that reaches stdout; diagnostics → stderr.
 */

import { BrowserManager, BUILT_IN_PROFILES } from '@critical-css/browser'
import type { PageHandle } from '@critical-css/browser'
import { atRuleChainOf, classifyVisibility, collect, matchableNodeIds } from '@critical-css/collector'
import type { CollectorDiagnosticRecord, CssomRuleList, RuleNode } from '@critical-css/collector'
import { CoverageCollector } from '@critical-css/coverage'
import { coverageOnlyRules, FixedPointResolver, reconcileHybrid } from '@critical-css/dependency-graph'
import { SelectorMatcher } from '@critical-css/matcher'
import type { CssomRuleMatch, MatchedRuleSet } from '@critical-css/matcher'
import {
  buildPluginRegistry,
  PluginDispatcher,
  type AfterCollectionPatch,
  type AfterNavigationPatch,
  type AfterSerializePatch,
  type BeforeCollectionPatch,
  type BeforeLaunchPatch,
  type BeforeSerializePatch,
  type Plugin,
} from '@critical-css/plugins'
import { Reporter, withSerializationStage } from '@critical-css/reporter'
import type { ReportBundle } from '@critical-css/reporter'
import {
  DEFAULT_SERIALIZER_CONFIG,
  mergeViewports,
  serialize,
  toInlineStyle,
  toJsonEnvelope,
  type MergedRule,
  type OutputFormat,
  type PerViewportRuleSet,
  type ViewportBand,
} from '@critical-css/serializer'
import { DEFAULT_VISIBILITY_CONFIG, fnv1a64 } from '@critical-css/shared'
import type {
  Diagnostic,
  ExtractionMode,
  SandboxPolicy,
  StageTiming,
  ViewportProfile,
  VisibilityConfig,
} from '@critical-css/shared'

export const ENGINE_VERSION = '0.1.0'

export type ViewportName = 'desktop' | 'tablet' | 'mobile'

export interface ExtractRequest {
  readonly url: string
  /** One or more viewports; multi-viewport runs each independently and merges. */
  readonly viewports?: readonly ViewportName[]
  /** Back-compat single-viewport alias. */
  readonly viewport?: ViewportName
  readonly mode?: ExtractionMode
  readonly minify?: boolean
  readonly format?: OutputFormat
  readonly plugins?: readonly Plugin<unknown>[]
  /** Chromium sandbox launch policy (101 §8.8). Defaults to `'full'`. */
  readonly sandboxPolicy?: SandboxPolicy
  /**
   * Reuse a caller-owned BrowserManager across multiple extract() calls
   * (route-manifest batches, BI-11.3). When provided, extract() does NOT
   * tear it down — the caller owns its lifecycle. When absent, behavior is
   * unchanged: a private manager is created and torn down per call.
   */
  readonly browserManager?: BrowserManager
}

export interface ExtractOutcome {
  readonly output: string
  readonly css: string
  readonly diagnostics: readonly Diagnostic[]
  readonly reports: readonly ReportBundle[]
  readonly stats: {
    readonly mode: ExtractionMode
    readonly viewports: readonly string[]
    readonly matchedRules: number
    readonly mergedRules: number
    readonly dependencies: number
  }
}

interface ViewportExtraction {
  readonly perViewport: PerViewportRuleSet
  readonly diagnostics: readonly Diagnostic[]
  readonly report: ReportBundle
  readonly matchedCount: number
}

function toMergedRule(
  match: CssomRuleMatch,
  viewportProfileId: string,
  layerOrder: number | null,
): MergedRule {
  return {
    selectorText: match.selectorText,
    declarationText: match.declarationText,
    origin: 'author',
    layerOrder,
    atRuleChain: match.atRuleChain,
    contributingViewports: [viewportProfileId],
    stylesheetIndex: match.stylesheetIndex,
    ruleIndex: match.ruleIndexPath,
  }
}

/**
 * B1: the CSSOM walker (packages/collector/src/cssom-walker/cssom-walker.ts)
 * emits real `CollectorDiagnosticRecord`s (`CROSS_ORIGIN_STYLESHEET_SKIPPED`,
 * `CSSOM_WALK_ERROR`, `UNKNOWN_GROUPING_RULE`, `IMPORT_SHEET_UNAVAILABLE`,
 * `CIRCULAR_IMPORT`) attached per-stylesheet on `CssomRuleList.stylesheets[].
 * diagnostics` (plus a walk-level `CssomRuleList.diagnostics`, currently
 * always empty but included here for forward compatibility) — but nothing
 * ever read them, so they silently never reached `ExtractOutcome.diagnostics`.
 * Severities mirror how comparable conditions are already classified
 * elsewhere in this function (a truly-inaccessible/unreadable source is
 * `warning`; a walked-but-not-fully-modeled construct is `info`).
 */
function severityForCssomDiagnostic(code: string): 'info' | 'warning' | 'error' {
  switch (code) {
    case 'UNKNOWN_GROUPING_RULE':
      return 'info'
    case 'CROSS_ORIGIN_STYLESHEET_SKIPPED':
    case 'CSSOM_WALK_ERROR':
    case 'IMPORT_SHEET_UNAVAILABLE':
    case 'CIRCULAR_IMPORT':
      return 'warning'
    default:
      return 'warning'
  }
}

function toCssomDiagnostic(record: CollectorDiagnosticRecord, stylesheetIndex?: number): Diagnostic {
  return {
    severity: severityForCssomDiagnostic(record.code),
    code: record.code,
    message: record.message,
    source: { url: record.href },
    ...(stylesheetIndex !== undefined ? { context: { stylesheetIndex } } : {}),
  }
}

/** Folds every CSSOM-walk diagnostic (per-stylesheet + walk-level) into the shared Diagnostic shape (B1). */
function cssomDiagnostics(cssom: CssomRuleList): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const sheet of cssom.stylesheets) {
    for (const record of sheet.diagnostics) out.push(toCssomDiagnostic(record, sheet.sourceStylesheetIndex))
  }
  for (const record of cssom.diagnostics) out.push(toCssomDiagnostic(record))
  return out
}

/** A coverage-only RuleNode expressed as a matcher-shaped record for the resolver + output. */
function ruleNodeToMatch(rule: RuleNode, cssom: CssomRuleList): CssomRuleMatch {
  const sheet = cssom.stylesheets.find((s) => s.sourceStylesheetIndex === rule.sourceStylesheetIndex)
  const byId = sheet !== undefined ? new Map(sheet.rules.map((r) => [r.ruleId, r])) : new Map<number, RuleNode>()
  return {
    stylesheetIndex: rule.sourceStylesheetIndex,
    ruleIndexPath: rule.ruleIndexPath,
    selectorText: rule.selectorText ?? '',
    matchedSelectorBranches: [rule.selectorText ?? ''],
    matchedNodeIds: [],
    declarationText: rule.declarationText,
    atRuleChain: atRuleChainOf(rule, byId),
  }
}

async function extractViewport(
  manager: BrowserManager,
  request: ExtractRequest,
  profileName: ViewportName,
  dispatcher: PluginDispatcher,
): Promise<ViewportExtraction> {
  const profile: ViewportProfile = BUILT_IN_PROFILES[profileName]
  const mode: ExtractionMode = request.mode ?? 'cssom'
  const diagnostics: Diagnostic[] = []
  const timing: StageTiming[] = []
  const time = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now()
    const result = await fn()
    timing.push({ stage, elapsedMs: Date.now() - start })
    return result
  }
  // runId must uniquely identify THIS route+viewport work-unit (A1): deriving
  // it from the viewport profile name alone made two different routes run at
  // the same viewport (a normal same-batch occurrence, apps/cli route
  // manifests) produce identical runId → identical traceId → identical
  // run-span spanId (packages/reporter/src/trace.ts). Folding `request.url`
  // in fixes that. Content-derived (route + viewport), not
  // `Date.now()`/`Math.random()`: those would make the trace non-reproducible
  // for the SAME route+viewport across rebuilds, which packages/reporter's
  // own tests assert on (trace.test.ts "deterministic ... traceId"/"spanIds
  // are deterministic"). No golden test compares runId/traceId byte-for-byte
  // against a literal — goldens only pin `outcome.css` — so this stays free
  // to change.
  const base = { route: request.url, viewport: profile, runId: `run-${request.url}-${profileName}` }

  // beforeLaunch
  let effectiveProfile = profile
  {
    const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeLaunchPatch>(
      'beforeLaunch',
      (hb) => ({ ...hb, ...base, proposedLaunchOptions: { headless: true, userAgent: profile.userAgent } }) as never,
    )
    diagnostics.push(...d)
    for (const { patch } of patches) {
      const ua = patch.launchOptionsOverride?.userAgent
      if (ua !== undefined) effectiveProfile = { ...effectiveProfile, userAgent: ua }
    }
  }

  const handle = await manager.acquire(effectiveProfile)
  // Declared outside the try so the finally can stop a started-but-unstopped
  // session on any error path (defensive; context teardown also disposes it).
  let coverageSession: Awaited<ReturnType<PageHandle['startCoverage']>> | null = null
  let coverageStopped = false
  try {
    // Coverage must start before navigation (700). Degrade to CSSOM if the
    // engine lacks coverage support rather than failing the run.
    let effectiveMode = mode
    if (mode === 'coverage' || mode === 'hybrid') {
      try {
        coverageSession = await handle.startCoverage()
      } catch (err) {
        effectiveMode = 'cssom'
        diagnostics.push({
          severity: 'info',
          code: 'RUNNING_WITHOUT_COVERAGE_SIGNAL',
          message: `Coverage unavailable (${err instanceof Error ? err.message : String(err)}); degraded to CSSOM for ${profileName}`,
        })
      }
    }

    const navigation = await time('navigate', () => handle.navigate(request.url))
    diagnostics.push(...navigation.stabilization.diagnostics)
    if (navigation.statusCode !== null && navigation.statusCode >= 400) {
      diagnostics.push({
        severity: 'warning',
        code: 'HTTP_ERROR_STATUS',
        message: `Navigation resolved with HTTP ${navigation.statusCode} — extracted CSS describes the error page`,
        source: { url: navigation.finalUrl },
      })
    }

    // afterNavigation
    {
      const { patches, diagnostics: d } = await dispatcher.runHook<never, AfterNavigationPatch>(
        'afterNavigation',
        (hb) =>
          ({
            ...hb,
            ...base,
            navigationResult: {
              finalUrl: navigation.finalUrl,
              statusCode: navigation.statusCode,
              stable: navigation.stabilization.stable,
            },
          }) as never,
      )
      diagnostics.push(...d)
      for (const { patch } of patches) diagnostics.push(...(patch.diagnostics ?? []))
    }

    // beforeCollection (visibility policy + ignored selectors)
    let visibilityConfig: VisibilityConfig = DEFAULT_VISIBILITY_CONFIG
    const ignoredSelectors: string[] = []
    {
      const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeCollectionPatch>(
        'beforeCollection',
        (hb, earlier) => {
          let policy = DEFAULT_VISIBILITY_CONFIG
          const ignored: string[] = []
          for (const { patch } of earlier) {
            if (patch.visibilityPolicyOverride) policy = { ...policy, ...patch.visibilityPolicyOverride }
            ignored.push(...(patch.ignoredSelectors ?? []))
          }
          return { ...hb, ...base, currentVisibilityPolicy: policy, currentIgnoredSelectors: ignored } as never
        },
      )
      diagnostics.push(...d)
      for (const { patch } of patches) {
        if (patch.visibilityPolicyOverride) visibilityConfig = { ...visibilityConfig, ...patch.visibilityPolicyOverride }
        ignoredSelectors.push(...(patch.ignoredSelectors ?? []))
      }
    }

    const collection = await time('collect', () => collect(handle))
    // B1: surface the 5 real CSSOM-walk diagnostic codes (cross-origin sheets,
    // per-rule read failures, unmodeled grouping rules, broken/circular
    // @import) that the collector produces but previously never reached the
    // emitted Diagnostic stream.
    diagnostics.push(...cssomDiagnostics(collection.cssom))
    // Visibility classification only feeds the matcher's candidate set — skip
    // it entirely in coverage-only mode (ADR-0005: no CSSOM matching there).
    let allowed: readonly number[] = []
    if (effectiveMode !== 'coverage') {
      const annotated = classifyVisibility(collection.dom.snapshot, collection.snapshotId, visibilityConfig)
      allowed = [...matchableNodeIds(collection.dom.snapshot, annotated, visibilityConfig)]
    }

    // CSSOM matching (skipped for coverage-only).
    let matched: MatchedRuleSet = {
      snapshotId: collection.snapshotId,
      viewportProfileId: effectiveProfile.name,
      strategy: 'cssom',
      matches: [],
      diagnostics: [],
    }
    if (effectiveMode !== 'coverage') {
      matched = await time('match', () =>
        new SelectorMatcher().matchRules(handle, collection.dom, collection.cssom, effectiveProfile.name, allowed),
      )
      diagnostics.push(...matched.diagnostics)
    }

    // Stop coverage + map (after collection so the page is still live).
    let extraSeedRules: readonly RuleNode[] = []
    let includedMatches: CssomRuleMatch[] = matched.matches.filter((m) => !ignoredSelectors.includes(m.selectorText))

    if (coverageSession !== null) {
      const raw = await coverageSession.stop()
      coverageStopped = true
      const coverageResult = await new CoverageCollector().collect(handle, raw)
      diagnostics.push(...coverageResult.diagnostics)
      if (effectiveMode === 'coverage') {
        includedMatches = coverageOnlyRules(coverageResult, collection.cssom).map((r) =>
          ruleNodeToMatch(r, collection.cssom),
        )
      } else if (effectiveMode === 'hybrid') {
        const reconciliation = reconcileHybrid(matched, coverageResult, collection.cssom)
        diagnostics.push(...reconciliation.diagnostics)
        // Fidelity bias: output = every CSSOM match; provisionalExclude rules
        // feed dependency resolution only.
        extraSeedRules = reconciliation.provisionalExcludeRules
      }
    }

    // afterCollection (exclude / force-include)
    {
      const { patches, diagnostics: d } = await dispatcher.runHook<never, AfterCollectionPatch>(
        'afterCollection',
        (hb) => ({ ...hb, ...base, matchedSelectors: includedMatches.map((m) => m.selectorText), diagnostics }) as never,
      )
      diagnostics.push(...d)
      for (const { patch } of patches) {
        if (patch.excludeSelectors) {
          includedMatches = includedMatches.filter((m) => !(patch.excludeSelectors as string[]).includes(m.selectorText))
        }
        for (const forced of patch.forceIncludeSelectors ?? []) {
          for (const sheet of collection.cssom.stylesheets) {
            if (!sheet.accessible || sheet.disabled) continue
            const byId = new Map(sheet.rules.map((r) => [r.ruleId, r]))
            for (const rule of sheet.rules) {
              if (rule.ruleType === 'style' && rule.selectorText === forced) {
                includedMatches.push({
                  stylesheetIndex: sheet.sourceStylesheetIndex,
                  ruleIndexPath: rule.ruleIndexPath,
                  selectorText: rule.selectorText,
                  matchedSelectorBranches: [forced],
                  matchedNodeIds: [],
                  declarationText: rule.declarationText,
                  atRuleChain: atRuleChainOf(rule, byId),
                })
              }
            }
          }
        }
      }
    }

    // Dependency resolution.
    const resolution = await time('resolve', () =>
      Promise.resolve(
        new FixedPointResolver().resolve(
          { ...matched, matches: includedMatches },
          collection.cssom,
          undefined,
          extraSeedRules,
        ),
      ),
    )
    diagnostics.push(...resolution.diagnostics)

    const layerOf = (chain: readonly { kind: string; conditionText: string }[]): number | null => {
      const layers = chain.filter((c) => c.kind === 'layer')
      if (layers.length === 0) return null
      return resolution.layerRegistry.rankOf(layers[layers.length - 1]?.conditionText ?? null)
    }

    const mergedRules: MergedRule[] = includedMatches.map((m) =>
      toMergedRule(m, effectiveProfile.name, layerOf(m.atRuleChain)),
    )
    for (const transitive of resolution.transitiveRules) {
      mergedRules.push({
        selectorText: transitive.rule.selectorText ?? '',
        declarationText: transitive.rule.declarationText,
        origin: 'author',
        layerOrder: layerOf(transitive.atRuleChain),
        atRuleChain: transitive.atRuleChain,
        contributingViewports: [effectiveProfile.name],
        stylesheetIndex: transitive.stylesheetIndex,
        ruleIndex: transitive.rule.ruleIndexPath,
      })
    }

    // beforeSerialize (rewrite / inject / exclude) — applied per viewport.
    let finalRules = mergedRules
    {
      const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeSerializePatch>(
        'beforeSerialize',
        (hb) =>
          ({
            ...hb,
            ...base,
            currentIncludedRules: finalRules.map((r) => ({ selectorText: r.selectorText, declarationText: r.declarationText })),
          }) as never,
      )
      diagnostics.push(...d)
      for (const { patch } of patches) {
        for (const rewrite of patch.rewriteRules ?? []) {
          finalRules = finalRules.map((r) =>
            r.selectorText === rewrite.selectorText ? { ...r, declarationText: rewrite.newDeclarationText } : r,
          )
        }
        if (patch.excludeSelectors) {
          finalRules = finalRules.filter((r) => !(patch.excludeSelectors as string[]).includes(r.selectorText))
        }
        for (const injected of patch.injectRules ?? []) {
          // Content-derived identity: identical injections across viewports
          // dedup + union contributingViewports; distinct injected content
          // stays distinct (never collides on a per-viewport counter).
          const hash = Number.parseInt(fnv1a64(`${injected.selectorText}\n${injected.declarationText}`).slice(0, 13), 16)
          finalRules.push({
            selectorText: injected.selectorText,
            declarationText: injected.declarationText,
            origin: 'author',
            layerOrder: null,
            atRuleChain: [],
            contributingViewports: [effectiveProfile.name],
            stylesheetIndex: 1_000_000,
            ruleIndex: [hash],
          })
        }
      }
    }

    const report = new Reporter().build({
      route: request.url,
      viewportProfileId: effectiveProfile.name,
      mode: effectiveMode,
      cssom: collection.cssom,
      matched: includedMatches,
      manifest: resolution.manifest,
      graph: resolution.graph,
      timing,
      runId: base.runId,
    })

    return {
      perViewport: {
        viewportProfileId: effectiveProfile.name,
        rules: finalRules,
        dependencyManifest: resolution.manifest,
        layerDeclarationOrder: resolution.layerRegistry.declarationOrder,
      },
      diagnostics,
      report,
      matchedCount: includedMatches.length,
    }
  } finally {
    // Stop a started-but-unstopped coverage session on any error path before
    // the page is released.
    if (coverageSession !== null && !coverageStopped) {
      await coverageSession.stop().catch(() => undefined)
    }
    await manager.release(handle)
  }
}

export async function extract(request: ExtractRequest): Promise<ExtractOutcome> {
  const viewports: readonly ViewportName[] =
    request.viewports ?? [request.viewport ?? 'desktop']
  const mode: ExtractionMode = request.mode ?? 'cssom'
  const registry = buildPluginRegistry(request.plugins ?? [])
  const dispatcher = new PluginDispatcher(registry)

  const diagnostics: Diagnostic[] = [...registry.diagnostics]
  const ownsManager = request.browserManager === undefined
  const manager =
    request.browserManager ??
    new BrowserManager({
      maxConcurrency: 1,
      ...(request.sandboxPolicy !== undefined ? { sandboxPolicy: request.sandboxPolicy } : {}),
    })
  const extractions: ViewportExtraction[] = []
  try {
    for (const profileName of viewports) {
      const result = await extractViewport(manager, request, profileName, dispatcher)
      extractions.push(result)
      diagnostics.push(...result.diagnostics)
    }
  } finally {
    if (ownsManager) await manager.teardown()
  }

  const bands: ViewportBand[] = viewports.map((v) => ({
    viewportProfileId: BUILT_IN_PROFILES[v].name,
    width: BUILT_IN_PROFILES[v].width,
  }))
  const merged = mergeViewports(
    extractions.map((e) => e.perViewport),
    bands,
  )
  // Serialization is genuinely cross-viewport (it runs once, after merging
  // all viewports' rule sets) — no single viewport's Reporter.build() call
  // ever observes it, so it is timed here and attached to each viewport's
  // extraction trace afterward (see withSerializationStage's doc comment).
  const serializeStart = Date.now()
  const artifact = serialize(merged, {
    ...DEFAULT_SERIALIZER_CONFIG,
    minify: request.minify ?? false,
    format: request.format ?? 'raw-css',
  })
  const serializeElapsedMs = Date.now() - serializeStart
  const serializeAssembledAt = Date.now()
  const reports = extractions.map((e) => withSerializationStage(e.report, serializeElapsedMs, serializeAssembledAt))

  const output =
    artifact.format === 'inline-style'
      ? toInlineStyle(artifact, { 'data-route': request.url })
      : artifact.format === 'json-envelope'
        ? toJsonEnvelope(artifact, {
            route: request.url,
            viewport: viewports.join('+'),
            extractionMode: mode,
            engineVersion: ENGINE_VERSION,
          })
        : artifact.css

  return {
    output,
    css: artifact.css,
    diagnostics,
    reports,
    stats: {
      mode,
      viewports: [...viewports],
      matchedRules: extractions.reduce((sum, e) => sum + e.matchedCount, 0),
      mergedRules: artifact.stats.ruleCount,
      dependencies: artifact.stats.dependencyCount,
    },
  }
}
