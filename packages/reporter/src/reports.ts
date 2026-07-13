/**
 * Reporter (docs/tasks/009-Implement-Reporter.md, docs/design/1000-1002, AT-10).
 *
 * Pure sink: reads terminal pipeline outputs by reference and emits the four
 * M3 reports + the dependency-graph JSON (REQ-460). Never mutates its inputs.
 * Extraction trace (1003), HTML overlay (1004), and the Debug UI (1005,
 * apps/visualizer) are M5 — out of scope here.
 */

import type { CssomRuleList } from '@critical-css/collector'
import type { DependencyGraph } from '@critical-css/dependency-graph'
import type { CssomRuleMatch } from '@critical-css/matcher'
import type { DependencyNode, ExtractionMode, StageTiming } from '@critical-css/shared'

const ruleIdentity = (stylesheetIndex: number, ruleIndexPath: readonly number[]): string =>
  `${stylesheetIndex}:${ruleIndexPath.join('.')}`

export interface MatchedSelectorRow {
  readonly selectorText: string
  readonly stylesheetHref: string | null
  readonly ruleIndexPath: readonly number[]
  readonly matchedNodeCount: number
}
export interface MatchedSelectorReport {
  readonly count: number
  readonly rows: readonly MatchedSelectorRow[]
}

export interface UnmatchedSelectorRow {
  readonly selectorText: string
  readonly stylesheetHref: string | null
  readonly ruleIndexPath: readonly number[]
}
export interface UnmatchedSelectorReport {
  readonly count: number
  readonly rows: readonly UnmatchedSelectorRow[]
}

export interface TimingReport {
  readonly stages: readonly StageTiming[]
  readonly totalMs: number
}

export interface StylesheetContributionRow {
  readonly stylesheetHref: string
  readonly retainedRuleCount: number
  readonly totalRuleCount: number
  /** Bytes contributed to the critical CSS (selector + declaration lengths). */
  readonly byteContribution: number
}
export interface StylesheetContributionReport {
  readonly stylesheets: readonly StylesheetContributionRow[]
  readonly totalBytes: number
}

export interface DependencyGraphReport {
  readonly nodes: ReadonlyArray<{ id: string; type: string; value: string }>
  readonly edges: ReadonlyArray<{ from: string; to: string; kind: string }>
}

export interface ReportBundle {
  readonly route: string
  readonly viewportProfileId: string
  readonly mode: ExtractionMode
  readonly matchedSelectors: MatchedSelectorReport
  readonly unmatchedSelectors: UnmatchedSelectorReport
  readonly timing: TimingReport
  readonly stylesheetContribution: StylesheetContributionReport
  readonly dependencyGraph: DependencyGraphReport
}

export interface ReportInput {
  readonly route: string
  readonly viewportProfileId: string
  readonly mode: ExtractionMode
  /** Full source rule enumeration (accessible, enabled sheets). */
  readonly cssom: CssomRuleList
  readonly matched: readonly CssomRuleMatch[]
  readonly manifest: readonly DependencyNode[]
  readonly graph?: DependencyGraph
  readonly timing: readonly StageTiming[]
}

const sheetKey = (href: string | null, index: number): string => href ?? `inline#${index}`

