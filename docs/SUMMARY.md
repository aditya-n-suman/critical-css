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
- [010-System-Overview.md](architecture/010-System-Overview.md) — End-to-end pipeline overview: CLI through Plugin System, module grouping by concern.
- [011-Execution-Pipeline.md](architecture/011-Execution-Pipeline.md) — Single-route extraction as a staged process/state machine, with sequence and state diagrams.
- [012-Module-Interaction.md](architecture/012-Module-Interaction.md) — Runtime call/event contracts between the 15 modules; plugin hook placement on the interaction graph.
- [013-Component-Diagram.md](architecture/013-Component-Diagram.md) — C4-Component-style provided/required interfaces (ports) per module.
- [014-Dependency-Graph.md](architecture/014-Dependency-Graph.md) — The runtime CSS dependency graph (variables, keyframes, font-faces, etc.) — distinct from the package build-graph in 007.
- [015-Runtime-Model.md](architecture/015-Runtime-Model.md) — Node host vs. browser-renderer process boundary, concurrency and memory model, plugin sandboxing.
- [016-Data-Flow.md](architecture/016-Data-Flow.md) — Data transformations end-to-end, including multi-viewport fan-out/fan-in.

## docs/adr/ — Phase 1

- [ADR-0001-Browser-Is-Source-of-Truth.md](adr/ADR-0001-Browser-Is-Source-of-Truth.md)
- [ADR-0002-No-Custom-Selector-Parser.md](adr/ADR-0002-No-Custom-Selector-Parser.md)
- [ADR-0003-Playwright-As-Browser-Abstraction.md](adr/ADR-0003-Playwright-As-Browser-Abstraction.md)
- [ADR-0004-Plugin-Lifecycle-Model.md](adr/ADR-0004-Plugin-Lifecycle-Model.md)
- [ADR-0005-Hybrid-Extraction-Mode.md](adr/ADR-0005-Hybrid-Extraction-Mode.md)

## docs/design/ — Phase 3 complete; Phases 4–13 not yet generated

- [100-Browser-Abstraction.md](design/100-Browser-Abstraction.md) — Engine-agnostic browser driver interface underlying the Playwright adapter.
- [101-Playwright-Adapter.md](design/101-Playwright-Adapter.md) — Concrete Playwright implementation of the browser abstraction; Coverage API wiring.
- [102-Browser-Pool.md](design/102-Browser-Pool.md) — Pooling strategy, acquisition/release lifecycle, crash recovery, backpressure.
- [103-Navigation-Engine.md](design/103-Navigation-Engine.md) — Route navigation, request interception, waiting strategies, retry-on-timeout.
- [104-Rendering-Stabilization.md](design/104-Rendering-Stabilization.md) — Detecting "page is settled enough to snapshot": fonts, animations, hydration, mutation-idle detection.
- [105-Viewport-Manager.md](design/105-Viewport-Manager.md) — Viewport/device profile model, fold computation, emulation flags feeding multi-viewport extraction.
- [106-DOM-Snapshot.md](design/106-DOM-Snapshot.md) — DOM snapshot capture across the Node/browser boundary; Shadow DOM and iframe handling.

### Visibility Engine — Phase 4 complete

- [200-Visibility-Engine-Overview.md](design/200-Visibility-Engine-Overview.md) — Umbrella overview, visibility predicate, decomposition into sub-engines.
- [201-Geometry-Engine.md](design/201-Geometry-Engine.md) — Bounding-rect computation, coordinate space normalization, layout-thrash avoidance.
- [202-Intersection-Engine.md](design/202-Intersection-Engine.md) — Fold/viewport intersection test, configurable margins, nested-scroll and multi-viewport intersection.
- [203-Overflow-Handling.md](design/203-Overflow-Handling.md) — Ancestor-chain overflow-clip, clip-path approximation, scrollable-ancestor offsets.
- [204-Transform-Handling.md](design/204-Transform-Handling.md) — Transform-aware bounding boxes, ignore-transformed-offscreen option.
- [205-Sticky-Elements.md](design/205-Sticky-Elements.md) — `position: sticky` stuck/unstuck states and their visibility policy.
- [206-Fixed-Elements.md](design/206-Fixed-Elements.md) — `position: fixed` containing-block computation and always-critical-by-default policy.
- [207-Virtualized-Lists.md](design/207-Virtualized-Lists.md) — Detection heuristics and mitigation for windowed-list rendering limitations.

