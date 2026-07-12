/**
 * LayerOrderRegistry (docs/algorithms/506, docs/design/305): layer ranks from
 * first-occurrence declaration order — `@layer a, b;` statements and
 * `@layer name { … }` blocks, in source order. Unlayered ranks LAST
 * (highest normal-cascade priority).
 */

import type { CssomRuleList } from '@critical-css/collector'

export const UNLAYERED_RANK = Number.MAX_SAFE_INTEGER

export interface LayerOrderRegistry {
  /** Layer names in first-occurrence declaration order. */
  readonly declarationOrder: readonly string[]
  rankOf(layerName: string | null): number
}

export function buildLayerOrderRegistry(cssom: CssomRuleList): LayerOrderRegistry {
  const order: string[] = []
  const seen = new Set<string>()
  const declare = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) return
    seen.add(trimmed)
    order.push(trimmed)
  }

  for (const sheet of cssom.stylesheets) {
    if (!sheet.accessible || sheet.disabled) continue
    for (const rule of sheet.rules) {
      if (rule.ruleType === 'layer-statement' && rule.conditionText !== null) {
        for (const name of rule.conditionText.split(',')) declare(name)
      } else if (rule.ruleType === 'layer-block' && rule.conditionText !== null) {
        declare(rule.conditionText)
      }
    }
  }

  const ranks = new Map(order.map((name, i) => [name, i]))
  return {
    declarationOrder: order,
    rankOf(layerName: string | null): number {
      if (layerName === null) return UNLAYERED_RANK
      return ranks.get(layerName.trim()) ?? UNLAYERED_RANK - 1
    },
  }
}
