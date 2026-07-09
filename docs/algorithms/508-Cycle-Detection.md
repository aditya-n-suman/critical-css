# 508 — Cycle Detection

## 1. Title

**Critical CSS Extraction Engine — Incremental Cycle Detection in the Runtime CSS Dependency Graph**

## 2. Version

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | Draft — Phase 7 (Dependency Resolution) |
| Last Updated | 2026-07-09 |
| Owners | Core Architecture Working Group |
| Stability | Fulfills the binding contract established in [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7 and Section 9.2 (`CycleDetector` interface). Algorithm choice is considered stable; complexity constants may be refined once `packages/dependency-graph` has production telemetry. |

## 3. Purpose

This document specifies the concrete algorithm the Dependency Resolver uses to detect cycles in the runtime CSS dependency graph while that graph is under active, incremental construction by the fixed-point resolution loop (`../design/500-Dependency-Resolution-Overview.md`). [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) established the architectural contract — where cycle detection sits in the pipeline, which edge kinds it must consider, and what the system must do once a cycle is found — but deliberately deferred the traversal algorithm itself to this document. This document discharges that deferral: it names the algorithm, proves its correctness and complexity, gives full pseudocode, and specifies the exact recovery behavior (marking nodes `cyclic`, computing the browser-mirroring "guaranteed-invalid value" semantics, and letting the rest of the graph continue resolving) so that an implementer can build `packages/dependency-graph`'s `CycleDetector` component directly from this document without needing to make any further judgment calls about *how* cycles are found.

Cycles in this graph are not a hypothetical edge case reserved for adversarial input. `--a: var(--b); --b: var(--a);` is a two-line, syntactically valid stylesheet that any developer can write by accident (most commonly during a refactor that renames a variable and leaves a stale self-reference behind, or when two design-system components each try to fall back to the other's themed token). Contrived circular `@import` chains are rarer in practice — browsers already break `@import` cycles at the CSSOM level, per the CSS Object Model specification's `@import` cycle-avoidance rule, so a `CSSStyleSheet` object arising from a cyclic `@import` chain never actually contains the cyclic edge by the time the CSSOM Walker (`packages/collector`) observes it — but a defensive engine cannot assume every browser engine implements this correctly in every version, and the dependency graph must not silently trust that assumption without a fallback. Cascade-layer cycles are, per specification, structurally impossible (layer order is defined by first-declaration order, which is inherently acyclic), yet [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 12 explicitly keeps `layered-under` in the cycle-detection scope defensively, against the possibility of a non-compliant engine. This document's algorithm must therefore be general enough to catch all three cases — variable cycles (the common case), residual import-graph anomalies (the defensive case), and layer-order anomalies (the belt-and-suspenders case) — with one uniform mechanism, rather than three bespoke checks.

## 4. Audience

- Implementers of `packages/dependency-graph`'s `CycleDetector` component, who will translate this document's pseudocode directly into TypeScript.
- Implementers of the `FixedPointResolver` (Section 10.1 of [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md)), who invoke `CycleDetector.checkForCycle` on every qualifying edge addition and must understand its calling contract, return shape, and complexity budget.
- Implementers of `../algorithms/501-CSS-Variables.md` and `../algorithms/506-Cascade-Layers.md`, whose discovery routines produce the `references`, `inherits-from`, and `layered-under` edges this algorithm consumes, and who need to know precisely which edge kinds trigger a cycle check and which do not.
- Authors of `../design/500-Dependency-Resolution-Overview.md`, who situate this algorithm within the broader fixed-point resolution narrative and must accurately describe termination guarantees to readers who have not read this document in full.
- Authors of the Reporter module (`packages/reporter`), who must render `CyclicDependencyWarning` diagnostics faithfully, including the deterministic cycle-entry-point selection this document specifies.
- Senior engineers auditing the engine's termination guarantees — this document is the primary evidence artifact for the claim "the fixed-point resolution loop always terminates."

Readers are assumed to be comfortable with directed graph theory (strongly connected components, DFS edge classification into tree/back/forward/cross edges), amortized complexity analysis, and the CSS Custom Properties specification's cyclic-reference resolution rules. This is not an introduction to graph algorithms.

## 5. Prerequisites

- [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) in full, and Section 8.7 ("Cycle Handling — Architectural Contract") and Section 9.2 (`CycleDetector` class shape) specifically — this document implements that contract and must not silently deviate from any bullet in Section 8.7.
- [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2 (Edge Taxonomy) — the scoping argument restricting cycle detection to `references`, `inherits-from`, and `layered-under` edges is assumed and not re-derived here.
- [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.6 (Resolution to a Fixed Point) and Section 10.1 (Fixed-Point Graph Resolution algorithm) — this document's algorithm is invoked from inside that loop, at the exact point marked `CycleCheck` in that document's flowchart.
- `../design/500-Dependency-Resolution-Overview.md` — the Phase 7 document that narrates the end-to-end resolution story this algorithm is one component of.
- `../algorithms/501-CSS-Variables.md` — the discovery algorithm that produces the majority of `references` edges this document's algorithm will encounter in practice.
- `../algorithms/506-Cascade-Layers.md` — the discovery algorithm that produces `layered-under` edges.
- `../algorithms/507-Dependency-Graph-Construction.md` — the general node/edge construction discipline (ID stability, single-writer mutation) this algorithm relies on.
- Familiarity with W3C CSS Custom Properties for Cascading Variables Module Level 1, specifically the "guaranteed-invalid value" and cyclic-reference resolution sections.
- Familiarity with Tarjan's and Kahn's classical graph algorithms, referenced comparatively in Section 8 below.

## 6. Related Documents

- [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) — architectural contract this document fulfills.
- `../design/500-Dependency-Resolution-Overview.md` — overall Phase 7 narrative; forward-referenced from [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md), written in this same session.
- `../algorithms/501-CSS-Variables.md` — custom property discovery; primary producer of `references`/`inherits-from` edges.
- `../algorithms/502-Keyframes.md` — `renders-via` edge producer (out of this document's cycle-detection scope, but relevant context for why that edge kind is excluded).
- `../algorithms/503-Font-Faces.md` — `renders-via` edge producer (same scoping note).
- `../algorithms/504-At-Property.md` — `requires-registration` edge producer; also the source of `inherits: false` semantics that interact with cycle detection's `inherits-from` handling (Section 12).
- `../algorithms/505-Counters.md` — `renders-via` edge producer (same scoping note).
- `../algorithms/506-Cascade-Layers.md` — `layered-under` edge producer.
- `../algorithms/507-Dependency-Graph-Construction.md` — the general node/edge construction algorithm this document's `CycleDetector` plugs into via the `FixedPointResolver`.
- [006-Design-Principles.md](../architecture/006-Design-Principles.md) — Principle 1 (Browser Is Source of Truth), Principle 5 (Determinism of Output), Principle 6 (fail loud, fail diagnosably).
- [007-Repository-Structure.md](../architecture/007-Repository-Structure.md) — Tarjan's SCC algorithm was already used there for the *unrelated* package-level build graph; Section 8 of this document compares and distinguishes the two uses.

## 7. Overview

The `CycleDetector` component (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 9.2's class diagram) is invoked once for every newly added edge whose kind is `references`, `inherits-from`, or `layered-under` — never in a single batch pass over the finished graph, and never for `renders-via`, `conditioned-by`, or `requires-registration` edges, which are architecturally acyclic by construction. Each invocation must answer one question cheaply: *does adding this specific edge close a cycle?* If yes, it must identify every node participating in that cycle, mark them `cyclic`, and hand back a deterministic, canonically-ordered report so the rest of the fixed-point loop can continue past the cyclic subgraph without aborting.

This document selects **incremental depth-first search with a three-color node-marking scheme, scoped to a single new-edge check, rather than a full-graph Tarjan's strongly-connected-components pass**, as the concrete algorithm. Section 8 lays out the comparison against Tarjan's SCC (and against Johnson's algorithm, and against maintaining a live topological order) in full, but the short version is: this graph is built one edge at a time inside a loop that must decide, after every edge, whether to keep going or to contain a cycle — the natural unit of work is "did *this* edge create a cycle," not "what are all the SCCs of the graph as it exists right now." A per-edge, localized DFS answers exactly that question, touches only the nodes reachable from the new edge's target back to its source, and costs nothing on iterations that add zero-cycle-risk edges (which, in the overwhelming majority of real stylesheets, is all of them). Tarjan's algorithm is the right tool when you need every SCC of a static graph in one pass; it is the wrong tool for "cheaply re-validate an invariant after one incremental mutation," which is the actual shape of this problem as [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7 mandates it ("MUST run incrementally... not as a single batch pass").

Once a cycle is detected, the algorithm's second responsibility is recovery, not just detection: it must mark every node on the discovered cycle `cyclic`, compute (for `Variable` nodes specifically) the guaranteed-invalid-value semantics the CSS Custom Properties specification mandates for cyclic custom property references, emit a `CyclicDependencyWarning` diagnostic with a deterministic entry point, and return control to the `FixedPointResolver` so it can proceed to the next item in the discovery queue. The cycle is *broken* not by deleting the cyclic edge (the graph retains it for diagnostic fidelity — a developer debugging "why did my variable disappear" needs to see the actual cyclic reference chain, not a silently pruned graph) but by short-circuiting further traversal through `cyclic`-state nodes, which is sufficient to guarantee the outer fixed-point loop still terminates.

## 8. Detailed Design

### 8.1 Algorithm Choice — Colored DFS vs. Tarjan's SCC vs. Alternatives

**Decision: Incremental, per-edge, three-color DFS ("white/gray/black" marking), seeded from the target endpoint of each newly added qualifying edge.**

**Why.** The invocation pattern this algorithm lives inside — [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 10.1's pseudocode, specifically the line `cycleReport = CycleDetector.checkForCycle(graph, edge)` inside the `for edge in discovery.newEdges` loop — calls this component once per edge, immediately after that edge is added, while the graph is still growing and the majority of nodes are still `pending`. A full Tarjan's-SCC pass recomputes strongly-connected-component membership for the *entire* graph in `O(V + E)` every time it runs; invoking it after every single edge addition would make total construction cost `O((V + E) × E)` in the worst case — quadratic in edge count — because each of the `E` edge-addition events would re-scan the whole graph-so-far. A colored DFS seeded specifically from the new edge's target endpoint, searching only for a path back to the new edge's source endpoint, costs at most `O(V + E)` **once**, but in the overwhelming common case (a new edge whose target has few or no outgoing edges yet, which is true for the vast majority of freshly-discovered `Variable`/`Layer` nodes) costs close to `O(1)` — proportional to the small local neighborhood actually reachable from the new edge's target, not the whole graph. Summed across all `E` qualifying edges over the graph's construction, total cycle-detection cost is bounded by `O(V + E)` amortized (Section 10 proves this bound formally), which is asymptotically no worse than a single Tarjan's pass over the finished graph would have cost, while additionally giving the *incremental* answer the fixed-point loop actually needs at each step, which a single end-of-construction Tarjan's pass cannot: by the time a full-graph Tarjan's pass could run, the loop would already have iterated indefinitely on the cyclic subgraph, precisely the failure mode [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7 identifies as unacceptable ("a fixed-point loop that does not check for cycles as it goes could iterate indefinitely on a cyclic subgraph before ever reaching a 'final' state to check").

**Alternatives considered.**

1. **Tarjan's SCC algorithm, run once after the graph reaches a naive local fixed point (i.e., run it lazily, only when the discovery queue empties).** This was the most seriously considered alternative, precisely because [007-Repository-Structure.md](../architecture/007-Repository-Structure.md) already uses Tarjan's SCC for the unrelated package-level dependency graph, and reusing one well-understood algorithm across both graphs has real engineering-consistency appeal. It fails here for the reason stated above: the discovery queue *cannot* be guaranteed to empty on a cyclic subgraph without incremental detection, because two mutually-referencing `Variable` nodes each perpetually discover "one more" reference to the other every time either is dequeued — `--a: var(--b)` discovers `--b`; processing `--b: var(--a)` re-discovers `--a`, which (absent the `resolutionState != 'pending'` guard already present in [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 10.1's pseudocode) would never converge to an empty queue at all. The `pending`-state guard alone prevents infinite *re-processing* of the same node, but does not, on its own, prevent the two nodes from sitting in the graph forever in `pending` state with an unresolved dependency on each other — something has to be the mechanism that flips them to a terminal state. Waiting for "queue empties" as the trigger for Tarjan's pass conflates "queue is empty" with "graph is acyclic," which are not the same statement in the presence of the very cycles this algorithm must handle.
2. **Johnson's algorithm (enumerate all elementary cycles).** Rejected as overkill: Johnson's algorithm answers "list every simple cycle in the graph," which is strictly more information than needed. The resolver needs only "is *this new edge* part of a cycle, and if so, which nodes are in it" — a reachability question, not an enumeration question. Johnson's algorithm's complexity, `O((V + E)(C + 1))` where `C` is the number of elementary cycles, is also strictly worse than the colored-DFS approach for this graph's expected shape (few or zero cycles, small `C`), and its output (all cycles, including cycles that share nodes) is harder to map onto the "mark implicated nodes `cyclic`" recovery action than a single localized DFS's back-edge path.
3. **Maintain a live topological order incrementally (e.g., via the PK/Marchetti-Spaccamela-style incremental topological-sort-with-cycle-detection algorithms).** These algorithms provide strong amortized bounds (`O(V^{1.5})` or better across a full sequence of edge insertions in some variants) and are the theoretically optimal choice for extremely large, edge-insertion-dominated graphs. Rejected for this graph specifically because the runtime CSS dependency graph is small in absolute terms (Section 14; realistically a few hundred nodes even for large enterprise stylesheets, per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 10.1's complexity analysis), so the asymptotic advantage of incremental-topological-order algorithms over simple per-edge DFS is never realized in practice, while their implementation complexity and the cognitive cost of maintaining an additional persistent topological-order data structure (with its own invariants to keep correct under the `member-of`/edge-kind bookkeeping already present) is strictly higher. This is flagged in Future Work (Section 16) as worth revisiting only if production telemetry ever shows graphs an order of magnitude larger than currently observed.
4. **Union-Find (Disjoint Set) for cycle detection.** Standard Union-Find efficiently detects cycles in *undirected* graphs during Kruskal's-style construction, but the runtime CSS dependency graph is directed, and its edges are not symmetric (`A references B` does not imply `B references A`); a naive Union-Find would falsely flag a diamond-shaped DAG (`A -> B`, `A -> C`, `B -> D`, `C -> D`) as cyclic because it cannot distinguish "two paths converge on the same node" from "a path returns to an ancestor." Rejected outright as directionally unsound for this graph.

**Tradeoffs accepted.** The colored-DFS approach requires the graph to correctly maintain node colors (`resolutionState` doubling, in effect, as part of the color scheme — Section 8.3 below) across many small, incremental invocations rather than computing colors fresh in one pass, which means a latent bug in color bookkeeping could persist undetected across many edge additions rather than being caught by a single, easily-tested batch computation. This is mitigated by the unit-testing strategy in Section 15, which specifically exercises multi-step incremental sequences, not just single-shot full-graph fixtures.

### 8.2 Problem Restated Precisely

Given a directed graph `G = (N, E_all)` under incremental construction, and a newly added edge `e = (u, v)` where `e.kind ∈ {references, inherits-from, layered-under}`, determine whether `e` creates a cycle in the subgraph `G' = (N, E')` where `E' = {edges in E_all with kind ∈ {references, inherits-from, layered-under}}` (the cycle-detection-scoped subgraph per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2). A cycle exists if and only if, after adding `e`, there is a path in `E'` from `v` back to `u` (equivalently: `v` was already able to reach `u` via `E'`-edges *before* `e` was added, and now `e` closes the loop). If such a cycle exists, identify the full set of nodes on the shortest such `v -> ... -> u` path (plus `u` and `v` themselves), which constitutes the reported cycle.

### 8.3 Color Scheme, Reusing `resolutionState`

Classical colored DFS for cycle detection in a static graph uses three colors: **white** (unvisited), **gray** (on the current DFS recursion stack — an ancestor of the node currently being explored), and **black** (fully explored, all descendants processed). A back edge — an edge from a gray node to another gray node — is the signature of a cycle.

This algorithm reuses the graph's existing `resolutionState` field (`pending | resolved | cyclic | unresolved-error`, per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.1) as the *base* state, and layers a **transient, DFS-call-scoped color map** (`Map<nodeId, 'gray' | 'black'>`, allocated fresh for each `checkForCycle` invocation and discarded when it returns) on top, rather than trying to encode "currently on this particular DFS's stack" as a permanent graph-level field. This separation matters: `resolutionState` is a durable, graph-lifetime property (a node stays `resolved` across many future edge additions elsewhere in the graph); "is this node on the stack of the DFS call happening *right now*, checking *this* edge" is a property that must not leak between separate `checkForCycle` invocations, or a node visited-and-released as part of one edge's check could be incorrectly treated as still "on stack" during a completely unrelated later check. Conflating the two would be a subtle, hard-to-reproduce bug; keeping them separate makes each `checkForCycle` call a pure, self-contained function of the graph's current edge set plus the one new edge, with no hidden cross-call state — directly supporting the single-writer, side-effect-scoped discipline [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 11 already mandates for graph mutation.

A node whose `resolutionState` is already `cyclic` from a *previous* detected cycle is treated, for the purposes of a *new* DFS call, as an immediate positive signal if reached — reaching an already-`cyclic` node during the search for a path from `v` back to `u` does not itself prove the new edge `e` is part of a cycle (the old cycle and the new potential cycle may be unrelated), so the algorithm does not shortcut on this alone; it is a note for Section 12's edge cases, not an optimization applied in the base algorithm below.

## 9. Architecture

The following diagram walks through the canonical two-variable cycle — `--a: var(--b); --b: var(--a);`, both declared on `:root`, with a `Rule` node `.card` referencing `--a` — as it is discovered edge-by-edge by the fixed-point loop, showing the exact moment `checkForCycle` fires and what state results.

```mermaid
sequenceDiagram
    participant FPR as FixedPointResolver
    participant G as DependencyGraph
    participant CD as CycleDetector

    Note over FPR,G: Seed: Rule ".card" (pending), references --a
    FPR->>G: addNode(Variable --a), addEdge(.card -references-> --a)
    FPR->>CD: checkForCycle(G, edge=.card->--a)
    CD-->>FPR: no cycle (--a has no outgoing edges yet)
    FPR->>G: mark .card resolved (its only new dependency is --a, now pending)

    Note over FPR,G: Discover --a's own reference to --b
    FPR->>G: addNode(Variable --b), addEdge(--a -references-> --b)
    FPR->>CD: checkForCycle(G, edge=--a->--b)
    CD-->>FPR: no cycle (--b has no outgoing edges yet)
    FPR->>G: mark --a resolved... but --b still pending, discovery continues

    Note over FPR,G: Discover --b's reference back to --a — THE closing edge
    FPR->>G: addEdge(--b -references-> --a)
    FPR->>CD: checkForCycle(G, edge=--b->--a)
    Note right of CD: DFS from target(--a) seeking source(--b):<br/>--a -references-> --b  ⇒ path found!<br/>cycle = [--a, --b]
    CD-->>FPR: CYCLE FOUND: [--a, --b], entry point = "--a" (lexicographically smallest)
    FPR->>G: mark --a.resolutionState = cyclic
    FPR->>G: mark --b.resolutionState = cyclic
    FPR->>FPR: emit CyclicDependencyWarning(entry="--a", cycle=[--a,--b])
    Note over FPR,G: .card remains resolved; its guaranteed-invalid<br/>value is computed downstream (Section 9)
```

```mermaid
graph LR
    RC["Rule: .card<br/>(resolved)"]
    VA["Variable: --a<br/>(cyclic)"]
    VB["Variable: --b<br/>(cyclic)"]

    RC -->|references| VA
    VA -->|references| VB
    VB -.->|references — closing edge,<br/>detected by CycleDetector| VA

    classDef resolved fill:#1a3,stroke:#063,color:#fff;
    classDef cyclic fill:#a13,stroke:#600,color:#fff;
    class RC resolved;
    class VA,VB cyclic;
```

The dashed edge in the second diagram is the literal graph edge that closes the cycle; it is retained in the graph (not deleted) for diagnostic fidelity, per Section 7's recovery philosophy, but both endpoints are flagged `cyclic` so that no further traversal treats either node's `references` edges as something still needing resolution.

## 10. Algorithms

```text
// Called by FixedPointResolver immediately after adding a qualifying edge.
// graph: DependencyGraph (mutated in place on cycle detection)
// newEdge: GraphEdge, with newEdge.kind in {references, inherits-from, layered-under}
// Returns: CycleReport { foundCycle: bool, cycleNodeIds: string[], entryPointId: string | null }

function checkForCycle(graph, newEdge) -> CycleReport:
    u = newEdge.sourceId
    v = newEdge.targetId

    if u == v:
        // Trivial self-loop, e.g. a stale "--a: var(--a)" left over from a bad refactor.
        return recordCycle(graph, [u])

    // Colors are scoped to this single call; never persisted on the graph itself.
    color = new Map<string, 'gray' | 'black'>()
    parent = new Map<string, string>()   // for path reconstruction
    path = null

    function dfs(nodeId) -> bool:   // returns true iff nodeId can reach `u`
        if nodeId == u:
            return true
        if color.get(nodeId) == 'black':
            return false             // fully explored, provably cannot reach u
        color.set(nodeId, 'gray')

        for edge in graph.outgoingEdgesOfKindScoped(nodeId, {'references','inherits-from','layered-under'}):
            target = edge.targetId
            if color.get(target) == 'gray':
                continue              // an unrelated cycle already known; not this search's concern
            parent.set(target, nodeId)
            if dfs(target):
                color.set(nodeId, 'black')
                return true

        color.set(nodeId, 'black')
        return false

    parent.set(v, null)
    if dfs(v):
        // A path v -> ... -> u exists; combined with edge (u -> v) this is the cycle.
        cycleNodeIds = reconstructPath(parent, from = u, to = v)  // includes u and v
        cycleNodeIds.append(u)  // closes the loop back to u for reporting completeness
        return recordCycle(graph, dedupe(cycleNodeIds))

    return CycleReport { foundCycle: false, cycleNodeIds: [], entryPointId: null }


function recordCycle(graph, cycleNodeIds) -> CycleReport:
    for nodeId in cycleNodeIds:
        node = graph.getNode(nodeId)
        node.resolutionState = 'cyclic'
        // Section 9: compute guaranteed-invalid-value semantics for Variable nodes.
        if node.kind == 'Variable':
            node.effectiveValue = GUARANTEED_INVALID_VALUE
            node.inheritedFallback = computeInheritedFallbackIfApplicable(node)

    entryPointId = cycleNodeIds.sortedLexicographically()[0]   // Principle 5 determinism
    report = CycleReport {
        foundCycle: true,
        cycleNodeIds: cycleNodeIds.sortedLexicographically(),
        entryPointId: entryPointId
    }
    emitDiagnostic(CyclicDependencyWarning(report))
    return report
```

`outgoingEdgesOfKindScoped` is a thin filter over `DependencyGraph.edgesBySource` (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 9.2's class diagram), restricted to the three cycle-relevant edge kinds — this is the exact mechanical enforcement of Section 8.2's scoping rule and must never be widened to include `renders-via`, `conditioned-by`, or `requires-registration` edges without a corresponding revision to this document and to [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2.

### 10.1 Guaranteed-Invalid-Value Semantics for Cyclic `Variable` Nodes

[014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7 requires that "a `Variable` node marked `cyclic` must be treated, for serialization purposes, the same way a browser treats a genuinely cyclic `var()` reference at the specification level." Concretely, per the W3C CSS Custom Properties for Cascading Variables Module specification: a custom property that participates in a cyclic reference computes to its **guaranteed-invalid value**, a special value distinct from any author-specifiable CSS value, which the specification treats as invalid at computed-value time for *every* property that uses it. What happens next depends on how the invalid value propagates:

- If the guaranteed-invalid value is substituted into a **non-custom** (standard) property's value via `var()` — e.g., `color: var(--a)` where `--a` is cyclic — the declaration is invalid at computed-value time, which means the browser behaves as if that property had not been declared at all in this rule, and cascades to the next-highest-priority declaration for that property (or to the property's own initial/inherited value if no other declaration applies).
- If the guaranteed-invalid value is substituted into **another custom property's** value — e.g., `--c: var(--a)` where `--a` is cyclic — `--c` itself becomes cyclic/guaranteed-invalid by propagation, *unless* `--c` was registered via `@property` with a specified initial value (per `../algorithms/504-At-Property.md`), in which case the registered initial value is used instead once the property's syntax is a registered custom property with a guaranteed initial value (per the CSS Properties and Values API specification's interaction with cyclic custom properties).

The resolver mirrors this exactly rather than inventing its own fallback policy (Principle 1): `recordCycle` (Section 8.5) sets `node.effectiveValue = GUARANTEED_INVALID_VALUE` on every cyclic `Variable` node, and the Cascade Resolver (downstream consumer, per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 9.1) is responsible for applying the propagation rule above when computing which declaration ultimately wins for any `Rule` node that transitively depended on a now-`cyclic` `Variable`. This document's `CycleDetector` does not itself walk forward to every consumer of a cyclic variable to invalidate their computed values — that is explicitly the Cascade Resolver's responsibility, consuming the `cyclic` `resolutionState` flag as an input, keeping this document's scope limited to detection and immediate node marking, consistent with the separation of concerns [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 9.1 already draws between the Dependency Resolver and Cascade Resolver.

For `inherits-from` cycles specifically (a rarer but architecturally possible case where a chain of inheritance edges across ancestor/descendant scopes closes a loop — see Section 12), the same guaranteed-invalid-value treatment applies to the custom property's inherited value at the point of the cycle, per the same specification section governing inherited custom properties.

### 10.2 Complexity Analysis

**Time complexity, single invocation.** For one `checkForCycle(graph, newEdge)` call, the DFS visits each node at most once (guarded by the `color` map: a node is only entered via `dfs()` while white, and immediately marked gray, then eventually black) and each cycle-scoped edge at most once per node visited. Worst case for a single call: `O(V_scoped + E_scoped)`, where `V_scoped`/`E_scoped` are the node/edge counts of the `references`/`inherits-from`/`layered-under`-scoped subgraph reachable from `v`. In practice this is a small fraction of the full graph, bounded by the local fan-out of freshly-discovered nodes (Section 14).

**Amortized time complexity, full graph construction.** Summed across every qualifying edge added during one extraction run (`E_scoped` total edges of the three cycle-relevant kinds), the *total* work across all `checkForCycle` invocations is `O(E_scoped × (V_scoped + E_scoped))` in the naive worst case (each call re-traverses from scratch). This bound is pessimistic in practice because most calls terminate almost immediately (the new edge's target has zero or few outgoing edges at the time it is checked, since it was very likely just discovered this same iteration) — the *realistic* amortized bound, given the graph's expected small size and low fan-out (Section 14), is close to `O(E_scoped)` total, not the theoretical worst case. This is formalized in the benchmark methodology (Section 15) rather than asserted as a tight proven bound, because a tight amortized bound depends on graph shape assumptions (bounded degree) that hold for realistic CSS but are not a mathematical guarantee for adversarial input — which is exactly why the independent `resolutionBudget` circuit breaker in [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.6 exists as a defensive backstop regardless of this algorithm's typical-case performance.

**Memory complexity.** `O(V_scoped)` per invocation for the transient `color` and `parent` maps, discarded when the call returns — this is the dominant reason the transient-map design (Section 8.3) was chosen over a persistent per-node "on which DFS stack am I" field, which would otherwise need explicit cleanup logic prone to leaking stale state across calls. No memory is retained between invocations beyond the permanent, already-accounted-for `resolutionState` field on each node.

**Failure cases.** (1) A newly added edge whose target is already `black` from an earlier, unrelated `checkForCycle` call within the same graph — handled correctly by the `color.get(nodeId) == 'black'` short-circuit, since "black" here is scoped per-call and a node reachable-and-black in this call's traversal genuinely cannot reach `u`, regardless of what a previous call's traversal concluded (each call's color map is fresh). (2) Extremely deep non-cyclic reference chains causing a single `checkForCycle` call itself to have a large `V_scoped` — bounded by, and reported through, the same `resolutionBudget` mechanism at the outer loop level, not a separate limit internal to this algorithm; this document deliberately does not impose its own depth limit, to avoid two independently-tuned budgets diverging (see Section 12). (3) Recursive-implementation stack depth on pathologically deep chains — addressed in Implementation Notes (Section 11) by requiring an explicit-stack, non-recursive implementation in the shipped code, even though the pseudocode above is written recursively for readability.

**Optimization opportunities.** Memoizing "definitely cannot reach `u`" conclusions (nodes marked black within one call) across *subsequent* calls within the same discovery "wave" (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 10.1's batched-discovery optimization) is a candidate refinement: if a later call in the same wave needs to search from a node already proven unreachable-to-any-u in an earlier call this wave, and the graph has not gained new outgoing edges from that node since, the earlier negative result could be reused. This is flagged in Future Work (Section 16) rather than adopted now, because correctly invalidating such a cache when new edges are added mid-wave adds nontrivial complexity for a caching benefit that only pays off on graphs a) far larger and b) far denser than production telemetry currently shows are typical (Section 14).

## 11. Implementation Notes

- Ship `dfs()` as an explicit-stack loop, not native recursion, specifically to avoid host-stack-depth failures on the pathological deep-chain case (Section 10, failure case 3) — a 500-link synthetic stress fixture (mirrored from [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 15's stress-test guidance) must pass without exhausting the V8 call stack, which a naive recursive implementation risks well before the `resolutionBudget` circuit breaker would ever trigger.
- `outgoingEdgesOfKindScoped` must be implemented as an `O(deg(node))` filter over the already-indexed `edgesBySource` map (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 9.2), not a full-graph edge scan per call — this is the single most important micro-optimization for keeping per-call cost proportional to local fan-out rather than total edge count.
- `CycleReport.cycleNodeIds` and `entryPointId` must be computed by sorting node IDs lexicographically (per Section 8.5's pseudocode), never by "whichever node the DFS happened to visit first," to satisfy [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7's determinism requirement — this is a one-line `Array.sort()` call but is easy to accidentally skip if an implementer reaches for "just report `u` as the entry point" as a shortcut; that shortcut is non-deterministic across discovery orderings and must be rejected in review.
- The `CyclicDependencyWarning` diagnostic payload should include the full ordered path (`v -> ... -> u -> v`), not merely the deduplicated node-ID set, because the Reporter (`packages/reporter`) needs the actual traversal order to render a legible "here is the chain" debugging view (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 11's Reporter guidance) — the deduplicated, sorted `cycleNodeIds` field is for deterministic *identity* comparison (e.g., regression-test snapshot matching), while the raw path is for human-facing diagnostics; both should be carried on the report.
- `computeInheritedFallbackIfApplicable` (referenced in Section 8.5's `recordCycle`) must consult the corresponding `AtProperty` node via the node's `requires-registration` edge, per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2, before assuming a bare guaranteed-invalid value with no registered initial-value override — this is the same registration-awareness [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 12 requires of ordinary (non-cyclic) inheritance-edge discovery, and cyclic handling must not special-case around it.
- Because `checkForCycle` is invoked from inside the single-writer graph-mutation section of the `FixedPointResolver`'s loop (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 11's single-writer discipline), this algorithm requires no internal locking or concurrency control of its own — it can assume exclusive, synchronous access to the graph for the duration of one call, which is what makes the transient per-call `color`/`parent` maps safe without additional synchronization.

## 12. Edge Cases

- **Self-loops (`--a: var(--a);`).** Handled explicitly and cheaply in Section 8.5's pseudocode via the `u == v` fast path, rather than falling through to a full DFS that would trivially discover the same result more slowly. This is a real, observed pattern from botched search-and-replace refactors, not a purely theoretical case.
- **Cycles spanning more than two nodes (`--a -> --b -> --c -> --a`).** The algorithm handles arbitrary cycle length identically — the DFS from `v` (`--b`, if the closing edge is `--c -> --a`... more precisely: on the closing edge `--c -> --a`, `u = --c`, `v = --a`, and the DFS searches from `--a` for a path to `--c`, finding `--a -> --b -> --c`) requires no special-casing for cycle length; only the path-reconstruction step (`reconstructPath`) needs to correctly walk an arbitrarily long `parent` chain, which it does generically.
- **Two independent, non-overlapping cycles discovered in the same graph during the same extraction run.** Each is detected and marked independently by its own `checkForCycle` invocation (triggered by its own closing edge); the `color.get(nodeId) == 'gray'` continue-clause in Section 8.5's pseudocode ensures one cycle's in-progress traversal never corrupts or short-circuits detection of an unrelated cycle discovered by a later edge.
- **Overlapping cycles sharing a node (e.g., `--a <-> --b` and separately `--a <-> --c`).** The shared node `--a` is marked `cyclic` by the first detection and remains `cyclic` when the second cycle is found; `recordCycle`'s `node.resolutionState = 'cyclic'` assignment is idempotent, and the second `CyclicDependencyWarning` correctly reports its own distinct `cycleNodeIds` (`[--a, --c]`) even though `--a` was already `cyclic` from the first report — the Reporter must not deduplicate these two warnings into one, since they describe genuinely different reference chains a developer needs to fix independently.
- **`inherits-from` cycles across custom-property inheritance rather than `var()` reference chains.** Architecturally rarer (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2's edge taxonomy, `inherits-from` edges typically point from a descendant `Rule` up to an ancestor's `Variable` declaration, a direction that does not naturally cycle back down) but not provably impossible if a future discovery routine ever models bidirectional inheritance-shadowing relationships; this algorithm's scoping already includes `inherits-from` in the cycle-detection subgraph specifically as a defensive measure against this possibility, per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.2's stated rationale, and requires no special-casing beyond being included in `outgoingEdgesOfKindScoped`'s filter set.
- **`layered-under` cycles (spec-impossible, but engine-bug-defensive).** As [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 12 notes, the CSS Cascading Layers specification defines a strictly acyclic layer order; a detected `layered-under` cycle should therefore be treated by the Reporter as a higher-severity diagnostic than a `Variable` cycle (which is a legitimate, if buggy, author error) — it more likely indicates either a genuine non-compliant browser-engine bug or, more mundanely, an engine-side bug in this project's own layer-order discovery routine (`../algorithms/506-Cascade-Layers.md`). The `CyclicDependencyWarning` payload's `edgeKind` field (carried alongside `cycleNodeIds`) lets the Reporter apply this differentiated severity without the `CycleDetector` itself needing cycle-kind-specific logic.
- **A cycle whose closing edge is discovered via a discovery batch that also, in the same batch, discovers an unrelated new node reachable from inside the cycle.** Because graph mutation is strictly single-writer and sequential (Section 11), the closing edge is always fully processed — including its `checkForCycle` call and any resulting `cyclic` marking — before the next edge in the same batch is processed, so no ordering ambiguity arises from batched discovery; batching (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 10.1's optimization) applies only to the browser-query phase of discovery, never to the graph-mutation phase this algorithm participates in.
- **Constructable-stylesheet or Shadow-DOM-crossing cycles**, where the two custom properties in a cycle are declared in different shadow roots connected only via inheritance edges. This does not require any special handling by `checkForCycle` itself — the graph's node identity (Section 8.1 of [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md), `(propertyName, definingScope)` keying) already treats shadow-crossing `inherits-from` edges as ordinary edges in the scoped subgraph, so a shadow-crossing cycle is detected identically to a same-document one; this is called out here only to confirm no additional shadow-DOM-aware logic is needed in this specific algorithm, in contrast to the discovery routines that populate these edges in the first place.
- **A residual cyclic `@import` chain that somehow survives to the CSSOM Walker despite the CSSOM specification's `@import` cycle-avoidance rule** (e.g., due to a non-compliant browser engine, or a future engine regression). This engine's dependency graph does not model `@import` relationships as first-class graph nodes/edges at all (imported stylesheets are flattened into the same `document.styleSheets`/CSSOM rule tree the CSSOM Walker already traverses, per [001-Vision.md](../architecture/001-Vision.md)'s "browser as source of truth" principle), so a hypothetical surviving `@import` cycle would not manifest as a graph-level cycle in this document's structures at all — it would instead manifest as a browser-level infinite-stylesheet-recursion failure *before* the CSSOM Walker ever produces a rule tree, which is out of this algorithm's detection scope and is instead a Navigation Engine/browser-crash-recovery concern (see `../design/103-Navigation-Engine.md`). This is noted here explicitly so a future reader does not mistakenly expect this algorithm to catch that class of failure.

## 13. Tradeoffs

| Decision | Why | Alternative Considered | Tradeoff Accepted |
|---|---|---|---|
| Incremental, per-new-edge colored DFS rather than a full-graph Tarjan's SCC pass | Matches the actual invocation shape mandated by [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7 (must run incrementally, not as a batch pass); avoids the "queue empties" trigger being conflated with "graph is acyclic" | Lazy Tarjan's pass triggered when the discovery queue empties | Multiple small DFS calls instead of one larger, asymptotically-optimal batch computation; net cost is comparable or better in practice given this graph's small realistic size, but the reasoning requires the amortized-cost argument in Section 10 rather than a single clean textbook bound |
| Transient, call-scoped color map rather than a persistent per-node "on-stack" field | Keeps each `checkForCycle` invocation a pure function of current graph state, with no cross-call state to leak or corrupt | A persistent `onStack: boolean` field on `GraphNode`, cleared manually after each call | Slightly more allocation per call (a fresh `Map` each time) versus reusing a persistent field, in exchange for eliminating an entire class of "forgot to clear the flag" bugs |
| Retain the cycle-closing edge in the graph rather than deleting it once detected | Diagnostic fidelity — a developer debugging a disappeared variable needs to see the actual reference chain that caused it | Delete the closing edge to "break" the cycle structurally, simplifying downstream traversal | Downstream consumers (Cascade Resolver, Reporter) must themselves respect `resolutionState == 'cyclic'` as the signal to stop traversing, rather than being able to assume the graph is edge-wise acyclic by the time they receive it |
| Lexicographically-smallest node ID as the deterministic cycle entry point | Directly satisfies [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.7's binding determinism requirement (Principle 5) | Report the edge-discovery-order-based "first node visited" as entry point | Lexicographic sort is a fixed, arbitrary-feeling convention with no semantic meaning (it is not "the variable that's most at fault"), but it is exactly reproducible across runs, which is the property actually required |
| No cycle-detection-internal depth limit; rely solely on the outer `resolutionBudget` circuit breaker | Avoids two independently-tuned limits (an inner DFS depth cap and an outer iteration cap) diverging and producing confusing, inconsistent failure diagnostics | A dedicated max-DFS-depth parameter internal to `checkForCycle` | A single pathologically deep non-cyclic chain could, in principle, make one `checkForCycle` call itself expensive before the outer budget check next fires — mitigated by the explicit-stack, non-recursive implementation requirement (Section 11), which removes the stack-overflow risk even if the single call is slow |

## 14. Performance

- **CPU complexity.** Per Section 10, dominated in the realistic case by local fan-out from newly-discovered nodes, not by total graph size — consistent with [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 14's observation that this whole pipeline stage's cost is dominated by browser round-trip latency (Section 10.1 of that document) rather than in-memory graph algorithmics; cycle detection adds a small, usually sub-millisecond increment per qualifying edge on top of that dominant cost.
- **Memory complexity.** `O(V_scoped)` transient per call (Section 10), released immediately after each `checkForCycle` returns; no persistent memory footprint beyond the `resolutionState` field the graph already carries for other reasons.
- **Caching strategy.** No caching is applied to `checkForCycle` results themselves in the current design (Section 10's optimization-opportunities discussion explains why the obvious "remember which nodes are provably acyclic" cache is deferred rather than adopted); the surrounding `FixedPointResolver`'s per-viewport-pass memoization of `DependencyDiscoverer` results (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 14) indirectly reduces how often `checkForCycle` is invoked at all across a Mobile/Tablet/Desktop triple pass, since a `Variable`-to-`Variable` edge discovered once for the Mobile pass need not be rediscovered (and re-checked) for Tablet/Desktop if the underlying custom-property definitions are viewport-invariant.
- **Parallelization opportunities.** None internal to this algorithm — `checkForCycle` executes strictly inside the single-writer graph-mutation section of the resolution loop (Section 11), by design, so there is no parallel work to extract at this layer; the parallelism budget in this pipeline stage is spent entirely on batching the *browser queries* that produce candidate edges (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 14), not on the graph algorithmics that consume them.
- **Incremental execution.** This algorithm *is* the incremental-execution strategy for cycle detection specifically — there is no separate "full" mode to fall back to, and no batch-recomputation path exists in the shipped design at all; every cycle, without exception, is found at the moment its closing edge is added.
- **Scalability limits.** Bounded jointly by (a) this algorithm's own per-call cost, which scales with local fan-out and is expected to stay small (Section 10), and (b) the independent `resolutionBudget` circuit breaker at the `FixedPointResolver` level, which remains the ultimate backstop against any combination of pathological graph shapes this algorithm's typical-case analysis does not cover — the two mechanisms are deliberately decoupled (per Section 13's tradeoff entry) so that a slow individual `checkForCycle` call is caught by the same budget that catches a merely-deep non-cyclic chain, rather than needing its own bespoke limit.

## 15. Testing

- **Unit tests.** Synthetic, in-memory `DependencyGraph` fixtures with no browser dependency, covering: a two-node cycle, a self-loop, a three-plus-node cycle, two independent non-overlapping cycles added in sequence, two overlapping cycles sharing one node, a large acyclic DAG with high fan-out (verifying `checkForCycle` correctly returns `foundCycle: false` without false positives), and a sequence of edge additions where a cycle is closed by the *last* edge added in a long incremental sequence (verifying the incremental, not batch, character of the algorithm is actually exercised, not merely tested against a single fully-formed graph).
- **Integration tests.** Real Playwright-driven extraction against fixtures with actual `--a: var(--b); --b: var(--a);`-style circular custom properties (mirroring [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 15's stress-fixture guidance) must assert both that the `Rule` referencing the cyclic variable is still `resolved` (not itself marked `cyclic` merely by association, since [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 8.6 requires containment scoped to the implicated nodes only) and that the serialized output correctly reflects the guaranteed-invalid-value fallback behavior (Section 9) — i.e., that the property in question falls back to its next-highest-priority declaration or initial value, matching a real browser's rendering of the same fixture.
- **Visual tests.** The cyclic-variable fixture's critical-CSS-only render must be visually diffed against the full-page render with the *actual* browser evaluating the same cyclic CSS — since the specification-mandated guaranteed-invalid-value behavior is itself what a real browser does, a correct implementation of Section 9 should produce zero visual diff for this fixture, and any diff is evidence of an incorrect fallback implementation rather than of legitimately-missing critical CSS.
- **Stress tests.** (1) A synthetic 500-link non-cyclic `Variable` reference chain, verifying the explicit-stack DFS implementation (Section 11) does not stack-overflow and completes within the `resolutionBudget`. (2) A synthetic graph with dozens of small, independent cycles scattered across otherwise-unrelated subgraphs, verifying containment (Section 8.7 of [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md)) correctly isolates every cycle without any one cycle's detection interfering with another's, and without aborting resolution of the surrounding acyclic majority of the graph.
- **Regression tests.** Every production bug involving incorrect cycle detection (false positive on a legitimate diamond-shaped DAG; false negative on a genuine cycle; incorrect entry-point selection breaking determinism) gains a permanent golden-graph-snapshot fixture, per the golden-snapshot convention established in [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 15.
- **Benchmark tests.** Track `checkForCycle`'s aggregate contribution to total dependency-resolution wall-clock time across the `fixtures/enterprise-huge/` benchmark suite (per [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 15's benchmark conventions), specifically to validate the amortized-cost claim in Section 10 against real-world graph shapes rather than resting on the theoretical worst-case bound alone; a benchmark regression here is a leading indicator that the "graphs stay small and low-fan-out in practice" assumption underlying this document's complexity story (Section 14) may no longer hold.

## 16. Future Work

- **Memoized "provably acyclic from here" caching across calls within a single discovery wave**, as sketched in Section 10's optimization-opportunities discussion — deferred pending evidence from production telemetry that per-call DFS cost is ever actually a measurable fraction of total extraction time; currently believed not to be, given browser-round-trip-dominated costs elsewhere in the pipeline (Section 14).
- **Incremental topological-order maintenance** (the Marchetti-Spaccamela-style algorithms considered and rejected in Section 8.1, alternative 3) — worth revisiting only if production graphs are observed to grow substantially larger or denser than current assumptions, per that section's rejection rationale.
- **Differentiated diagnostic severity for `layered-under` cycles vs. `Variable`/`references` cycles**, reflecting that the former should be spec-impossible and thus likely indicates an engine bug rather than an author error (Section 12) — the `edgeKind`-aware Reporter behavior is noted as a requirement here but its exact severity taxonomy and user-facing messaging is left to `packages/reporter`'s own design documentation (Phase 13, `docs/design/1000-Diagnostics-Overview.md` et seq.) to specify in full.
- **Formal verification or property-based testing of the termination guarantee**, extending the property-based testing research direction already flagged in [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) Section 16 and [006-Design-Principles.md](../architecture/006-Design-Principles.md) — specifically, a property-based test generator that constructs arbitrary random graphs (including arbitrary cycles) and asserts the fixed-point loop always terminates within a bound derivable from graph size, would strengthen the current example-based stress-test coverage (Section 15) into a stronger, harder-to-circumvent guarantee.
- **Open question: should overlapping-cycle reporting (Section 12) be consolidated into a single diagnostic when cycles share more than a threshold fraction of nodes**, to reduce diagnostic noise on pathological fixtures with many small interlocking cycles, versus the current one-warning-per-detected-cycle policy? Left open pending real-world diagnostic-noise feedback once `packages/reporter`'s UX is exercised against production stylesheets rather than synthetic fixtures alone.
- **Open question: is the `u == v` self-loop fast path (Section 8.5) worth generalizing into a small fixed-depth-2/3 fast path** for the very common two- and three-node cycles observed in practice, before falling back to general DFS, as a further constant-factor optimization? Deferred as premature without benchmark evidence (Section 15) that the general DFS path's constant factor is ever actually significant relative to surrounding browser-query costs.

## 17. References

- [014-Dependency-Graph.md](../architecture/014-Dependency-Graph.md) — architectural contract this document fulfills; Section 8.7 in particular.
- `../design/500-Dependency-Resolution-Overview.md` — overall Phase 7 resolution narrative.
- `../algorithms/501-CSS-Variables.md` — primary producer of `references`/`inherits-from` edges consumed by this algorithm.
- `../algorithms/502-Keyframes.md` — `renders-via` edge producer, out of this document's cycle-detection scope.
- `../algorithms/503-Font-Faces.md` — `renders-via` edge producer, out of scope.
- `../algorithms/504-At-Property.md` — `@property` registration semantics consulted by `computeInheritedFallbackIfApplicable` (Section 11).
- `../algorithms/505-Counters.md` — `renders-via` edge producer, out of scope.
- `../algorithms/506-Cascade-Layers.md` — `layered-under` edge producer.
- `../algorithms/507-Dependency-Graph-Construction.md` — general node/edge construction discipline this algorithm plugs into.
- [001-Vision.md](../architecture/001-Vision.md) — "browser as source of truth" principle governing why `@import` cycles are out of this document's detection scope (Section 12).
- [006-Design-Principles.md](../architecture/006-Design-Principles.md) — Principles 1, 5, 6.
- [007-Repository-Structure.md](../architecture/007-Repository-Structure.md) — prior use of Tarjan's SCC for the unrelated package-level build graph, compared and distinguished in Section 8.1.
- Tarjan, R. (1972), "Depth-First Search and Linear Graph Algorithms," *SIAM Journal on Computing* — the classical SCC algorithm evaluated and distinguished from the chosen approach in Section 8.1.
- Johnson, D. B. (1975), "Finding All the Elementary Circuits of a Directed Graph," *SIAM Journal on Computing* — evaluated and rejected as overkill in Section 8.1, alternative 2.
- Marchetti-Spaccamela, A., Pasquale, U., Nanni, U. (1996), "Incremental Algorithms for Minimal Length Paths" and related incremental topological-order literature — evaluated and deferred in Section 8.1, alternative 3, and revisited in Future Work.
- W3C CSS Custom Properties for Cascading Variables Module Level 1 — guaranteed-invalid-value and cyclic-reference resolution semantics, the specification this document's Section 9 mirrors — https://www.w3.org/TR/css-variables-1/
- W3C CSS Properties and Values API Level 1 (`@property`) — registered custom property initial-value interaction with cyclic references — https://www.w3.org/TR/css-properties-values-api-1/
- W3C CSS Object Model (CSSOM) Specification — `@import` cycle-avoidance behavior referenced in Section 12's residual-import-cycle edge case — https://www.w3.org/TR/cssom-1/
