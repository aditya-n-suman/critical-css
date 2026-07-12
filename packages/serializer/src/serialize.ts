/**
 * Serializer (docs/tasks/006, docs/design/600–604, 606).
 *
 * Pipeline: reference-dedup (602 L1) → order (601) → group-by-wrapper-chain →
 * render (pretty | conservative-minified) → validate → wrap format.
 *
 * Emission plan (601 §9.2): @layer statement prelude → dependency at-rules →
 * layered style rules (registry rank order) → unlayered style rules LAST.
 */

import { SerializationError, compareRuleIndexPaths } from '@critical-css/shared'
import type { AtRuleCondition } from '@critical-css/shared'
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

/** Canonical total order (601 §8.2/§10.1): layer rank, then source order. */
export function compareMergedRules(a: MergedRule, b: MergedRule): number {
  const layerDiff = layerRank(a) - layerRank(b)
  if (layerDiff !== 0) return layerDiff
  if (a.stylesheetIndex !== b.stylesheetIndex) return a.stylesheetIndex - b.stylesheetIndex
  return compareRuleIndexPaths(a.ruleIndex, b.ruleIndex)
}

/** 602 Layer-1 reference dedup: same rule identity collapses unconditionally. */
function referenceDedup(rules: readonly MergedRule[]): MergedRule[] {
  const seen = new Map<string, MergedRule>()
  for (const rule of rules) {
    const key = `${rule.stylesheetIndex}:${rule.ruleIndex.join('.')}`
    const existing = seen.get(key)
    if (existing === undefined) {
      seen.set(key, rule)
    } else {
      // Union provenance — never discard (602 §8.3).
      const union = new Set([...existing.contributingViewports, ...rule.contributingViewports])
      seen.set(key, { ...existing, contributingViewports: [...union] })
    }
  }
  return [...seen.values()]
}

function formatCondition(condition: AtRuleCondition): string {
  const keyword =
    condition.kind === 'media'
      ? '@media'
      : condition.kind === 'supports'
        ? '@supports'
        : condition.kind === 'container'
          ? '@container'
          : '@layer'
  return condition.conditionText.length > 0 ? `${keyword} ${condition.conditionText}` : keyword
}

interface WrapperGroup {
  readonly chain: readonly AtRuleCondition[]
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

function chainsEqual(a: readonly AtRuleCondition[], b: readonly AtRuleCondition[]): boolean {
  return a.length === b.length && a.every((v, i) => v.kind === b[i]?.kind && v.conditionText === b[i]?.conditionText)
}

function validateBalanced(css: string): void {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] as string
    // Braces inside quoted strings are literal text.
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
    throw new SerializationError('Serialized output has unbalanced braces', { context: { depth } })
  }
}

/**
 * 604 Check 2 (subset): every manifest construct appears in output exactly
 * once (INV-2). Uniqueness is per distinct cssText — two manifest nodes with
 * byte-identical at-rule text (e.g. the same @font-face inlined by two
 * bundles) legitimately share one emission.
 */
function validateDependencyCompleteness(css: string, uniqueDepTexts: ReadonlySet<string>): void {
  for (const cssText of uniqueDepTexts) {
    const first = css.indexOf(cssText)
    if (first === -1) {
      throw new SerializationError(`Dependency missing from output (INV-2 / MISSING_DEPENDENCY)`, {
        context: { cssText: cssText.slice(0, 80) },
      })
    }
    if (css.indexOf(cssText, first + 1) !== -1) {
      throw new SerializationError(`Dependency emitted more than once (INV-2)`, {
        context: { cssText: cssText.slice(0, 80) },
      })
    }
  }
}

interface Renderer {
  line(depth: number, text: string): void
  rule(depth: number, selector: string, declarations: string): void
  raw(depth: number, cssText: string): void
  finish(): string
}

