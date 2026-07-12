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
    // `@layer a, b;` statement: declared name order feeds the LayerOrderRegistry.
    if (type === 'layer-statement') return (rule as CSSLayerStatementRule).nameList.join(', ')
    // Names for the dependency resolver's registries (502/504/505).
    if (type === 'keyframes') return (rule as CSSKeyframesRule).name
    if (type === 'property' && typeof CSSPropertyRule !== 'undefined')
      return (rule as CSSPropertyRule).name
    if (type === 'counter-style' && typeof CSSCounterStyleRule !== 'undefined')
      return (rule as CSSCounterStyleRule).name
    return null
  }

  const declarationTextOf = (rule: CSSRule, type: RuleType): string => {
    if (type === 'style' || type === 'page') {
      return (rule as CSSStyleRule | CSSPageRule).style.cssText
    }
    // Dependency at-rules carry their FULL at-rule text — the serializer
    // emits these verbatim at top level, so bare declarations would be
    // invalid CSS (silently discarded by the browser).
    if (
      type === 'font-face' ||
      type === 'keyframes' ||
      type === 'property' ||
      type === 'counter-style' ||
      type === 'unknown'
    ) {
      return rule.cssText
    }
    return ''
  }

  const conditionActiveOf = (rule: CSSRule, type: RuleType): boolean | null => {
    try {
      if (type === 'media') return window.matchMedia((rule as CSSMediaRule).media.mediaText).matches
      if (type === 'supports') return CSS.supports((rule as CSSSupportsRule).conditionText)
    } catch {
      return null
    }
    return null
  }

  const walkSheet = (
    sheet: CSSStyleSheet,
    sheetIndex: number,
    origin: 'link' | 'style' | 'import' | 'constructable',
  ): void => {
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
      // @import cycle guard (306): hrefs along the active import chain.
      const importChain = new Set<string>()
      if (sheet.href !== null) importChain.add(sheet.href)

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
              conditionActive: conditionActiveOf(rule, type),
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
          // children are keyframe steps, not style rules); unknown grouping
          // rules (@scope, @starting-style) are walked with a diagnostic —
          // descendants must never be silently dropped. CSS-nesting children
          // of style rules ARE walked: their raw `&`-selectors reach the
          // matcher and surface as UNSUPPORTED_SELECTOR diagnostics (loud)
          // rather than vanishing (full nesting resolution is M3).
          const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined
          if (nested !== undefined && nested.length > 0 && type !== 'keyframes') {
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

          // 306: recurse into @import-ed sheets. Imported rules are recorded
          // under the importing sheet's record with the import rule's path as
          // prefix — this preserves exact cascade position (imported rules
          // sort where the @import statement sits).
          if (type === 'import') {
            const importRule = rule as CSSImportRule
            const importedSheet = importRule.styleSheet
            const href = importRule.href
            if (importedSheet === null) {
              diagnostics.push({
                code: 'IMPORT_SHEET_UNAVAILABLE',
                message: `@import at ${path.join('.')} has no loaded stylesheet (load failure?)`,
                href,
              })
            } else if (importedSheet.href !== null && importChain.has(importedSheet.href)) {
              // Deterministic cycle break (508's spirit at the sheet level).
              diagnostics.push({
                code: 'CIRCULAR_IMPORT',
                message: `@import cycle detected at ${path.join('.')} → ${importedSheet.href}; second occurrence not re-walked`,
                href: importedSheet.href,
              })
            } else {
              if (importedSheet.href !== null) importChain.add(importedSheet.href)
              try {
                const childIds = walkRuleList(importedSheet.cssRules, ruleId, path)
                ;(node as { childRuleIds: readonly number[] }).childRuleIds = childIds
              } catch (err) {
                diagnostics.push({
                  code: 'CROSS_ORIGIN_STYLESHEET_SKIPPED',
                  message: `Imported stylesheet cssRules inaccessible (${err instanceof Error ? err.name : 'SecurityError'})`,
                  href,
                })
              }
              if (importedSheet.href !== null) importChain.delete(importedSheet.href)
            }
          }
        }
        return ids
      }
      walkRuleList(ruleList, null, [])
    }

    stylesheets.push({
      sourceStylesheetIndex: sheetIndex,
      origin,
      href: sheet.href,
      disabled: sheet.disabled,
      accessible,
      rules,
      diagnostics,
    })
  }

  let sheetIndex = 0
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i] as CSSStyleSheet
    walkSheet(sheet, sheetIndex, classifyOrigin(sheet))
    sheetIndex += 1
  }
  // 307: adopted (constructable) stylesheets — enumerated explicitly, since
  // document.styleSheets is not exhaustive (Principle 1 edge case).
  const adopted = document.adoptedStyleSheets ?? []
  for (const sheet of adopted) {
    walkSheet(sheet, sheetIndex, 'constructable')
    sheetIndex += 1
  }

  return { stylesheets, diagnostics: walkDiagnostics }
}

export class CssomWalker {
  async walk(handle: PageHandle, snapshotId: string): Promise<CssomRuleList> {
    const result = await handle.evaluate(walkCssomInPage, undefined as never)
    return { snapshotId, stylesheets: result.stylesheets, diagnostics: result.diagnostics }
  }
}
