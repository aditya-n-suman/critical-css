/**
 * FixedPointResolver (docs/tasks/004, docs/design/500, docs/algorithms/507).
 *
 * Wave-based fixed-point iteration over the runtime CSS dependency graph:
 * seeds are the matched rules; each wave discovers referenced constructs
 * (variables, keyframes, font-faces, @property, @counter-style) from
 * registries built over the full CSSOM rule list. Terminates at the fixed
 * point (empty frontier) or the deterministic resolution budget.
 *
 * M2 note: candidate identification is lexical + registry-based and
 * deliberately over-inclusive (501 §8.1: false positives safe). The
 * browser-probe refinements (ancestor matching, getKeyframes(),
 * document.fonts load state) are M3 accuracy work.
 */

import { atRuleChainOf } from '@critical-css/collector'
import type { CssomRuleList, RuleNode } from '@critical-css/collector'
import type { MatchedRuleSet } from '@critical-css/matcher'
import { compareRuleIndexPaths, DependencyResolutionError } from '@critical-css/shared'
import type { AtRuleCondition, DependencyNode, Diagnostic } from '@critical-css/shared'
import {
  extractAnimationNames,
  extractCounterStyleRefs,
  extractCustomPropertyDeclarations,
  extractFontFamilies,
  extractVarReferences,
} from './extract.js'
import { DependencyGraph, checkForCycle } from './graph.js'
import type { GraphNode } from './graph.js'
import { buildLayerOrderRegistry } from './layer-registry.js'
import type { LayerOrderRegistry } from './layer-registry.js'

export interface TransitiveRule {
  /** The declaring style rule pulled in as a dependency (016 §8.7 inclusionReason: dependency-of). */
  readonly rule: RuleNode
  readonly stylesheetIndex: number
  readonly dependencyOf: readonly string[]
  /** Enclosing wrapper chain, outermost first — serializer input. */
  readonly atRuleChain: readonly AtRuleCondition[]
}

export interface ResolutionResult {
  readonly graph: DependencyGraph
  /** At-rule dependency manifest for the serializer (INV-2). */
  readonly manifest: readonly DependencyNode[]
  /** Variable-declaring style rules not already in the matched set. */
  readonly transitiveRules: readonly TransitiveRule[]
  readonly layerRegistry: LayerOrderRegistry
  readonly diagnostics: readonly Diagnostic[]
}

interface Registries {
  /** varName → declaring style rules (with sheet index). */
  variables: Map<string, Array<{ rule: RuleNode; sheet: number }>>
  keyframes: Map<string, Array<{ rule: RuleNode; sheet: number }>>
  fontFaces: Map<string, Array<{ rule: RuleNode; sheet: number }>>
  properties: Map<string, Array<{ rule: RuleNode; sheet: number }>>
  counterStyles: Map<string, Array<{ rule: RuleNode; sheet: number }>>
}

function buildRegistries(cssom: CssomRuleList): Registries {
  const registries: Registries = {
    variables: new Map(),
    keyframes: new Map(),
    fontFaces: new Map(),
    properties: new Map(),
    counterStyles: new Map(),
  }
  const add = (
    map: Map<string, Array<{ rule: RuleNode; sheet: number }>>,
    key: string,
    rule: RuleNode,
    sheet: number,
  ): void => {
    const list = map.get(key)
    if (list === undefined) map.set(key, [{ rule, sheet }])
    else list.push({ rule, sheet })
  }
  for (const sheet of cssom.stylesheets) {
    if (!sheet.accessible || sheet.disabled) continue
    for (const rule of sheet.rules) {
      const idx = sheet.sourceStylesheetIndex
      if (rule.ruleType === 'style') {
        for (const name of extractCustomPropertyDeclarations(rule.declarationText)) {
          add(registries.variables, name, rule, idx)
        }
      } else if (rule.ruleType === 'keyframes' && rule.conditionText !== null) {
        add(registries.keyframes, rule.conditionText, rule, idx)
      } else if (rule.ruleType === 'font-face') {
        for (const family of extractFontFamilies(rule.declarationText)) {
          add(registries.fontFaces, family, rule, idx)
        }
      } else if (rule.ruleType === 'property' && rule.conditionText !== null) {
        add(registries.properties, rule.conditionText, rule, idx)
      } else if (rule.ruleType === 'counter-style' && rule.conditionText !== null) {
        add(registries.counterStyles, rule.conditionText, rule, idx)
      }
    }
  }
  return registries
}

const ruleKey = (sheet: number, path: readonly number[]): string => `rule:${sheet}:${path.join('.')}`

/** Numeric element-wise source order — NEVER string comparison of joined
 * paths (lexicographic '10' < '2' inverts real cascade order). */
