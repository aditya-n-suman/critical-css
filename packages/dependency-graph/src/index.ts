/**
 * @critical-css/dependency-graph — public API barrel (AT-06, M2 slice:
 * FixedPointResolver + cycle detection + LayerOrderRegistry; the Hybrid
 * strategy composer lands in M3).
 */

export { FixedPointResolver } from './resolver.js'
export type { ResolutionResult, TransitiveRule } from './resolver.js'
export { reconcileHybrid, coverageOnlyRules } from './hybrid.js'
export type { HybridReconciliation } from './hybrid.js'
export { DependencyGraph, checkForCycle } from './graph.js'
export type { GraphNode, GraphEdge, GraphNodeKind, EdgeKind, CycleReport, ResolutionState } from './graph.js'
export { buildLayerOrderRegistry, UNLAYERED_RANK } from './layer-registry.js'
export type { LayerOrderRegistry } from './layer-registry.js'
export {
  extractVarReferences,
  extractCustomPropertyDeclarations,
  extractAnimationNames,
  extractFontFamilies,
  extractCounterStyleRefs,
} from './extract.js'
export type { VarReference } from './extract.js'