### CSSOM — Phase 5 complete

- [300-CSSOM-Walker.md](design/300-CSSOM-Walker.md) — Traversing `document.styleSheets` and nested `CSSRule` objects into a rule tree.
- [301-Stylesheet-Loader.md](design/301-Stylesheet-Loader.md) — Stylesheet discovery: `<link>`, `<style>`, dynamic injection, load-timing coordination.
- [302-Rule-Tree.md](design/302-Rule-Tree.md) — The normalized in-memory rule tree data structure.
- [303-Media-Rules.md](design/303-Media-Rules.md) — `@media` capture and per-viewport-profile applicability evaluation.
- [304-Supports-Rules.md](design/304-Supports-Rules.md) — `@supports` feature-query evaluation via `CSS.supports()`, dead-code elimination.
- [305-Cascade-Layers.md](design/305-Cascade-Layers.md) — `@layer` capture, layer ordering, and rule-to-layer assignment.
- [306-At-Import.md](design/306-At-Import.md) — `@import` chain walking, cycle detection, conditional/layer-tagged imports.
- [307-Constructable-Stylesheets.md](design/307-Constructable-Stylesheets.md) — `adoptedStyleSheets` discovery across document and Shadow DOM trees.

### Selector Engine — Phase 6 complete

- [400-Selector-Matching.md](design/400-Selector-Matching.md) — Core `element.matches()`-based matching loop and its correctness-first baseline.
- [401-Selector-Memoization.md](design/401-Selector-Memoization.md) — Reverse-index memoization layer for matching performance.
- [402-Pseudo-Elements.md](design/402-Pseudo-Elements.md) — Base-selector extraction and retention strategy for `::before`/`::after`/etc.
- [403-Pseudo-Classes.md](design/403-Pseudo-Classes.md) — Static vs. dynamic (interaction-state) pseudo-class handling and its explicit limitations.
- [404-Is-Where-Has.md](design/404-Is-Where-Has.md) — `:is()`/`:where()`/`:has()` matching, specificity nuances, and browser-support degradation.
- [405-Container-Queries.md](design/405-Container-Queries.md) — `@container` evaluation against live-rendered container size, per viewport profile.

### Dependency Resolution — Phase 7 complete

- [500-Dependency-Resolution-Overview.md](design/500-Dependency-Resolution-Overview.md) — Fixed-point resolution loop orchestrating the per-type algorithms below.
- [501-CSS-Variables.md](algorithms/501-CSS-Variables.md) — Custom property (`var()`) dependency discovery, chained/fallback values.
- [502-Keyframes.md](algorithms/502-Keyframes.md) — `@keyframes` dependency discovery via `animation-name`.
- [503-Font-Faces.md](algorithms/503-Font-Faces.md) — `@font-face` dependency discovery and weight/style matching tradeoffs.
- [504-At-Property.md](algorithms/504-At-Property.md) — `@property` registration retention alongside variable usage.
- [505-Counters.md](algorithms/505-Counters.md) — `@counter-style` dependency discovery via `counter()`/`counters()`.
- [506-Cascade-Layers.md](algorithms/506-Cascade-Layers.md) — Layer-aware dependency edge annotation for cross-layer dependencies.
- [507-Dependency-Graph-Construction.md](algorithms/507-Dependency-Graph-Construction.md) — Incremental graph assembly from all per-type discovery algorithms.
- [508-Cycle-Detection.md](algorithms/508-Cycle-Detection.md) — Incremental colored-DFS cycle detection and guaranteed-invalid-value recovery.

### Serialization — Phase 8 complete