function compareCandidates(a: { rule: RuleNode; sheet: number }, b: { rule: RuleNode; sheet: number }): number {
  if (a.sheet !== b.sheet) return a.sheet - b.sheet
  return compareRuleIndexPaths(a.rule.ruleIndexPath, b.rule.ruleIndexPath)
}

/** Last-wins by (stylesheetIndex, ruleIndexPath) — 502/505. */
function lastWins(candidates: Array<{ rule: RuleNode; sheet: number }>): { rule: RuleNode; sheet: number } {
  return [...candidates].sort(compareCandidates)[candidates.length - 1] as { rule: RuleNode; sheet: number }
}

/** First-wins — 504's explicit contrast to cascade order. */
function firstWins(candidates: Array<{ rule: RuleNode; sheet: number }>): { rule: RuleNode; sheet: number } {
  return [...candidates].sort(compareCandidates)[0] as { rule: RuleNode; sheet: number }
}

export class FixedPointResolver {
  resolve(matched: MatchedRuleSet, cssom: CssomRuleList, resolutionBudget?: number): ResolutionResult {
    const graph = new DependencyGraph()
    const diagnostics: Diagnostic[] = []
    const registries = buildRegistries(cssom)
    const layerRegistry = buildLayerOrderRegistry(cssom)
    const knownKeyframes = new Set(registries.keyframes.keys())
    const knownCounterStyles = new Set(registries.counterStyles.keys())
    const budget = resolutionBudget ?? Math.max(500, matched.matches.length * 20)

    // Rule-node payloads: declaration text to scan + provenance.
    const rulePayload = new Map<string, { declarationText: string; sheet: number; ruleNode: RuleNode | null }>()
    const transitiveRuleNodes = new Map<string, TransitiveRule>()
    const rulesBySheet = new Map<number, ReadonlyMap<number, RuleNode>>()
    for (const sheet of cssom.stylesheets) {
      rulesBySheet.set(sheet.sourceStylesheetIndex, new Map(sheet.rules.map((r) => [r.ruleId, r])))
    }

    let currentWave: GraphNode[] = []
    const enqueue = (node: GraphNode): void => {
      const result = graph.addNode(node)
      if (result.wasNew) currentWave.push(result.node)
    }

    for (const match of matched.matches) {
      const id = ruleKey(match.stylesheetIndex, match.ruleIndexPath)
      rulePayload.set(id, { declarationText: match.declarationText, sheet: match.stylesheetIndex, ruleNode: null })
      enqueue({
        id,
        kind: 'rule',
        value: match.selectorText,
        cssText: null,
        discoveredAt: 'seed',
        resolutionState: 'pending',
      })
    }

    const addEdgeChecked = (sourceId: string, targetId: string, kind: 'references' | 'renders-via' | 'requires-registration'): void => {
      if (!graph.addEdge({ sourceId, targetId, kind })) return
      const report = checkForCycle(graph, { sourceId, targetId, kind })
      if (report.foundCycle) {
        for (const id of report.cycleNodeIds) {
          const node = graph.nodesById.get(id)
          if (node !== undefined) node.resolutionState = 'cyclic'
        }
        diagnostics.push({
          severity: 'warning',
          code: 'CYCLIC_DEPENDENCY',
          message: `Dependency cycle detected: ${report.cycleNodeIds.join(' → ')} (entry ${report.entryPointId ?? '?'})`,
          context: { cycle: [...report.cycleNodeIds], edgeKind: kind },
        })
      }
    }

    let totalProcessed = 0
    while (currentWave.length > 0) {
      totalProcessed += currentWave.length
      if (totalProcessed > budget) {
        throw new DependencyResolutionError(
          `Resolution budget (${budget}) exceeded — pathological dependency chain or runaway discovery`,
          { context: { budget, pending: graph.pendingNodes().map((n) => n.id) } },
        )
      }
      const nextWave: GraphNode[] = []
      const enqueueNext = (node: GraphNode): string => {
        const result = graph.addNode(node)
        if (result.wasNew) nextWave.push(result.node)
        return result.node.id
      }

      for (const node of currentWave) {
        if (node.resolutionState !== 'pending') continue
        try {
          if (node.kind === 'rule') {
            const payload = rulePayload.get(node.id)
            const text = payload?.declarationText ?? ''
            for (const ref of extractVarReferences(text)) {
              const varId = enqueueNext({
                id: `variable:${ref.propertyName}`,
                kind: 'variable',
                value: ref.propertyName,
                cssText: null,
                discoveredAt: 'transitive',
                resolutionState: 'pending',
              })
              addEdgeChecked(node.id, varId, 'references')
            }
            for (const name of extractAnimationNames(text, knownKeyframes)) {
              const candidates = registries.keyframes.get(name)
              if (candidates === undefined) {
                diagnostics.push({
                  severity: 'warning',
                  code: 'MISSING_KEYFRAMES',
                  message: `animation-name "${name}" has no @keyframes rule (REQ-452)`,
                })
                continue
              }
              const winner = lastWins(candidates)
              const kfId = enqueueNext({
                id: `keyframes:${name}:${winner.sheet}:${winner.rule.ruleIndexPath.join('.')}`,
                kind: 'keyframes',
                value: name,
                cssText: winner.rule.declarationText,
                discoveredAt: 'transitive',
                resolutionState: 'pending',
              })
              addEdgeChecked(node.id, kfId, 'renders-via')
            }
            for (const family of extractFontFamilies(text)) {
              const candidates = registries.fontFaces.get(family)
              if (candidates === undefined) continue // generic/system font — not a dependency
              // 503: matching selects a SET (conservative inclusion).
              for (const candidate of candidates) {
                const ffId = enqueueNext({
                  id: `font-face:${family}:${candidate.sheet}:${candidate.rule.ruleIndexPath.join('.')}`,
                  kind: 'font-face',
                  value: family,
                  cssText: candidate.rule.declarationText,
                  discoveredAt: 'transitive',
                  resolutionState: 'pending',
                })
                addEdgeChecked(node.id, ffId, 'renders-via')
              }
            }
            for (const styleName of extractCounterStyleRefs(text, knownCounterStyles)) {
              const candidates = registries.counterStyles.get(styleName)
              if (candidates === undefined) continue
              const winner = lastWins(candidates)
              const csId = enqueueNext({
                id: `counter-style:${styleName}`,
                kind: 'counter-style',
                value: styleName,
                cssText: winner.rule.declarationText,
                discoveredAt: 'transitive',
                resolutionState: 'pending',
              })
              addEdgeChecked(node.id, csId, 'renders-via')
            }
          } else if (node.kind === 'variable') {
            const varName = node.value
            // @property registration (504, first-wins): always required when present.
            const registrations = registries.properties.get(varName)
            if (registrations !== undefined) {
              const winner = firstWins(registrations)
              const propId = enqueueNext({
                id: `property:${varName}`,
                kind: 'property',
                value: varName,
                cssText: winner.rule.declarationText,
                discoveredAt: 'transitive',
                resolutionState: 'pending',
              })
              addEdgeChecked(node.id, propId, 'requires-registration')
            }
            const declaring = registries.variables.get(varName)
            if (declaring === undefined) {
              diagnostics.push({
                severity: 'warning',
                code: 'MISSING_VARIABLE_DECLARATION',
                message: `var(${varName}) is referenced but never declared (REQ-452/REQ-503)`,
              })
            } else {
              for (const { rule, sheet } of declaring) {
                const declRuleId = ruleKey(sheet, rule.ruleIndexPath)
                if (!rulePayload.has(declRuleId)) {
                  rulePayload.set(declRuleId, { declarationText: rule.declarationText, sheet, ruleNode: rule })
                  const byId = rulesBySheet.get(sheet)
                  transitiveRuleNodes.set(declRuleId, {
                    rule,
                    stylesheetIndex: sheet,
                    dependencyOf: [node.id],
                    atRuleChain: byId !== undefined ? atRuleChainOf(rule, byId) : [],
                  })
                }
                const rid = enqueueNext({
                  id: declRuleId,
                  kind: 'rule',
                  value: rule.selectorText ?? '',
                  cssText: null,
                  discoveredAt: 'transitive',
                  resolutionState: 'pending',
                })
                // The variable's value derives from its declaring rule —
                // 'references' scope makes var-chain cycles detectable (508).
                addEdgeChecked(node.id, rid, 'references')
              }
            }
          }
          // keyframes / font-face / property / counter-style nodes are
          // terminal at M2 depth (505 fallback chasing deferred).
          if (node.resolutionState === 'pending') node.resolutionState = 'resolved'
        } catch (err) {
          node.resolutionState = 'unresolved-error'
          diagnostics.push({
            severity: 'error',
            code: 'DEPENDENCY_DISCOVERY_FAILED',
            message: `Discovery failed for ${node.id}: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
      currentWave = nextWave
    }

    // Manifest: every non-rule construct node with backing css text (INV-2).
    const manifest: DependencyNode[] = []
    for (const node of graph.nodesById.values()) {
      if (node.kind === 'rule' || node.kind === 'layer') continue
      manifest.push({
        id: node.id,
        type: node.kind === 'variable' ? 'variable' : node.kind,
        value: node.value,
        cssText: node.cssText,
        dependents: (graph.edgesByTarget.get(node.id) ?? []).map((e) => e.sourceId),
        dependencies: graph.outgoing(node.id).map((e) => e.targetId),
      })
    }
    manifest.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    return {
      graph,
      manifest,
      transitiveRules: [...transitiveRuleNodes.values()],
      layerRegistry,
      diagnostics,
    }
  }
}
