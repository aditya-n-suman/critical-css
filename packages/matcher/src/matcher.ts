/**
 * Selector Matcher (docs/tasks/003-Implement-Selector-Matcher.md,
 * docs/design/400-Selector-Matching.md, ADR-0002).
 *
 * `element.matches(selectorText)` inside a single batched evaluate() is the
 * ONE matching primitive. Nodes are resolved via the engine-injected
 * correlation attribute stamped during DOM collection. Per-pair try/catch:
 * one unsupported selector never aborts the pass — it becomes an
 * UNSUPPORTED_SELECTOR diagnostic ("no match" ≠ "cannot evaluate").
 *
 * M1 ships the naive O(nodes × rules) baseline — memoization is 401/M2.
 */

import type { PageHandle } from '@critical-css/browser'
import { atRuleChainOf } from '@critical-css/collector'
import type { CollectedDom, CssomRuleList, RuleNode } from '@critical-css/collector'
import { CCSS_ID_ATTRIBUTE, compareRuleIndexPaths } from '@critical-css/shared'
import type { Diagnostic } from '@critical-css/shared'
import { containsDynamicPseudoClass, extractBaseSelector, splitSelectorList } from './selector-normalize.js'

export type { AtRuleCondition } from '@critical-css/shared'
import type { AtRuleCondition } from '@critical-css/shared'

export interface CssomRuleMatch {
  /** Join keys carried through unchanged (016 §11). */
  readonly stylesheetIndex: number
  readonly ruleIndexPath: readonly number[]
  /** Verbatim selector text (what the serializer emits). */
  readonly selectorText: string
  /** Which comma branches matched (bookkeeping over browser-verified results). */
  readonly matchedSelectorBranches: readonly string[]
  readonly matchedNodeIds: readonly number[]
  readonly declarationText: string
  /** Enclosing at-rule condition chain, outermost first (from the rule tree). */
  readonly atRuleChain: readonly AtRuleCondition[]
}

export interface MatchedRuleSet {
  readonly snapshotId: string
  readonly viewportProfileId: string
  readonly strategy: 'cssom'
  readonly matches: readonly CssomRuleMatch[]
  readonly diagnostics: readonly Diagnostic[]
}

interface MatchPayload {
  readonly idAttribute: string
  readonly selectors: readonly string[]
  /** Restrict probing to these nodeIds (the Visibility Engine's matchable set). */
  readonly allowedNodeIds: readonly number[] | null
}

interface ProbeResult {
  readonly ok: boolean
  readonly matchedNodeIds: readonly number[]
  readonly errorName?: string
  readonly errorMessage?: string
}

interface InPageMatchResult {
  readonly stampedElementCount: number
  readonly results: readonly ProbeResult[]
}

/** Runs in-page: evaluates every selector probe against the stamped node set.
 * Results are returned in payload order — index i corresponds to selectors[i]. */
function matchProbesInPage(payload: MatchPayload): InPageMatchResult {
  const elements = document.querySelectorAll(`[${payload.idAttribute}]`)
  const allowed = payload.allowedNodeIds !== null ? new Set(payload.allowedNodeIds) : null
  // Hoist the (element, nodeId) pairs once — not per probe.
  const entries: Array<{ el: Element; nodeId: number }> = []
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Element
    const nodeId = Number(el.getAttribute(payload.idAttribute))
    if (allowed !== null && !allowed.has(nodeId)) continue
    entries.push({ el, nodeId })
  }
  const results = payload.selectors.map((selector): ProbeResult => {
    try {
      const matchedNodeIds: number[] = []
      for (const entry of entries) {
        // The one and only matching primitive (ADR-0002).
        if (entry.el.matches(selector)) matchedNodeIds.push(entry.nodeId)
      }
      return { ok: true, matchedNodeIds }
    } catch (err) {
      return {
        ok: false,
        matchedNodeIds: [],
        errorName: err instanceof Error ? err.name : 'Error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }
    }
  })
  return { stampedElementCount: entries.length, results }
}