/** Reporter — the pure-sink report builder (AT-10, M3 subset). */
export class Reporter {
  build(input: ReportInput): ReportBundle {
    const matchedById = new Map<string, CssomRuleMatch>()
    for (const m of input.matched) matchedById.set(ruleIdentity(m.stylesheetIndex, m.ruleIndexPath), m)

    // href lookup built once — O(1) per rule instead of an O(sheets) scan.
    const hrefByIndex = new Map<number, string | null>()
    for (const sheet of input.cssom.stylesheets) hrefByIndex.set(sheet.sourceStylesheetIndex, sheet.href)
    const hrefOf = (index: number): string | null => hrefByIndex.get(index) ?? null

    // Matched-selector report.
    const matchedRows: MatchedSelectorRow[] = input.matched.map((m) => ({
      selectorText: m.selectorText,
      stylesheetHref: hrefOf(m.stylesheetIndex),
      ruleIndexPath: m.ruleIndexPath,
      matchedNodeCount: m.matchedNodeIds.length,
    }))

    // Unmatched-selector report: every source style rule minus matched (1000 §10.2).
    const unmatchedRows: UnmatchedSelectorRow[] = []
    for (const sheet of input.cssom.stylesheets) {
      if (!sheet.accessible || sheet.disabled) continue
      for (const rule of sheet.rules) {
        if (rule.ruleType !== 'style' || rule.selectorText === null) continue
        const id = ruleIdentity(sheet.sourceStylesheetIndex, rule.ruleIndexPath)
        if (!matchedById.has(id)) {
          unmatchedRows.push({
            selectorText: rule.selectorText,
            stylesheetHref: sheet.href,
            ruleIndexPath: rule.ruleIndexPath,
          })
        }
      }
    }

    // Per-stylesheet contribution (bytes = selector + declaration text length).
    const contribByKey = new Map<string, { href: string; retained: number; total: number; bytes: number }>()
    for (const sheet of input.cssom.stylesheets) {
      if (!sheet.accessible || sheet.disabled) continue
      const key = sheetKey(sheet.href, sheet.sourceStylesheetIndex)
      const totalRules = sheet.rules.filter((r) => r.ruleType === 'style').length
      contribByKey.set(key, { href: key, retained: 0, total: totalRules, bytes: 0 })
    }
    for (const m of input.matched) {
      const key = sheetKey(hrefOf(m.stylesheetIndex), m.stylesheetIndex)
      const entry = contribByKey.get(key)
      if (entry !== undefined) {
        entry.retained += 1
        entry.bytes += m.selectorText.length + m.declarationText.length
      }
    }
    const stylesheets: StylesheetContributionRow[] = [...contribByKey.values()]
      .map((e) => ({
        stylesheetHref: e.href,
        retainedRuleCount: e.retained,
        totalRuleCount: e.total,
        byteContribution: e.bytes,
      }))
      .sort((a, b) => (a.stylesheetHref < b.stylesheetHref ? -1 : 1))
    const totalBytes = stylesheets.reduce((sum, s) => sum + s.byteContribution, 0)

    // Timing report.
    const totalMs = input.timing.reduce((sum, t) => sum + t.elapsedMs, 0)

    // Dependency-graph report (REQ-460): resolved nodes/edges verbatim as JSON.
    const dependencyGraph = buildGraphReport(input.manifest, input.graph)

    return {
      route: input.route,
      viewportProfileId: input.viewportProfileId,
      mode: input.mode,
      matchedSelectors: { count: matchedRows.length, rows: matchedRows },
      unmatchedSelectors: { count: unmatchedRows.length, rows: unmatchedRows },
      timing: { stages: [...input.timing], totalMs },
      stylesheetContribution: { stylesheets, totalBytes },
      dependencyGraph,
    }
  }

  /** Deterministic JSON rendering of a report bundle. */
  toJson(bundle: ReportBundle): string {
    return JSON.stringify(bundle, null, 2)
  }
}

function buildGraphReport(manifest: readonly DependencyNode[], graph?: DependencyGraph): DependencyGraphReport {
  if (graph !== undefined) {
    const nodes = [...graph.nodesById.values()]
      .map((n) => ({ id: n.id, type: n.kind, value: n.value }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    const edges: Array<{ from: string; to: string; kind: string }> = []
    for (const list of graph.edgesBySource.values()) {
      for (const e of list) edges.push({ from: e.sourceId, to: e.targetId, kind: e.kind })
    }
    edges.sort((a, b) =>
      a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to !== b.to ? (a.to < b.to ? -1 : 1) : a.kind < b.kind ? -1 : 1,
    )
    return { nodes, edges }
  }
  // Fallback: derive from the manifest alone (no full graph handed in).
  const nodes = manifest
    .map((n) => ({ id: n.id, type: n.type, value: n.value }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const edges: Array<{ from: string; to: string; kind: string }> = []
  for (const n of manifest) {
    for (const dep of n.dependencies) edges.push({ from: n.id, to: dep, kind: 'requires' })
  }
  edges.sort((a, b) => (a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to < b.to ? -1 : 1))
  return { nodes, edges }
}
