/**
 * Extraction pipeline orchestration (docs/tasks/011-Implement-CLI.md, M1 MVP):
 * BrowserManager → collect (DOM + CSSOM) → SelectorMatcher → serialize.
 *
 * CSS payload is the ONLY thing that reaches stdout; diagnostics go to
 * stderr (Principle 6 / golden-capture discipline).
 */

import { BrowserManager, BUILT_IN_PROFILES } from '@critical-css/browser'
import { collect } from '@critical-css/collector'
import { SelectorMatcher } from '@critical-css/matcher'
import type { CssomRuleMatch } from '@critical-css/matcher'
import { serialize } from '@critical-css/serializer'
import type { MergedRule } from '@critical-css/serializer'
import type { Diagnostic, ViewportProfile } from '@critical-css/shared'

export interface ExtractRequest {
  readonly url: string
  readonly viewport: 'desktop' | 'tablet' | 'mobile'
}

export interface ExtractOutcome {
  readonly css: string
  readonly diagnostics: readonly Diagnostic[]
  readonly stats: { readonly matchedRules: number; readonly aboveFoldNodes: number }
}

function toMergedRule(match: CssomRuleMatch, viewportProfileId: string): MergedRule {
  return {
    selectorText: match.selectorText,
    declarationText: match.declarationText,
    origin: 'author',
    layerOrder: null, // @layer rank resolution is M2 (dependency-graph)
    atRuleChain: match.atRuleChain,
    contributingViewports: [viewportProfileId],
    stylesheetIndex: match.stylesheetIndex,
    ruleIndex: match.ruleIndexPath,
  }
}

/**
 * Single-URL, single-viewport extraction (M1). Single-viewport runs the
 * identical merge/serialize code path as multi-viewport (016 §12) — the
 * merge is an identity with one contributor.
 */
export async function extract(request: ExtractRequest): Promise<ExtractOutcome> {
  const profile: ViewportProfile = BUILT_IN_PROFILES[request.viewport]
  const manager = new BrowserManager({ maxConcurrency: 1 })
  const diagnostics: Diagnostic[] = []
  try {
    const handle = await manager.acquire(profile)
    try {
      const navigation = await handle.navigate(request.url)
      diagnostics.push(...navigation.stabilization.diagnostics)
      // An HTTP error page still renders and extracts "successfully" — make
      // sure nobody ships a 404 template's critical CSS unknowingly.
      if (navigation.statusCode !== null && navigation.statusCode >= 400) {
        diagnostics.push({
          severity: 'warning',
          code: 'HTTP_ERROR_STATUS',
          message: `Navigation resolved with HTTP ${navigation.statusCode} — the extracted CSS describes the error page, not the intended route`,
          source: { url: navigation.finalUrl },
        })
      }

      const collection = await collect(handle)
      const matched = await new SelectorMatcher().matchRules(
        handle,
        collection.dom,
        collection.cssom,
        profile.name,
      )
      diagnostics.push(...matched.diagnostics)

      const artifact = serialize({
        rules: matched.matches.map((m) => toMergedRule(m, profile.name)),
        dependencyManifest: [], // dependency resolution is M2
      })

      return {
        css: artifact.css,
        diagnostics,
        stats: {
          matchedRules: artifact.stats.ruleCount,
          aboveFoldNodes: collection.dom.snapshot.nodes.length,
        },
      }
    } finally {
      await manager.release(handle)
    }
  } finally {
    await manager.teardown()
  }
}
