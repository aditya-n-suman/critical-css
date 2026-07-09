# Critical CSS Extraction Engine — Documentation

## What this is

This directory contains the complete engineering documentation for the **Critical CSS Extraction Engine**: a production-grade, browser-driven critical CSS extractor that uses the live browser CSSOM as the source of truth, rather than static HTML/CSS parsing. It does not use or wrap existing critical CSS libraries (Critical, Critters, Penthouse, etc.) — every extraction strategy is implemented against the live rendering engine via [Playwright](https://playwright.dev).

The documentation is written to a quality bar comparable to LLVM, React, Kubernetes, Rust, Chromium, and V8 engineering documentation: RFC-style, senior-engineer audience, exhaustive on alternatives/tradeoffs, and detailed enough that an autonomous coding agent (or a new engineer) can implement the system from these documents with minimal additional guidance.

## How to navigate

- Start at [SUMMARY.md](SUMMARY.md) for the full table of contents of every document in this repository.
- [STATUS.md](STATUS.md) tracks what has been written, what is in progress, and what is planned, phase by phase.
- [ROADMAP.md](ROADMAP.md) maps documentation phases to implementation milestones.
- [architecture/](architecture/) — system-level vision, requirements, terminology, design principles, and repository structure.
- [adr/](adr/) — Architectural Decision Records: the "why" behind irreversible or high-leverage engineering choices.
- [design/](design/) — module-level design documents (browser layer, visibility engine, CSSOM walker, selector engine, serialization, caching, SSR integration, diagnostics).
- [algorithms/](algorithms/) — algorithm RFCs with pseudocode and complexity analysis (dependency resolution, cycle detection, etc).
- [api/](api/) — public API surface, interfaces, DTOs, configuration schema, error types.
- [plugins/](plugins/) — plugin SDK: lifecycle hooks, plugin API, examples, sandboxing model.
- [testing/](testing/) — testing strategy, fixtures, golden files, performance and regression tests.
- [performance/](performance/) — benchmarks, profiling guidance, parallelization and memory strategy.
- [implementation/](implementation/) — task breakdown, milestones, acceptance tests, definition of done.
- [tasks/](tasks/) — atomic implementation task cards, one per unit of work.
- [spec/](spec/) — the browser and CSS specifications the engine's correctness depends on.
- [research/](research/) — open questions and future research.
- [examples/](examples/) — annotated end-to-end usage examples.

## Source repository layout

The documentation describes (and must stay consistent with) the canonical monorepo layout:

```
critical-css-engine/
├── apps/
│   ├── cli
│   ├── visualizer
│   └── playground
├── packages/
│   ├── browser
│   ├── collector
│   ├── matcher
│   ├── dependency-graph
│   ├── serializer
│   ├── coverage
│   ├── cache
│   ├── plugins
│   ├── reporter
│   └── shared
├── fixtures/
├── docs/
├── benchmarks/
└── examples/
```

See [architecture/007-Repository-Structure.md](architecture/007-Repository-Structure.md) for the full rationale and per-package responsibilities.

## Conventions

Every document in this repository follows the Global Rules defined in the original documentation brief (`BRIEF.md`, repository root): a fixed 17-section structure, a 3,000–5,000 word minimum, RFC-style prose, Mermaid diagrams, and explicit Why/Alternatives/Tradeoffs reasoning for every design decision. Files are named `NNN-Name.md`, split into `Part-1`, `Part-2`, etc. when a single document would otherwise exceed a reasonable single-file size.

## Status

This documentation set is generated in phases. See [STATUS.md](STATUS.md) for current progress. As of this writing, **Phase 1 — Repository Foundation** is in progress.
