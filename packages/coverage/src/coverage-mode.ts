/**
 * Coverage Mode (docs/design/700-Coverage-Mode.md, AT-05).
 *
 * Uses the CSS coverage the browser abstraction exposes (Chromium CDP
 * CSS.startRuleUsageTracking under the hood) and maps used byte-ranges to
 * rule keys in an index scheme aligned with the CSSOM walker's
 * `(sourceStylesheetIndex, style-rule document order)` — WITHOUT importing
 * `packages/collector` or `packages/matcher` (hard invariant, ADR-0005): the
 * enumeration is redone here via browser-truth `evaluate()`.
 *
 * Rule key = `${sheetKey}:${styleRuleOrdinal}` where sheetKey is the
 * stylesheet href, or `inline#<docIndex>` for inline `<style>`.
 *
 * Mapping precision limit (M3): used ranges are matched to rules by locating
 * each rule's verbatim `selectorText` in the source text and testing range
 * membership. This is browser-truth (real ranges, real selectors, string
 * search — not a CSS parser, so ADR-0002-safe) but approximate for
 * whitespace-divergent or duplicated selectors. In HYBRID mode this is safe:
 * coverage only upgrades/flags, never drops a CSSOM match (701 fidelity bias).
 */

import type { PageHandle, RawCssCoverage } from '@critical-css/browser'
import type { Diagnostic } from '@critical-css/shared'

export interface CoverageResult {
  readonly usedRuleKeys: ReadonlySet<string>
  readonly unusedRuleKeys: ReadonlySet<string>
  readonly diagnostics: readonly Diagnostic[]
}

export function sheetKeyFor(href: string | null, docIndex: number): string {
  return href !== null && href.length > 0 ? href : `inline#${docIndex}`
}

interface InPageSheet {
  href: string | null
  selectors: string[]
}

/**
 * Self-contained in-page enumeration. The rule set + order MUST match the
 * CSSOM walker (packages/collector) exactly — same document-order style-rule
 * ordinals per sheet — or coverage keys map to the wrong rules downstream.
 * So it mirrors the walker precisely: descend into grouping rules and
 * CSS-nesting, descend into `@import`-ed sheets (accumulating imported style
 * rules under the importing sheet, as the walker does), skip keyframes
 * children, and enumerate `adoptedStyleSheets` after document sheets with a
 * continuing index.
 */
function enumerateStyleRulesInPage(): InPageSheet[] {
  const result: InPageSheet[] = []
  const walkSheet = (sheet: CSSStyleSheet): void => {
    const selectors: string[] = []
    let rules: CSSRuleList | null = null
    try {
      rules = sheet.cssRules
    } catch {
      result.push({ href: sheet.href, selectors: [] })
      return
    }
    const importChain = new Set<string>()
    if (sheet.href !== null) importChain.add(sheet.href)
    const walk = (list: CSSRuleList): void => {
      for (let j = 0; j < list.length; j++) {
        const rule = list[j] as CSSRule
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText)
        if (rule instanceof CSSImportRule) {
          const imported = rule.styleSheet
          if (imported !== null && (imported.href === null || !importChain.has(imported.href))) {
            if (imported.href !== null) importChain.add(imported.href)
            try {
              walk(imported.cssRules)
            } catch {
              /* cross-origin import: unreadable, matches walker's diagnostic path */
            }
          }
          continue
        }
        const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
        if (nested !== undefined && nested.length > 0 && !(rule instanceof CSSKeyframesRule)) walk(nested)
      }
    }
    walk(rules)
    result.push({ href: sheet.href, selectors })
  }
  for (let i = 0; i < document.styleSheets.length; i++) {
    walkSheet(document.styleSheets[i] as CSSStyleSheet)
  }
  for (const sheet of document.adoptedStyleSheets ?? []) {
    walkSheet(sheet)
  }
  return result
}

const rangeContains = (ranges: readonly { start: number; end: number }[], offset: number): boolean =>
  ranges.some((r) => offset >= r.start && offset < r.end)

export class CoverageCollector {
  /**
   * Map raw coverage (from a stopped session, post-stabilization) to a used/
   * unused rule-key set. Call before the page is released.
   */
  async collect(handle: PageHandle, raw: RawCssCoverage): Promise<CoverageResult> {
    const sheets = await handle.evaluate(enumerateStyleRulesInPage, undefined as never)
    const diagnostics: Diagnostic[] = []

    // Correlate each in-page sheet to a coverage entry: linked sheets by URL
    // (href match); inline sheets (no href) to the entries NOT claimed by any
    // href, in document order — so a linked sheet's entry is never mis-assigned
    // to an inline sheet processed earlier.
    const sheetHrefs = new Set<string>()
    for (const s of sheets) {
      if (s.href !== null && s.href.length > 0) sheetHrefs.add(s.href)
    }
    const byHref = new Map<string, RawCssCoverage['entries'][number]>()
    for (const entry of raw.entries) {
      if (!byHref.has(entry.url)) byHref.set(entry.url, entry)
    }
    const inlineQueue = raw.entries.filter((e) => !sheetHrefs.has(e.url))

    const usedRuleKeys = new Set<string>()
    const unusedRuleKeys = new Set<string>()

    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i] as InPageSheet
      const key = sheetKeyFor(sheet.href, i)
      let entry: RawCssCoverage['entries'][number] | undefined
      if (sheet.href !== null && sheet.href.length > 0) {
        entry = byHref.get(sheet.href)
      } else {
        entry = inlineQueue.shift()
      }

      if (entry === undefined) {
        // No coverage data for this sheet (adopted stylesheets aren't reported
        // by CSS coverage; a sheet may also be omitted). Conservatively mark
        // its rules USED — dropping them risks FOUC, and over-inclusion only
        // costs bytes (fidelity bias, §2.18).
        for (let ordinal = 0; ordinal < sheet.selectors.length; ordinal++) {
          usedRuleKeys.add(`${key}:${ordinal}`)
        }
        if (sheet.selectors.length > 0) {
          diagnostics.push({
            severity: 'info',
            code: 'COVERAGE_SHEET_UNMAPPED',
            message: `No coverage entry for stylesheet ${key}; its ${sheet.selectors.length} rule(s) conservatively kept`,
            source: { url: sheet.href },
          })
        }
        continue
      }

      let cursor = 0
      for (let ordinal = 0; ordinal < sheet.selectors.length; ordinal++) {
        const selector = sheet.selectors[ordinal] as string
        const offset = entry.text.indexOf(selector, cursor)
        const ruleKey = `${key}:${ordinal}`
        if (offset === -1) {
          // Selector not locatable in source (whitespace divergence / minified).
          // Conservatively mark used so hybrid keeps it (fidelity bias).
          usedRuleKeys.add(ruleKey)
          continue
        }
        cursor = offset + selector.length
        if (rangeContains(entry.ranges, offset)) usedRuleKeys.add(ruleKey)
        else unusedRuleKeys.add(ruleKey)
      }
    }

    return { usedRuleKeys, unusedRuleKeys, diagnostics }
  }
}