function makeRenderer(config: SerializerConfig, minify: boolean): Renderer {
  const nl = config.lineEnding
  const parts: string[] = []
  if (minify) {
    // Conservative structural minification (603 safe subset): structural
    // whitespace only; declaration tokens stay verbatim; trailing `;`
    // before `}` dropped. Idempotent by construction.
    return {
      line: (_d, text) => parts.push(text),
      rule: (_d, selector, declarations) => {
        const decls = declarations.trimEnd().replace(/;$/, '')
        parts.push(`${selector}{${decls}}`)
      },
      raw: (_d, cssText) => parts.push(cssText),
      finish: () => parts.join(''),
    }
  }
  return {
    line: (depth, text) => parts.push(`${config.indent.repeat(depth)}${text}`),
    rule: (depth, selector, declarations) => {
      const pad = config.indent.repeat(depth)
      parts.push(`${pad}${selector} {`)
      if (declarations.length > 0) parts.push(`${pad}${config.indent}${declarations}`)
      parts.push(`${pad}}`)
    },
    raw: (depth, cssText) => parts.push(`${config.indent.repeat(depth)}${cssText}`),
    finish: () => (parts.length === 0 ? '' : parts.join(nl) + (config.trailingNewline ? nl : '')),
  }
}

export function serialize(
  input: MergedMultiViewportRuleSet,
  config: SerializerConfig = DEFAULT_SERIALIZER_CONFIG,
): SerializedArtifact {
  const deduped = referenceDedup(input.rules)
  const ordered = deduped.sort(compareMergedRules)
  const groups = groupByWrapperChain(ordered)
  const r = makeRenderer(config, config.minify)

  // 1. @layer statement prelude, declared (first-occurrence) order (601 §8.4)
  //    — emitted whenever layers were declared, empty layers included: they
  //    fix subsequent ranks.
  const layerOrder = input.layerDeclarationOrder ?? []
  if (layerOrder.length > 0) {
    r.line(0, `@layer ${layerOrder.join(', ')};`)
  }

  // 2. Dependency at-rules (INV-2: exactly once, syntactically valid
  //    position). Byte-identical at-rule texts collapse to one emission.
  const uniqueDepTexts = new Set<string>()
  for (const dep of input.dependencyManifest) {
    if (dep.cssText === null) continue
    if (uniqueDepTexts.has(dep.cssText)) continue
    uniqueDepTexts.add(dep.cssText)
    r.raw(0, dep.cssText)
  }

  // 3. Style rules: layered (rank order) then unlayered LAST — already the
  //    sort's doing; wrapper chains reconstructed, never flattened (601 §8.3).
  for (const group of groups) {
    let depth = 0
    for (const wrapper of group.chain) {
      r.line(depth, `${formatCondition(wrapper)} {`)
      depth += 1
    }
    for (const rule of group.rules) {
      r.rule(depth, rule.selectorText, rule.declarationText)
    }
    for (let d = group.chain.length - 1; d >= 0; d--) {
      r.line(d, '}')
    }
  }

  const css = r.finish()
  validateBalanced(css)
  validateDependencyCompleteness(css, uniqueDepTexts)
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

/** 606 inline-style envelope: sole legitimate byte divergence is `</style` escaping. */
export function toInlineStyle(artifact: SerializedArtifact, attributes: Record<string, string> = {}): string {
  const attrs = Object.entries({ 'data-critical': 'true', ...attributes })
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  const escaped = artifact.css.replace(/<\/style/gi, '\\3C /style')
  return `<style${attrs}>${escaped}</style>`
}

/** 606 json-envelope (metadata excluded from any content hashing). */
export function toJsonEnvelope(
  artifact: SerializedArtifact,
  meta: { route: string; viewport: string; extractionMode: string; engineVersion: string },
): string {
  return JSON.stringify(
    {
      schemaVersion: '1.0',
      route: meta.route,
      viewport: meta.viewport,
      css: artifact.css,
      sourceMap: null,
      metadata: {
        bytes: artifact.stats.byteLength,
        ruleCount: artifact.stats.ruleCount,
        dependencyCount: artifact.stats.dependencyCount,
        extractionMode: meta.extractionMode,
        engineVersion: meta.engineVersion,
      },
    },
    null,
    2,
  )
}
