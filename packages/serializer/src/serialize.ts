/**
 * Serializer, M1 slice (docs/tasks/006-Implement-Serializer.md,
 * docs/design/600-Serialization-Overview.md, 601-Rule-Ordering.md).
 *
 * Pipeline: order → group-by-wrapper-chain → renderPretty → wrap format.
 * Compression, dedup-beyond-601, and source maps are M2.
 *
 * Determinism obligations (600 §8.2): pure function of the input's
 * layer/source indices; tokens emitted verbatim; every structural choice
 * pinned in SerializerConfig; zero environment dependence.
 */

import { SerializationError, compareRuleIndexPaths } from '@critical-css/shared'
import {
  DEFAULT_SERIALIZER_CONFIG,
  type MergedMultiViewportRuleSet,
  type MergedRule,
  type SerializedArtifact,
  type SerializerConfig,
} from './types.js'

const UNLAYERED_RANK = Number.MAX_SAFE_INTEGER

function layerRank(rule: MergedRule): number {
  // Unlayered rules sort LAST — highest cascade priority (601 §10.2).
  return rule.layerOrder ?? UNLAYERED_RANK
}

/**
 * Canonical total order (601 §8.2/§10.1): layer rank, then wrapper-chain
 * tiebreak within equal layers, then document source order
 * (stylesheetIndex, ruleIndexPath). Never specificity or origin — those are
 * intrinsic; the browser re-applies them.
 */
export function compareMergedRules(a: MergedRule, b: MergedRule): number {
  const layerDiff = layerRank(a) - layerRank(b)
  if (layerDiff !== 0) return layerDiff
  if (a.stylesheetIndex !== b.stylesheetIndex) return a.stylesheetIndex - b.stylesheetIndex
  return compareRuleIndexPaths(a.ruleIndex, b.ruleIndex)
}

interface WrapperGroup {
  readonly chain: readonly string[]
  readonly rules: MergedRule[]
}

/** Consecutive rules with an identical wrapper chain share one wrapper set (601 §8.3). */
function groupByWrapperChain(rules: readonly MergedRule[]): WrapperGroup[] {
  const groups: WrapperGroup[] = []
  for (const rule of rules) {
    const last = groups[groups.length - 1]
    if (last !== undefined && chainsEqual(last.chain, rule.atRuleChain)) {
      last.rules.push(rule)
    } else {
      groups.push({ chain: rule.atRuleChain, rules: [rule] })
    }
  }
  return groups
}

function chainsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function validateBalanced(css: string): void {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string
    // Braces inside quoted strings (e.g. `content: "{"`) are literal text —
    // declarationText is verbatim CSSOM output and may legally contain them.
    if (quote !== null) {
      if (ch === quote && css[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    if (depth < 0) break
  }
  if (depth !== 0) {
    throw new SerializationError('Serialized output has unbalanced braces', {
      context: { depth },
    })
  }
}

function renderPretty(groups: readonly WrapperGroup[], config: SerializerConfig): string {
  const nl = config.lineEnding
  const lines: string[] = []
  for (const group of groups) {
    let depth = 0
    for (const wrapper of group.chain) {
      lines.push(`${config.indent.repeat(depth)}${wrapper} {`)
      depth += 1
    }
    for (const rule of group.rules) {
      const pad = config.indent.repeat(depth)
      lines.push(`${pad}${rule.selectorText} {`)
      if (rule.declarationText.length > 0) {
        lines.push(`${pad}${config.indent}${rule.declarationText}`)
      }
      lines.push(`${pad}}`)
    }
    for (let d = group.chain.length - 1; d >= 0; d--) {
      lines.push(`${config.indent.repeat(d)}}`)
    }
  }
  if (lines.length === 0) return ''
  return lines.join(nl) + (config.trailingNewline ? nl : '')
}

export function serialize(
  input: MergedMultiViewportRuleSet,
  config: SerializerConfig = DEFAULT_SERIALIZER_CONFIG,
): SerializedArtifact {
  // Stable sort over a copy — input is never mutated.
  const ordered = [...input.rules].sort(compareMergedRules)
  const groups = groupByWrapperChain(ordered)
  const css = renderPretty(groups, config)
  validateBalanced(css)
  return {
    format: config.format,
    css,
    sourceMap: null,
    stats: {
      ruleCount: ordered.length,
      dependencyCount: input.dependencyManifest.length,
      byteLength: css.length,
    },
  }
}
