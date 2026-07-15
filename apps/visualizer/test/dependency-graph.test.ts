import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ReportBundle, DependencyGraphReport } from '@critical-css/reporter'
import { layoutDependencyGraph } from '../src/viewmodel/dependency-graph.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function loadHomeGraph(): Promise<DependencyGraphReport> {
  const raw = await readFile(join(FIXTURES, 'reports', 'home.css.report.json'), 'utf8')
  const bundles = JSON.parse(raw) as ReportBundle[]
  const bundle = bundles.find((b) => b.viewportProfileId === 'desktop')
  if (bundle === undefined) throw new Error('fixture missing desktop bundle')
  return bundle.dependencyGraph
}

describe('layoutDependencyGraph', () => {
  it('lays out every real fixture node exactly once', async () => {
    const graph = await loadHomeGraph()
    const layout = layoutDependencyGraph(graph)
    expect(layout.positions.length).toBe(graph.nodes.length)
    expect(new Set(layout.positions.map((p) => p.id)).size).toBe(graph.nodes.length)
    expect(layout.cycleDetected).toBe(false)
    expect(layout.collapsed).toBe(false)
  })

  it('places roots (no incoming edges) at layer 0 for an edge-free graph', async () => {
    const graph = await loadHomeGraph()
    expect(graph.edges).toEqual([]) // this fixture has no dependency edges (M2/M3 stub for this fixture)
    const layout = layoutDependencyGraph(graph)
    expect(layout.positions.every((p) => p.layer === 0)).toBe(true)
  })

  it('layers a simple linear chain topologically', () => {
    const graph: DependencyGraphReport = {
      nodes: [
        { id: 'a', type: 'rule', value: '.a' },
        { id: 'b', type: 'rule', value: '.b' },
        { id: 'c', type: 'rule', value: '.c' },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'requires' },
        { from: 'b', to: 'c', kind: 'requires' },
      ],
    }
    const layout = layoutDependencyGraph(graph)
    const byId = new Map(layout.positions.map((p) => [p.id, p]))
    expect(byId.get('a')?.layer).toBe(0)
    expect(byId.get('b')?.layer).toBe(1)
    expect(byId.get('c')?.layer).toBe(2)
  })

  it('surfaces a cycle via cycleDetected rather than throwing (1005 §10.2)', () => {
    const graph: DependencyGraphReport = {
      nodes: [
        { id: 'a', type: 'rule', value: '.a' },
        { id: 'b', type: 'rule', value: '.b' },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'requires' },
        { from: 'b', to: 'a', kind: 'requires' },
      ],
    }
    expect(() => layoutDependencyGraph(graph)).not.toThrow()
    const layout = layoutDependencyGraph(graph)
    expect(layout.cycleDetected).toBe(true)
    expect(layout.positions.length).toBe(2)
  })

  it('flags collapsed once the node count exceeds the threshold', () => {
    const graph: DependencyGraphReport = {
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, type: 'rule', value: `.n${i}` })),
      edges: [],
    }
    const layout = layoutDependencyGraph(graph, 3)
    expect(layout.collapsed).toBe(true)
  })

  it('ignores dangling edges referencing an unknown node id rather than throwing', () => {
    const graph: DependencyGraphReport = {
      nodes: [{ id: 'a', type: 'rule', value: '.a' }],
      edges: [{ from: 'a', to: 'ghost', kind: 'requires' }],
    }
    expect(() => layoutDependencyGraph(graph)).not.toThrow()
  })
})