export class SelectorMatcher {
  /**
   * Match every style rule in the CSSOM rule list against the above-fold
   * node set captured under the same snapshotId.
   */
  async matchRules(
    handle: PageHandle,
    dom: CollectedDom,
    cssom: CssomRuleList,
    viewportProfileId: string,
    /** Visibility Engine's matchable set; `null` = probe every stamped node. */
    allowedNodeIds: readonly number[] | null = null,
  ): Promise<MatchedRuleSet> {
    const diagnostics: Diagnostic[] = []

    // Both inputs must originate from the same atomic page state (016 §8.4).
    if (dom.snapshotId !== cssom.snapshotId) {
      diagnostics.push({
        severity: 'warning',
        code: 'STABILITY_VIOLATION',
        message: `DomSnapshot (${dom.snapshotId}) and CssomRuleList (${cssom.snapshotId}) carry different snapshotIds — they may not describe the same page state`,
      })
    }

    for (const d of cssom.diagnostics) {
      diagnostics.push({
        severity: 'warning',
        code: d.code,
        message: d.message,
        source: { url: d.href },
      })
    }

    interface PendingBranch {
      rule: RuleNode
      selectorText: string
      branch: string
    }

    const pending: PendingBranch[] = []
    const rulesBySheet = new Map<number, ReadonlyMap<number, RuleNode>>()

    for (const sheet of cssom.stylesheets) {
      for (const d of sheet.diagnostics) {
        diagnostics.push({
          severity: 'warning',
          code: d.code,
          message: d.message,
          source: { url: d.href },
        })
      }
      if (!sheet.accessible) continue
      // A disabled sheet (alternate stylesheet, toggled-off theme) is not
      // applied by the browser — its rules must not enter critical CSS.
      if (sheet.disabled) continue
      rulesBySheet.set(sheet.sourceStylesheetIndex, new Map(sheet.rules.map((r) => [r.ruleId, r])))
      for (const rule of sheet.rules) {
        if (rule.ruleType !== 'style' || rule.selectorText === null) continue
        for (const branch of splitSelectorList(rule.selectorText)) {
          pending.push({ rule, selectorText: rule.selectorText, branch })
        }
      }
    }

    let stampedElementCount = 0
    let results: readonly ProbeResult[] = []
    if (pending.length > 0) {
      // Trailing pseudo-elements are stripped to their host base selector
      // (402); the full branch — including pseudo-CLASSES — goes to
      // matches() verbatim (403: dynamic ones correctly report false).
      const inPage = await handle.evaluate(matchProbesInPage, {
        idAttribute: CCSS_ID_ATTRIBUTE,
        selectors: pending.map((p) => extractBaseSelector(p.branch).baseSelector),
        allowedNodeIds,
      })
      stampedElementCount = inPage.stampedElementCount
      results = inPage.results
    }

    if (pending.length > 0 && stampedElementCount === 0) {
      // The page carries no stamped nodes — the snapshot's stamps are gone
      // (late navigation/redirect after collection?). An empty match set here
      // is NOT "nothing matched"; surface it loudly (Principle 6).
      diagnostics.push({
        severity: 'warning',
        code: 'NO_STAMPED_NODES',
        message:
          'No correlation-stamped elements found in-page at match time; the page state has diverged from the DOM snapshot (late redirect/navigation?) and the match set is unreliable',
        source: { url: dom.snapshot.capturedUrl },
      })
    }

    interface Accumulator {
      rule: RuleNode
      selectorText: string
      branches: string[]
      nodeIds: Set<number>
    }
    const accumulators = new Map<string, Accumulator>()

    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i] as PendingBranch
      const result = results[i] as ProbeResult
      if (!result.ok) {
        diagnostics.push({
          severity: 'warning',
          code: 'UNSUPPORTED_SELECTOR',
          message: `matches() threw ${result.errorName ?? 'Error'} for selector "${entry.branch}": ${result.errorMessage ?? ''}`,
          context: {
            stylesheetIndex: entry.rule.sourceStylesheetIndex,
            ruleIndexPath: [...entry.rule.ruleIndexPath],
          },
        })
        continue
      }
      if (result.matchedNodeIds.length === 0) {
        if (containsDynamicPseudoClass(entry.branch)) {
          diagnostics.push({
            severity: 'info',
            code: 'DYNAMIC_PSEUDO_CLASS_EXCLUDED_BY_DESIGN',
            message: `Selector branch "${entry.branch}" did not match at snapshot time (dynamic pseudo-class); excluded by design`,
          })
        }
        continue
      }
      const key = `${entry.rule.sourceStylesheetIndex}:${entry.rule.ruleIndexPath.join('.')}`
      let acc = accumulators.get(key)
      if (acc === undefined) {
        acc = { rule: entry.rule, selectorText: entry.selectorText, branches: [], nodeIds: new Set() }
        accumulators.set(key, acc)
      }
      acc.branches.push(entry.branch)
      for (const id of result.matchedNodeIds) acc.nodeIds.add(id)
    }

    const matches: CssomRuleMatch[] = []
    for (const acc of accumulators.values()) {
      const byId = rulesBySheet.get(acc.rule.sourceStylesheetIndex)
      matches.push({
        stylesheetIndex: acc.rule.sourceStylesheetIndex,
        ruleIndexPath: acc.rule.ruleIndexPath,
        selectorText: acc.selectorText,
        matchedSelectorBranches: acc.branches,
        matchedNodeIds: [...acc.nodeIds].sort((a, b) => a - b),
        declarationText: acc.rule.declarationText,
        atRuleChain: byId !== undefined ? atRuleChainOf(acc.rule, byId) : [],
      })
    }

    // Deterministic order: source order within the document (Principle 5).
    matches.sort((a, b) =>
      a.stylesheetIndex !== b.stylesheetIndex
        ? a.stylesheetIndex - b.stylesheetIndex
        : compareRuleIndexPaths(a.ruleIndexPath, b.ruleIndexPath),
    )

    return { snapshotId: cssom.snapshotId, viewportProfileId, strategy: 'cssom', matches, diagnostics }
  }
}
