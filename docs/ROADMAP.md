# Documentation & Implementation Roadmap

This roadmap maps each documentation phase to the implementation milestones it unblocks. Documentation phases are generated sequentially; implementation may begin on a subsystem as soon as its corresponding design documents reach a stable state (see [STATUS.md](STATUS.md) for per-phase status).

| Phase | Documentation Scope | Directory | Implementation Milestone Unlocked |
|---|---|---|---|
| 1 | Repository Foundation — vision, problem statement, requirements, terminology, design principles, ADRs | `docs/`, `docs/architecture/`, `docs/adr/` | Project scaffolding, monorepo bootstrap, tooling setup |
| 2 | Architecture — system overview, execution pipeline, module interaction, data flow | `docs/architecture/` | `packages/shared` skeleton, top-level orchestration contracts |
| 3 | Browser Layer — Playwright adapter, browser pool, navigation, rendering stabilization, viewport manager | `docs/design/` | `packages/browser` (Phase 1 roadmap item: CSSOM extraction MVP) |
| 4 | Visibility Engine — geometry, intersection, overflow, transforms, sticky/fixed, virtualized lists | `docs/design/` | `packages/collector` visibility subsystem |
| 5 | CSSOM — stylesheet loader, rule tree, media/supports rules, cascade layers, @import, constructable stylesheets | `docs/design/` | `packages/collector` CSSOM walker |
| 6 | Selector Engine — matching, memoization, pseudo-elements/classes, :is/:where/:has, container queries | `docs/design/` | `packages/matcher` |
| 7 | Dependency Resolution — variables, keyframes, font faces, @property, counters, cascade layers, graph construction, cycle detection | `docs/design/`, `docs/algorithms/` | `packages/dependency-graph` (Phase 2 roadmap item) |
| 8 | Serialization — rule ordering, deduplication, compression, output validation, source maps, output formats | `docs/design/` | `packages/serializer` |
| 9 | Advanced Extraction — coverage mode, hybrid mode, computed-style verification, visual diff, incremental extraction | `docs/design/` | `packages/coverage`, hybrid mode in `packages/matcher` (Phase 3 roadmap item) |
| 10 | Caching — fingerprinting, cache store, route/viewport cache, invalidation, distributed cache | `docs/design/` | `packages/cache` (Phase 4 roadmap item) |
| 11 | SSR Integration — React SSR, Express, Next.js, Astro, Remix, Fastify adapters | `docs/design/` | Framework adapter packages / `examples/` |
| 12 | Plugin SDK — lifecycle hooks, plugin API, examples, sandboxing | `docs/plugins/` | `packages/plugins` (Phase 2 roadmap item) |
| 13 | Diagnostics — logging, metrics, tracing, visualization, debug UI | `docs/design/` | `packages/reporter`, `apps/visualizer` (Phase 5 roadmap item) |
| 14 | Performance — worker threads, parallelization, rule indexing, memory optimization, benchmarks | `docs/performance/` | Cross-cutting performance work across all packages |
| 15 | Testing — strategy, fixtures, visual tests, golden files, performance/regression tests | `docs/testing/` | `fixtures/`, CI test harness |
| 16 | Implementation Task Catalog — architecture tasks, task breakdown, milestones, acceptance tests, DoD, atomic task cards | `docs/implementation/`, `docs/tasks/` | Sprint/iteration planning for all packages |
| 17 | Browser Specifications — CSSOM, CSS variables, cascade, media queries, Shadow DOM, Coverage API, container queries, nested CSS, constructable stylesheets | `docs/spec/` | Correctness reference for `packages/browser`, `packages/collector`, `packages/matcher` |

## Engine implementation roadmap (from the canonical design, Section 2.17 of `BRIEF.md`)

- **Phase 1:** CSSOM extraction MVP
- **Phase 2:** Dependency graph, media/layer support, plugin system
- **Phase 3:** Multi-device extraction, coverage mode, hybrid mode
- **Phase 4:** CI integration, route manifest, incremental cache
- **Phase 5:** Visual debugger, IDE support, distributed crawler

## Update rule

This file is updated only when documentation *scope* changes (a phase is added, split, or its directory target changes) — not on every phase completion. Routine progress tracking lives in [STATUS.md](STATUS.md).
