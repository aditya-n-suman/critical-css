/**
 * Extraction pipeline orchestration (docs/tasks/011, M2):
 * BrowserManager → navigate → [visibility policy via plugins] → collect →
 * classifyVisibility → SelectorMatcher → FixedPointResolver → serialize,
 * with the six plugin hook seams dispatched in order (ADR-0004).
 *
 * CSS payload is the ONLY thing that reaches stdout; diagnostics → stderr.
 */

import { BrowserManager, BUILT_IN_PROFILES } from '@critical-css/browser'
import { atRuleChainOf, classifyVisibility, collect, matchableNodeIds } from '@critical-css/collector'
import { FixedPointResolver } from '@critical-css/dependency-graph'
import { SelectorMatcher } from '@critical-css/matcher'
import type { CssomRuleMatch } from '@critical-css/matcher'
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
import { DEFAULT_SERIALIZER_CONFIG, serialize, toInlineStyle, toJsonEnvelope } from '@critical-css/serializer'
import type { MergedRule, OutputFormat } from '@critical-css/serializer'
import { DEFAULT_VISIBILITY_CONFIG } from '@critical-css/shared'
import type { Diagnostic, ViewportProfile, VisibilityConfig } from '@critical-css/shared'

const ENGINE_VERSION = '0.1.0'

export interface ExtractRequest {
  readonly url: string
  readonly viewport: 'desktop' | 'tablet' | 'mobile'
  readonly minify?: boolean
  readonly format?: OutputFormat
  readonly plugins?: readonly Plugin<unknown>[]
}

export interface ExtractOutcome {
  /** Payload in the requested output format (606: all derived from one rule set). */
  readonly output: string
  readonly css: string
  readonly diagnostics: readonly Diagnostic[]
  readonly stats: {
    readonly matchedRules: number
    readonly transitiveRules: number
    readonly dependencies: number
    readonly visibleNodes: number
    readonly totalNodes: number
  }
}

