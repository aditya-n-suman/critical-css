/**
 * Runtime CSS dependency graph model + incremental cycle detection
 * (docs/algorithms/507, 508).
 */

export type GraphNodeKind =
  | 'rule'
  | 'variable'
  | 'keyframes'
  | 'font-face'
  | 'property'
  | 'counter-style'
  | 'layer'

export type ResolutionState = 'pending' | 'resolved' | 'cyclic' | 'unresolved-error'

export type EdgeKind = 'references' | 'renders-via' | 'requires-registration' | 'layered-under'

export interface GraphNode {
  readonly id: string
  readonly kind: GraphNodeKind
  /** Construct identity: variable name, keyframes name, family, layer path, rule key. */
  readonly value: string
  /** Serialized backing rule text where one exists. */
  readonly cssText: string | null
  readonly discoveredAt: 'seed' | 'transitive'
  resolutionState: ResolutionState
}

export interface GraphEdge {
  readonly sourceId: string
  readonly targetId: string
  readonly kind: EdgeKind
}

export interface CycleReport {
  readonly foundCycle: boolean
  readonly cycleNodeIds: readonly string[]
  readonly entryPointId: string | null
}

/** Edge kinds that participate in cycle detection (508 scope). */
const CYCLE_SCOPED_KINDS: ReadonlySet<EdgeKind> = new Set(['references', 'layered-under'])

export class DependencyGraph {
  readonly nodesById = new Map<string, GraphNode>()
  readonly edgesBySource = new Map<string, GraphEdge[]>()
  readonly edgesByTarget = new Map<string, GraphEdge[]>()
  private readonly edgeKeys = new Set<string>()

  /** Idempotent-by-ID (507): returns whether the node was newly added. */
  addNode(node: GraphNode): { node: GraphNode; wasNew: boolean } {
    const existing = this.nodesById.get(node.id)
    if (existing !== undefined) return { node: existing, wasNew: false }
    this.nodesById.set(node.id, node)
    return { node, wasNew: true }
  }

  /** Only literal `${source}::${kind}::${target}` duplicates collapse (507). */
  addEdge(edge: GraphEdge): boolean {
    const key = `${edge.sourceId}::${edge.kind}::${edge.targetId}`
    if (this.edgeKeys.has(key)) return false
    this.edgeKeys.add(key)
    push(this.edgesBySource, edge.sourceId, edge)
    push(this.edgesByTarget, edge.targetId, edge)
    return true
  }

  outgoing(nodeId: string): readonly GraphEdge[] {
    return this.edgesBySource.get(nodeId) ?? []
  }

  pendingNodes(): GraphNode[] {
    return [...this.nodesById.values()].filter((n) => n.resolutionState === 'pending')
  }
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [edge])
  else list.push(edge)
}

/**
 * 508: incremental per-edge cycle check — explicit-stack three-color DFS from
 * the new edge's target, seeking a path back to its source. Colors are
 * transient per call; `resolutionState` is the durable base.
 */
export function checkForCycle(graph: DependencyGraph, newEdge: GraphEdge): CycleReport {
  if (!CYCLE_SCOPED_KINDS.has(newEdge.kind)) {
    return { foundCycle: false, cycleNodeIds: [], entryPointId: null }
  }
  const u = newEdge.sourceId
  const v = newEdge.targetId
  if (u === v) return recordCycle([u])

  const color = new Map<string, 'gray' | 'black'>()
  const parent = new Map<string, string | null>()
  parent.set(v, null)

  // Explicit stack — no native recursion (508: 500-link chain stress case).
  const stack: Array<{ nodeId: string; edgeIndex: number }> = [{ nodeId: v, edgeIndex: 0 }]
  color.set(v, 'gray')
  let found = false
  while (stack.length > 0 && !found) {
    const frame = stack[stack.length - 1] as { nodeId: string; edgeIndex: number }
    const edges = graph.outgoing(frame.nodeId).filter((e) => CYCLE_SCOPED_KINDS.has(e.kind))
    if (frame.edgeIndex >= edges.length) {
      color.set(frame.nodeId, 'black')
      stack.pop()
      continue
    }
    const edge = edges[frame.edgeIndex] as GraphEdge
    frame.edgeIndex += 1
    const target = edge.targetId
    if (target === u) {
      parent.set(target, frame.nodeId)
      found = true
      break
    }
    if (color.get(target) !== undefined) continue
    color.set(target, 'gray')
    parent.set(target, frame.nodeId)
    stack.push({ nodeId: target, edgeIndex: 0 })
  }

  if (!found) return { foundCycle: false, cycleNodeIds: [], entryPointId: null }

  const path: string[] = []
  let cursor: string | null = u
  while (cursor !== null && cursor !== v) {
    path.unshift(cursor)
    cursor = parent.get(cursor) ?? null
  }
  path.unshift(v)
  return recordCycle([...new Set(path)])
}

function recordCycle(cycleNodeIds: string[]): CycleReport {
  // Deterministic entry point: lexicographically smallest node id (508 / P5).
  const entryPointId = [...cycleNodeIds].sort()[0] ?? null
  return { foundCycle: true, cycleNodeIds, entryPointId }
}
