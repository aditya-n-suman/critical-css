/**
 * At-rule wrapper chain reconstruction (302 §8.4) — single implementation
 * shared by matcher, dependency-graph, and CLI (a chain computed two ways is
 * a cascade bug waiting to happen).
 */

import type { AtRuleCondition } from '@critical-css/shared'
import type { RuleNode } from './types.js'

const CHAIN_KIND: Readonly<Partial<Record<RuleNode['ruleType'], AtRuleCondition['kind']>>> = {
  media: 'media',
  supports: 'supports',
  container: 'container',
  'layer-block': 'layer',
}

/** Builds the enclosing at-rule condition chain for a rule, outermost first. */
export function atRuleChainOf(rule: RuleNode, rulesById: ReadonlyMap<number, RuleNode>): AtRuleCondition[] {
  const chain: AtRuleCondition[] = []
  let parentId = rule.parentRuleId
  while (parentId !== null) {
    const parent = rulesById.get(parentId)
    if (parent === undefined) break
    const kind = CHAIN_KIND[parent.ruleType]
    if (kind !== undefined && parent.conditionText !== null) {
      chain.unshift({ kind, conditionText: parent.conditionText })
    }
    parentId = parent.parentRuleId
  }
  return chain
}