function toMergedRule(match: CssomRuleMatch, viewportProfileId: string, layerOrder: number | null): MergedRule {
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

export async function extract(request: ExtractRequest): Promise<ExtractOutcome> {
  const profile: ViewportProfile = BUILT_IN_PROFILES[request.viewport]
  const diagnostics: Diagnostic[] = []
  const registry = buildPluginRegistry(request.plugins ?? [])
  diagnostics.push(...registry.diagnostics)
  const dispatcher = new PluginDispatcher(registry)
  const runId = `run-${request.viewport}`
  const base = { route: request.url, viewport: profile, runId }

  // ── beforeLaunch ─────────────────────────────────────────────────────
  let effectiveProfile = profile
  {
    const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeLaunchPatch>(
      'beforeLaunch',
      (hookBase) =>
        ({
          ...hookBase,
          ...base,
          proposedLaunchOptions: { headless: true, userAgent: profile.userAgent },
        }) as never,
    )
    diagnostics.push(...d)
    for (const { patch } of patches) {
      const ua = patch.launchOptionsOverride?.userAgent
      if (ua !== undefined) effectiveProfile = { ...effectiveProfile, userAgent: ua }
    }
  }

  const manager = new BrowserManager({ maxConcurrency: 1 })
  try {
    const handle = await manager.acquire(effectiveProfile)
    try {
      const navigation = await handle.navigate(request.url)
      diagnostics.push(...navigation.stabilization.diagnostics)
      if (navigation.statusCode !== null && navigation.statusCode >= 400) {
        diagnostics.push({
          severity: 'warning',
          code: 'HTTP_ERROR_STATUS',
          message: `Navigation resolved with HTTP ${navigation.statusCode} — the extracted CSS describes the error page, not the intended route`,
          source: { url: navigation.finalUrl },
        })
      }

      // ── afterNavigation ────────────────────────────────────────────
      {
        const { patches, diagnostics: d } = await dispatcher.runHook<never, AfterNavigationPatch>(
          'afterNavigation',
          (hookBase) =>
            ({
              ...hookBase,
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

      // ── beforeCollection ───────────────────────────────────────────
      let visibilityConfig: VisibilityConfig = DEFAULT_VISIBILITY_CONFIG
      const ignoredSelectors: string[] = []
      {
        const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeCollectionPatch>(
          'beforeCollection',
          (hookBase, earlier) => {
            let policy = DEFAULT_VISIBILITY_CONFIG
            const ignored: string[] = []
            for (const { patch } of earlier) {
              if (patch.visibilityPolicyOverride) policy = { ...policy, ...patch.visibilityPolicyOverride }
              ignored.push(...(patch.ignoredSelectors ?? []))
            }
            return {
              ...hookBase,
              ...base,
              currentVisibilityPolicy: policy,
              currentIgnoredSelectors: ignored,
            } as never
          },
        )
        diagnostics.push(...d)
        for (const { patch } of patches) {
          if (patch.visibilityPolicyOverride) {
            visibilityConfig = { ...visibilityConfig, ...patch.visibilityPolicyOverride }
          }
          ignoredSelectors.push(...(patch.ignoredSelectors ?? []))
        }
      }

      const collection = await collect(handle)
      const annotated = classifyVisibility(collection.dom.snapshot, collection.snapshotId, visibilityConfig)
      const allowed = matchableNodeIds(collection.dom.snapshot, annotated, visibilityConfig)
      const visibleCount = annotated.annotations.filter((a) => a.isVisible).length

      const matched = await new SelectorMatcher().matchRules(
        handle,
        collection.dom,
        collection.cssom,
        effectiveProfile.name,
        [...allowed],
      )
      diagnostics.push(...matched.diagnostics)

      // ── afterCollection ────────────────────────────────────────────
      let matches = matched.matches.filter((m) => !ignoredSelectors.includes(m.selectorText))
      {
        const { patches, diagnostics: d } = await dispatcher.runHook<never, AfterCollectionPatch>(
          'afterCollection',
          (hookBase) =>
            ({
              ...hookBase,
              ...base,
              matchedSelectors: matches.map((m) => m.selectorText),
              diagnostics,
            }) as never,
        )
        diagnostics.push(...d)
        for (const { patch } of patches) {
          if (patch.excludeSelectors) {
            matches = matches.filter((m) => !(patch.excludeSelectors as string[]).includes(m.selectorText))
          }
          for (const forced of patch.forceIncludeSelectors ?? []) {
            for (const sheet of collection.cssom.stylesheets) {
              // Same eligibility the matcher applies: disabled/inaccessible
              // sheets are never applied by the browser.
              if (!sheet.accessible || sheet.disabled) continue
              const byId = new Map(sheet.rules.map((r) => [r.ruleId, r]))
              for (const rule of sheet.rules) {
                if (rule.ruleType === 'style' && rule.selectorText === forced) {
                  matches = [
                    ...matches,
                    {
                      stylesheetIndex: sheet.sourceStylesheetIndex,
                      ruleIndexPath: rule.ruleIndexPath,
                      selectorText: rule.selectorText,
                      matchedSelectorBranches: [forced],
                      matchedNodeIds: [],
                      declarationText: rule.declarationText,
                      // Real wrapper chain — a forced rule inside @media must
                      // stay inside its @media (601 §8.3).
                      atRuleChain: atRuleChainOf(rule, byId),
                    },
                  ]
                }
              }
            }
          }
        }
      }

      // ── dependency resolution (AT-06) ──────────────────────────────
      const resolution = new FixedPointResolver().resolve(
        { ...matched, matches },
        collection.cssom,
      )
      diagnostics.push(...resolution.diagnostics)

      const layerOf = (chain: readonly { kind: string; conditionText: string }[]): number | null => {
        const layers = chain.filter((c) => c.kind === 'layer')
        if (layers.length === 0) return null
        return resolution.layerRegistry.rankOf(layers[layers.length - 1]?.conditionText ?? null)
      }

      let mergedRules: MergedRule[] = matches.map((m) =>
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

      // ── beforeSerialize ────────────────────────────────────────────
      {
        const { patches, diagnostics: d } = await dispatcher.runHook<never, BeforeSerializePatch>(
          'beforeSerialize',
          (hookBase) =>
            ({
              ...hookBase,
              ...base,
              currentIncludedRules: mergedRules.map((r) => ({
                selectorText: r.selectorText,
                declarationText: r.declarationText,
              })),
            }) as never,
        )
        diagnostics.push(...d)
        let injectedIndex = 0
        for (const { patch } of patches) {
          for (const rewrite of patch.rewriteRules ?? []) {
            mergedRules = mergedRules.map((r) =>
              r.selectorText === rewrite.selectorText
                ? { ...r, declarationText: rewrite.newDeclarationText }
                : r,
            )
          }
          if (patch.excludeSelectors) {
            mergedRules = mergedRules.filter(
              (r) => !(patch.excludeSelectors as string[]).includes(r.selectorText),
            )
          }
          for (const injected of patch.injectRules ?? []) {
            // Stable synthetic index — injected rules sort last, deterministically
            // (006 canonical-ordering failure case).
            mergedRules.push({
              selectorText: injected.selectorText,
              declarationText: injected.declarationText,
              origin: 'author',
              layerOrder: null,
              atRuleChain: [],
              contributingViewports: [effectiveProfile.name],
              stylesheetIndex: 1_000_000,
              ruleIndex: [injectedIndex],
            })
            injectedIndex += 1
          }
        }
      }

      const artifact = serialize(
        {
          rules: mergedRules,
          dependencyManifest: resolution.manifest,
          layerDeclarationOrder: resolution.layerRegistry.declarationOrder,
        },
        {
          ...DEFAULT_SERIALIZER_CONFIG,
          minify: request.minify ?? false,
          format: request.format ?? 'raw-css',
        },
      )

      // ── afterSerialize ─────────────────────────────────────────────
      {
        const { patches, diagnostics: d } = await dispatcher.runHook<never, AfterSerializePatch>(
          'afterSerialize',
          (hookBase) =>
            ({
              ...hookBase,
              ...base,
              css: artifact.css,
              stats: { ruleCount: artifact.stats.ruleCount, byteLength: artifact.stats.byteLength },
            }) as never,
        )
        diagnostics.push(...d)
        for (const { patch } of patches) diagnostics.push(...(patch.diagnostics ?? []))
      }

      const output =
        artifact.format === 'inline-style'
          ? toInlineStyle(artifact, { 'data-route': request.url, 'data-viewport': effectiveProfile.name })
          : artifact.format === 'json-envelope'
            ? toJsonEnvelope(artifact, {
                route: request.url,
                viewport: effectiveProfile.name,
                extractionMode: 'cssom',
                engineVersion: ENGINE_VERSION,
              })
            : artifact.css

      return {
        output,
        css: artifact.css,
        diagnostics,
        stats: {
          matchedRules: matches.length,
          transitiveRules: resolution.transitiveRules.length,
          dependencies: resolution.manifest.length,
          visibleNodes: visibleCount,
          totalNodes: collection.dom.snapshot.nodes.length,
        },
      }
    } finally {
      await manager.release(handle)
    }
  } finally {
    await manager.teardown()
  }
}
