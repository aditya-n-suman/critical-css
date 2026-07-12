/**
 * CSSOM Walker (docs/tasks/002-Implement-CSSOM-Walker.md, docs/design/300).
 *
 * Traverses `document.styleSheets` and every nested CSSRuleList entirely
 * in-page via one evaluate() round trip. Zero CSS text parsing: every fact
 * comes from CSSRule getters (ADR-0001/0002). Cross-origin sheets that throw
 * on `cssRules` are recorded as inaccessible with a diagnostic — never a
 * crash, never a silent drop.
 */

import type { PageHandle } from '@critical-css/browser'
import type {
  CollectorDiagnosticRecord,
  CssomRuleList,
  RuleNode,
  RuleType,
  StylesheetRecord,
} from './types.js'

interface InPageWalkResult {
  stylesheets: StylesheetRecord[]
  diagnostics: CollectorDiagnosticRecord[]
}

/** Runs in-page. Self-contained: no closures over Node-side state (ADR-0001). */
function walkCssomInPage(): InPageWalkResult {
  const stylesheets: StylesheetRecord[] = []
  const walkDiagnostics: CollectorDiagnosticRecord[] = []

  const classifyOrigin = (sheet: CSSStyleSheet): 'link' | 'style' | 'import' | 'constructable' => {
    const owner = sheet.ownerNode
    if (owner === null) return sheet.ownerRule !== null ? 'import' : 'constructable'
    if (owner instanceof HTMLLinkElement) return 'link'
    return 'style'
  }

  // instanceof against concrete interfaces, never numeric CSSRule.type (300);
  // typeof guards for newer rule interfaces.
  const classifyRuleType = (rule: CSSRule): RuleType => {
    if (rule instanceof CSSStyleRule) return 'style'
    if (rule instanceof CSSMediaRule) return 'media'
    if (rule instanceof CSSSupportsRule) return 'supports'
    if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) return 'layer-block'
    if (typeof CSSLayerStatementRule !== 'undefined' && rule instanceof CSSLayerStatementRule)
      return 'layer-statement'
    if (rule instanceof CSSImportRule) return 'import'
    if (rule instanceof CSSFontFaceRule) return 'font-face'
    if (rule instanceof CSSKeyframesRule) return 'keyframes'
    if (rule instanceof CSSPageRule) return 'page'
    if (typeof CSSPropertyRule !== 'undefined' && rule instanceof CSSPropertyRule) return 'property'
    if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) return 'container'
    if (typeof CSSCounterStyleRule !== 'undefined' && rule instanceof CSSCounterStyleRule)
      return 'counter-style'
    return 'unknown'
  }

  const conditionTextOf = (rule: CSSRule, type: RuleType): string | null => {
    if (type === 'media') return (rule as CSSMediaRule).media.mediaText
    if (type === 'supports' || type === 'container')
      return (rule as CSSSupportsRule | CSSContainerRule).conditionText
    if (type === 'layer-block') return (rule as CSSLayerBlockRule).name
    // `@layer a, b;` statement: capture the declared name order now — the
    // LayerOrderRegistry that consumes it is M2 (305), but the fact must not
    // be lost at collection time.
    if (type === 'layer-statement') return (rule as CSSLayerStatementRule).nameList.join(', ')
    return null
  }

  const declarationTextOf = (rule: CSSRule, type: RuleType): string => {
    if (type === 'style' || type === 'page' || type === 'font-face') {
      return (rule as CSSStyleRule | CSSPageRule | CSSFontFaceRule).style.cssText
    }
    if (type === 'keyframes' || type === 'property' || type === 'counter-style' || type === 'unknown') {
      return rule.cssText
    }
    return ''
  }

  for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
    const sheet = document.styleSheets[sheetIndex] as CSSStyleSheet
    const diagnostics: CollectorDiagnosticRecord[] = []
    const rules: RuleNode[] = []
    let accessible = true
    let ruleList: CSSRuleList | null = null

    try {
      ruleList = sheet.cssRules
    } catch (err) {
      accessible = false
      diagnostics.push({
        code: 'CROSS_ORIGIN_STYLESHEET_SKIPPED',
        message: `Stylesheet cssRules inaccessible (${err instanceof Error ? err.name : 'SecurityError'}); sheet excluded from extraction`,
        href: sheet.href,
      })
    }

    if (ruleList !== null) {
      let ruleIdCounter = 0
      const walkRuleList = (
        list: CSSRuleList,
        parentRuleId: number | null,
        parentPath: readonly number[],
      ): number[] => {
        const ids: number[] = []
        for (let i = 0; i < list.length; i++) {
          const rule = list[i] as CSSRule
          const ruleId = ruleIdCounter
          ruleIdCounter += 1
          const path = [...parentPath, i]
          let type: RuleType
          let node: RuleNode
          try {
            type = classifyRuleType(rule)
            node = {
              ruleId,
              parentRuleId,
              childRuleIds: [],
              sourceStylesheetIndex: sheetIndex,
              sourceRuleIndex: i,
              ruleIndexPath: path,
              ruleType: type,
              selectorText: type === 'style' ? (rule as CSSStyleRule).selectorText : null,
              declarationText: declarationTextOf(rule, type),
              conditionText: conditionTextOf(rule, type),
              rawCssText: type === 'unknown' ? rule.cssText : null,
            }
          } catch (err) {
            // Per-sheet/per-rule isolation (300): attribute and continue.
            diagnostics.push({
              code: 'CSSOM_WALK_ERROR',
              message: `Failed reading rule ${path.join('.')}: ${err instanceof Error ? err.message : String(err)}`,
              href: sheet.href,
            })
            continue
          }
          rules.push(node)
          ids.push(ruleId)

          // Recurse into any nested CSSRuleList except keyframes (whose
          // children are keyframe steps, not style rules). This covers
          // known grouping rules AND future/unknown ones (@scope,
          // @starting-style) — descendants of an unknown grouping rule must
          // never be silently dropped; the unknown wrapper is diagnosed.
          const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
          if (nested !== undefined && nested.length > 0 && type !== 'keyframes' && type !== 'style') {
            if (type === 'unknown') {
              diagnostics.push({
                code: 'UNKNOWN_GROUPING_RULE',
                message: `Unrecognized grouping rule at ${path.join('.')} (${rule.cssText.slice(0, 40)}…); descendants walked, wrapper condition not modeled`,
                href: sheet.href,
              })
            }
            const childIds = walkRuleList(nested, ruleId, path)
            ;(node as { childRuleIds: readonly number[] }).childRuleIds = childIds
          }

          // @import recursion is M2 (306) — surface the deferral loudly
          // rather than silently dropping the imported sheet's rules.
          if (type === 'import') {
            diagnostics.push({
              code: 'IMPORT_RULE_DEFERRED',
              message: `@import at ${path.join('.')} not walked (deferred to M2, docs/design/306); its rules are missing from extraction`,
              href: (rule as CSSImportRule).href,
            })
          }
        }
        return ids
      }
      walkRuleList(ruleList, null, [])
    }

    stylesheets.push({
      sourceStylesheetIndex: sheetIndex,
      origin: classifyOrigin(sheet),
      href: sheet.href,
      disabled: sheet.disabled,
      accessible,
      rules,
      diagnostics,
    })
  }

  // adoptedStyleSheets walking is M2 (307) — diagnose, never silently drop.
  const adoptedCount = document.adoptedStyleSheets?.length ?? 0
  if (adoptedCount > 0) {
    walkDiagnostics.push({
      code: 'ADOPTED_STYLESHEETS_DEFERRED',
      message: `${adoptedCount} adopted (constructable) stylesheet(s) present but not walked (deferred to M2, docs/design/307)`,
      href: null,
    })
  }

  return { stylesheets, diagnostics: walkDiagnostics }
}

export class CssomWalker {
  async walk(handle: PageHandle, snapshotId: string): Promise<CssomRuleList> {
    const result = await handle.evaluate(walkCssomInPage, undefined as never)
    return { snapshotId, stylesheets: result.stylesheets, diagnostics: result.diagnostics }
  }
}
