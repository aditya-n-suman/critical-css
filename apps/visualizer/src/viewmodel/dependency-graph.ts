/**
 * Dependency graph explorer view-model (docs/design/1005-Debug-UI.md §8.3.3,
 * §10.2's layered-DAG layout algorithm). Pure layout over
 * `DependencyGraphReport` — no graph algorithm beyond layout, per 1005 §8.3.3.
 */

import type { DependencyGraphReport } from '@critical-css/reporter'

export interface GraphNodePosition {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly layer: number
}

export interface LayoutResult {
  readonly positions: readonly GraphNodePosition[]
  readonly edges: DependencyGraphReport['edges']
  /** True when the collapse threshold (1005 §10.2) was exceeded. */
  readonly collapsed: boolean
  /** Present (and non-throwing) even for cyclic input — see 1005 §10.2 "Failure cases". */
  readonly cycleDetected: boolean
}

const LAYER_HEIGHT = 80
const NODE_WIDTH = 140

/**
 * Kahn's-algorithm layered DAG layout (1005 §10.2). A cycle is structurally
 * impossible per the dependency resolver's fixed-point guarantee (500), but
 * this function must not throw if one somehow reaches it — 1005 §10.2's
 * "Failure cases" treats a cycle as "a hard error surfaced prominently... not
 * silently worked around." We surface it via `cycleDetected`, laying out
 * whatever DID resolve topologically and leaving the rest at layer 0 rather
 * than crashing the view.
 */
export function layoutDependencyGraph(
  graph: DependencyGraphReport,
  collapseThreshold = 500,
): LayoutResult {
  const nodeIds = graph.nodes.map((n) => n.id)
  const outEdges = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const id of nodeIds) {
    outEdges.set(id, [])
    inDegree.set(id, 0)
  }
  for (const edge of graph.edges) {
    if (!outEdges.has(edge.from) || !inDegree.has(edge.to)) continue // dangling edge, ignore rather than throw
    outEdges.get(edge.from)?.push(edge.to)
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
  }

  const layerOf = new Map<string, number>()
  let queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort()
  const remainingInDegree = new Map(inDegree)
  let layer = 0
  const visited = new Set<string>()
  while (queue.length > 0) {
    const next: string[] = []
    for (const id of queue) {
      layerOf.set(id, layer)
      visited.add(id)
      for (const target of outEdges.get(id) ?? []) {
        const remaining = (remainingInDegree.get(target) ?? 0) - 1
        remainingInDegree.set(target, remaining)
        if (remaining === 0 && !visited.has(target)) next.push(target)
      }
    }
    queue = [...new Set(next)].sort()
    layer += 1
  }

  const cycleDetected = visited.size < nodeIds.length
  // Unvisited nodes (part of a cycle, or downstream of one) get layer 0 —
  // still rendered, never dropped, per 1005 §10.2's "surfaced prominently."
  for (const id of nodeIds) {
    if (!layerOf.has(id)) layerOf.set(id, 0)
  }

  const collapsed = nodeIds.length > collapseThreshold
  const perLayerCount = new Map<number, number>()
  const positions: GraphNodePosition[] = nodeIds
    .slice()
    .sort()
    .map((id) => {
      const l = layerOf.get(id) ?? 0
      const indexInLayer = perLayerCount.get(l) ?? 0
      perLayerCount.set(l, indexInLayer + 1)
      return { id, layer: l, x: indexInLayer * NODE_WIDTH, y: l * LAYER_HEIGHT }
    })

  return { positions, edges: graph.edges, collapsed, cycleDetected }
}
