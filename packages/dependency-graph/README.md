# @critical-css/dependency-graph

Runtime CSS dependency resolution (AT-06, M2 slice).

| Export | Purpose | Design authority |
|---|---|---|
| `FixedPointResolver.resolve(matched, cssom, budget?)` | Wave-based fixed-point iteration: seeds = matched rules; discovers variables (incl. chained + `@property` registrations, first-wins), keyframes (last-wins), font-faces (set inclusion), counter-styles (last-wins); pulls declaring rules transitively. Deterministic budget `max(500, seeds×20)` → `DependencyResolutionError` on overrun | 500, 501–505, 507, task 004 |
| `checkForCycle(graph, edge)` | Incremental per-edge three-color DFS (explicit stack, no native recursion); cycles marked `cyclic` + `CYCLIC_DEPENDENCY` diagnostic — recorded, never rejected | 508 |
| `buildLayerOrderRegistry(cssom)` | `@layer` ranks from first-occurrence declaration order; unlayered ranks LAST | 506/305 |
| `extractVarReferences` etc. | Sanctioned lexical extractors (identify WHICH names to consider — never resolve values) | 501 §8.1 |

M2 accuracy deferrals (M3): browser-probe refinements (ancestor `matches()` filtering,
`getKeyframes()` probe, `document.fonts` load state, unicode-range glyph filtering),
counter-style `fallback` chasing, Hybrid strategy composer.
