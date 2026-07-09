# Documentation Table of Contents

This file is kept up to date after every documentation phase. It lists every document in `docs/`, grouped by directory, in generation order.

## Root

- [README.md](README.md) — Documentation entry point and navigation guide.
- [SUMMARY.md](SUMMARY.md) — This file.
- [STATUS.md](STATUS.md) — What is complete, in-progress, and planned, per phase.
- [ROADMAP.md](ROADMAP.md) — Documentation phases mapped to implementation milestones.

## docs/architecture/ — Phase 1 & 2

- [001-Vision.md](architecture/001-Vision.md) — Project vision: browser-as-source-of-truth, target users, quality bar.
- [002-Problem-Statement.md](architecture/002-Problem-Statement.md) — Why static critical CSS extraction fails; cost of getting it wrong.
- [003-Requirements.md](architecture/003-Requirements.md) — Functional and non-functional requirements, REQ-IDs, traceability to modules.
- [004-Terminology.md](architecture/004-Terminology.md) — Conceptual terminology used throughout the project.
- [005-Glossary.md](architecture/005-Glossary.md) — Alphabetized reference glossary of acronyms and proper nouns.
- [006-Design-Principles.md](architecture/006-Design-Principles.md) — Governing engineering principles and their consequences for module design.
- [007-Repository-Structure.md](architecture/007-Repository-Structure.md) — Canonical monorepo layout, package responsibilities, dependency graph.
- *(Phase 2, not yet generated)* `010-System-Overview.md`
- *(Phase 2, not yet generated)* `011-Execution-Pipeline.md`
- *(Phase 2, not yet generated)* `012-Module-Interaction.md`
- *(Phase 2, not yet generated)* `013-Component-Diagram.md`
- *(Phase 2, not yet generated)* `014-Dependency-Graph.md`
- *(Phase 2, not yet generated)* `015-Runtime-Model.md`
- *(Phase 2, not yet generated)* `016-Data-Flow.md`

## docs/adr/ — Phase 1

- [ADR-0001-Browser-Is-Source-of-Truth.md](adr/ADR-0001-Browser-Is-Source-of-Truth.md)
- [ADR-0002-No-Custom-Selector-Parser.md](adr/ADR-0002-No-Custom-Selector-Parser.md)
- [ADR-0003-Playwright-As-Browser-Abstraction.md](adr/ADR-0003-Playwright-As-Browser-Abstraction.md)
- [ADR-0004-Plugin-Lifecycle-Model.md](adr/ADR-0004-Plugin-Lifecycle-Model.md)
- [ADR-0005-Hybrid-Extraction-Mode.md](adr/ADR-0005-Hybrid-Extraction-Mode.md)

## docs/design/ — Phases 3–13 (not yet generated)

Planned: Browser Layer (100–106), Visibility Engine (200–207), CSSOM (300–307), Selector Engine (400–405), Dependency Resolution overview (500), Serialization (600–606), Advanced Extraction (700–704), Caching (800–806), SSR Integration (900–906), Diagnostics (1000–1005).

## docs/algorithms/ — Phase 7 (not yet generated)

Planned: `501-CSS-Variables.md`, `502-Keyframes.md`, `503-Font-Faces.md`, `504-At-Property.md`, `505-Counters.md`, `506-Cascade-Layers.md`, `507-Dependency-Graph-Construction.md`, `508-Cycle-Detection.md`.

## docs/api/ (not yet generated)

Public API, interfaces, DTOs, configuration schema, error types — scheduled across module-specific design phases.

## docs/plugins/ — Phase 12 (not yet generated)

Planned: `000-Plugin-SDK-Overview.md`, `001-Lifecycle-Hooks.md`, `002-Plugin-API.md`, `003-Plugin-Examples.md`, `004-Sandboxing.md`.

## docs/testing/ — Phase 15 (not yet generated)

Planned: `000-Testing-Strategy.md`, `001-Fixtures.md`, `002-Visual-Tests.md`, `003-Golden-Files.md`, `004-Performance-Tests.md`, `005-Regression-Tests.md`.

## docs/performance/ — Phase 14 (not yet generated)

Planned: `000-Performance-Overview.md`, `001-Worker-Threads.md`, `002-Parallelization-Strategy.md`, `003-Rule-Indexing.md`, `004-Memory-Optimization.md`, `005-Benchmarks.md`.

## docs/implementation/ & docs/tasks/ — Phase 16 (not yet generated)

Planned: `000-Architecture-Tasks.md`, `001-Task-Breakdown.md`, `002-Milestones.md`, `003-Acceptance-Tests.md`, `004-Definition-of-Done.md`, plus atomic task cards under `docs/tasks/`.

## docs/spec/ — Phase 17 (not yet generated)

Planned: `000-CSSOM.md`, `001-CSS-Variables.md`, `002-Cascade.md`, `003-Media-Queries.md`, `004-Shadow-DOM.md`, `005-Coverage-API.md`, `006-Container-Queries.md`, `007-Nested-CSS.md`, `008-Constructable-Stylesheets.md`.

## docs/research/ & docs/examples/ (not yet generated)

No files scheduled to a specific phase; populated opportunistically as open questions and usage examples arise during later phases.