- [600-Serialization-Overview.md](design/600-Serialization-Overview.md) — Serializer module: resolved rule set → valid CSS string, sub-concern decomposition.
- [601-Rule-Ordering.md](design/601-Rule-Ordering.md) — Preserving source order, cascade-layer order, and at-rule wrapper integrity.
- [602-Deduplication.md](design/602-Deduplication.md) — Semantics-preserving dedup, including the multi-viewport merge case.
- [603-Compression.md](design/603-Compression.md) — Deterministic minification: whitespace/comments/safe value shortening.
- [604-Output-Validation.md](design/604-Output-Validation.md) — Re-parse validation gate: syntactic validity, no dropped dependencies.
- [605-Source-Maps.md](design/605-Source-Maps.md) — Mapping emitted rules back to origin stylesheet + triggering DOM node.
- [606-Output-Formats.md](design/606-Output-Formats.md) — Raw CSS, inline `<style>`, JSON envelope, and route manifest output formats.

### Advanced Extraction — Phase 9 complete

- [700-Coverage-Mode.md](design/700-Coverage-Mode.md) — Chrome CSS Coverage API extraction strategy and its blind spots.
- [701-Hybrid-Mode.md](design/701-Hybrid-Mode.md) — Reconciling CSSOM matching + Coverage + computed-style signals (ADR-0005).
- [702-Computed-Style-Mode.md](design/702-Computed-Style-Mode.md) — getComputedStyle as a verification/pruning signal within Hybrid mode.
- [703-Visual-Diff.md](design/703-Visual-Diff.md) — Dual-render pixel-diff validation of rendering parity.
- [704-Incremental-Extraction.md](design/704-Incremental-Extraction.md) — Skip/partial/full extraction strategy with correctness guardrails.

### Caching — Phase 10 complete

- [800-Cache-Overview.md](design/800-Cache-Overview.md) — Cache Manager module: fingerprint-keyed lookup, sub-concern decomposition.
- [801-Fingerprinting.md](design/801-Fingerprinting.md) — Stable cache-key hashing of HTML, CSS assets, viewport, and mode.
- [802-Cache-Store.md](design/802-Cache-Store.md) — Pluggable storage backend abstraction (memory/disk/remote).
- [803-Route-Cache.md](design/803-Route-Cache.md) — Route-manifest-keyed caching with glob-pattern route templates.
- [804-Viewport-Cache.md](design/804-Viewport-Cache.md) — Per-(route, viewport) cache entries and cross-viewport dedup.
- [805-Cache-Invalidation.md](design/805-Cache-Invalidation.md) — Implicit fingerprint invalidation plus explicit purge/TTL/version-bump/cascade paths.
- [806-Distributed-Cache.md](design/806-Distributed-Cache.md) — Shared remote cache for CI/multi-runner builds with local fallback.

### SSR Integration — Phase 11 complete

- [900-SSR-Overview.md](design/900-SSR-Overview.md) — Common adapter contract: route → cached critical CSS → inline injection.
- [901-React-SSR.md](design/901-React-SSR.md) — Raw React SSR/streaming (renderToPipeableStream) adapter.
- [902-Express.md](design/902-Express.md) — Express middleware response-interception adapter.
- [903-NextJS.md](design/903-NextJS.md) — Next.js Pages Router and App Router adapter.
- [904-Astro.md](design/904-Astro.md) — Astro integration-hook adapter (SSG-first, island architecture).
- [905-Remix.md](design/905-Remix.md) — Remix entry.server nested-route adapter.
- [906-Fastify.md](design/906-Fastify.md) — Fastify `onSend`-hook plugin adapter.

Planned (not yet generated): Plugin SDK (Phase 12), Diagnostics (1000–1005, Phase 13), Performance (Phase 14), Testing (Phase 15), Implementation Task Catalog (Phase 16), Browser Specifications (Phase 17).

## docs/algorithms/ — Phase 7 complete

See `501-CSS-Variables.md` through `508-Cycle-Detection.md` listed above under Dependency Resolution (they live in `docs/algorithms/`, cross-referenced from `docs/design/500-Dependency-Resolution-Overview.md`).

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
