# Critical CSS Engine — Documentation Agent Brief

> Feed this document to a Claude agent at the start of every documentation-generation session.
> The agent must treat this as the authoritative instruction set for the entire project.

---

## 1. Project Summary

**Project Name:** Critical CSS Extraction Engine
**Purpose:** A production-grade, browser-driven Critical CSS extractor that uses the live browser CSSOM as the source of truth instead of static HTML/CSS parsing. It does **not** use existing libraries (Critical, Critters, Penthouse, etc.).

**Primary Deliverable:** A complete engineering documentation repository sufficient for an autonomous coding agent to implement the project from scratch with minimal human intervention. Quality bar: comparable to LLVM, React, Kubernetes, Rust, Chromium, and V8 documentation.

---

## 2. Engine Design Reference

The following is the canonical engineering design that every documentation file must be consistent with.

### 2.1 Vision

Build a production-grade Critical CSS extraction engine that uses the browser as the rendering authority instead of static HTML/CSS analysis. The system accurately extracts only the CSS required to render above-the-fold content for one or more viewport profiles while preserving rendering fidelity.

### 2.2 Non-Goals

- Do not use existing critical CSS generators (Critical, Critters, Penthouse, etc.)
- Do not rely on static CSS parsing to determine usage
- Do not compromise correctness for premature optimization

### 2.3 High-Level Requirements

1. CSSOM-driven extraction
2. Pluggable extraction strategies (CSSOM, Coverage, Hybrid)
3. Multi-viewport support
4. Device profiles
5. Route-level generation
6. Incremental caching
7. SSR integration
8. CI/CD integration
9. Dependency graph generation
10. Rich diagnostics and reporting

### 2.4 System Modules

| Module | Responsibility |
|---|---|
| CLI | Entry point, argument parsing, orchestration |
| Configuration Loader | Validate and resolve config from file/CLI/env |
| Browser Manager | Playwright browser pool lifecycle |
| Navigation Engine | Page navigation, rendering stabilization |
| DOM Collector | Above-fold DOM snapshot, node enumeration |
| Visibility Engine | Geometry, intersection, overflow, transforms |
| CSSOM Walker | Stylesheet tree traversal, rule extraction |
| Selector Matcher | `element.matches()` delegation, memoization |
| Dependency Resolver | Variables, keyframes, fonts, @property, layers |
| Cascade Resolver | Specificity, origin, layer ordering |
| Serializer | Rule ordering, deduplication, output formatting |
| Minifier | Compression, whitespace removal |
| Cache Manager | Fingerprinting, route cache, invalidation |
| Coverage Engine | Chrome DevTools Coverage API integration |
| Reporter | Dependency graph, matched/unmatched selectors, timing |
| Plugin System | Lifecycle hooks, sandboxing, extensibility |

### 2.5 Core Algorithms

#### Visibility Detection
- Traverse every DOM node
- Visible if: intersects viewport/fold AND has non-zero dimensions AND not `display:none` AND not `visibility:hidden` (configurable) AND opacity handling configurable AND optionally ignores transformed-offscreen nodes
- Future: IntersectionObserver-assisted mode, layout-shift-aware rescanning

#### Rule Matching
- Use `element.matches()` as the canonical selector evaluator
- Support: combinators, nesting, pseudo-elements, `:is()`, `:where()`, `:has()` (browser permitting), attribute selectors, namespace selectors
- **Never implement a custom selector parser**

#### Dependency Resolution
- Build a dependency graph
- Track: CSS variables, keyframes, font faces, `@property`, `@counter-style`, `@layer`, `@supports`, media queries, container queries, view transitions, scroll timelines
- Iteratively resolve until fixed point

### 2.6 Multi-Viewport Strategy
- Generate critical CSS independently for Mobile, Tablet, Desktop
- Merge by: identical rules, media query normalization, dependency deduplication

### 2.7 Hybrid Extraction Mode
Combine:
1. CSSOM selector matching
2. Chrome CSS Coverage
3. `getComputedStyle` verification

### 2.8 Incremental Cache
- Fingerprint: HTML, CSS assets, viewport, extraction mode
- Reuse previous extraction when fingerprints match

### 2.9 Route Manifest

```json
{ "/": "home.css", "/products": "products.css", "/blog/*": "blog.css" }
```

### 2.10 SSR Integration
Adapters: React SSR, Next.js, Astro, Remix, Express, Fastify
Provide middleware for automatic CSS injection.

### 2.11 CI/CD Pipeline
`Build → Crawl routes → Generate critical CSS → Compare against baseline → Publish artifacts → Upload reports`

Fail build if: CSS grows beyond threshold, missing dependencies detected, extraction errors occur.

### 2.12 Diagnostics
- Dependency graph
- Matched selector report
- Unmatched selector report
- Stylesheet contribution report
- Timing report
- Extraction trace
- Optional HTML visualization highlighting above-fold nodes and matched rules

### 2.13 Plugin System Hooks
`beforeLaunch`, `afterNavigation`, `beforeCollection`, `afterCollection`, `beforeSerialize`, `afterSerialize`

Plugins may: ignore selectors, rewrite CSS, inject rules, customize visibility, customize matching.

### 2.14 Performance Optimizations
Rule indexing, selector memoization, parallel stylesheet traversal, browser-side execution, batched serialization, worker threads, route batching, streaming output, memory profiling.

### 2.15 Testing Strategy
Layers: Unit, Integration, Visual Regression, Golden CSS snapshots, Performance benchmarks

Fixtures: Tailwind, Bootstrap, CSS Modules, Styled Components, Emotion, Shadow DOM, SVG, Container Queries, Nested CSS, Huge enterprise stylesheets.

### 2.16 Security
Graceful handling of cross-origin stylesheets, browser sandboxing, configurable network restrictions, timeout protection.

### 2.17 Roadmap
- **Phase 1:** CSSOM extraction MVP
- **Phase 2:** Dependency graph, media/layer support, plugin system
- **Phase 3:** Multi-device extraction, coverage mode, hybrid mode
- **Phase 4:** CI integration, route manifest, incremental cache
- **Phase 5:** Visual debugger, IDE support, distributed crawler

### 2.18 Acceptance Criteria
- Rendering parity with original page
- Deterministic output
- Configurable viewport and fold
- Robust dependency resolution
- High test coverage
- Extensible architecture
- Suitable for enterprise CI pipelines

### 2.19 Canonical Repository Layout

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

---

## 3. Documentation Repository Layout

Every file lives inside `docs/` at the root of `critical-css-engine/`.

```
docs/
├── README.md
├── SUMMARY.md          # Table of contents; kept updated after every phase
├── TOC.md
├── STATUS.md           # What is complete, in-progress, planned
├── ROADMAP.md          # Documentation phases mapped to implementation milestones
├── spec/               # Browser specifications the engine relies on
├── adr/                # Architectural Decision Records
├── architecture/       # System overview, pipelines, data flow
├── design/             # Module-level design documents
├── algorithms/         # Algorithm RFCs
├── api/                # Public API, interfaces, DTOs
├── plugins/            # Plugin SDK docs
├── testing/            # Testing strategy, fixtures, golden files
├── performance/        # Benchmarks, profiling, memory
├── implementation/     # Task breakdown, milestones, definition of done
├── tasks/              # Atomic implementation task cards
├── research/           # Future research, open questions
└── examples/           # Annotated usage examples
```

---

## 4. Global Rules (Must Be Followed in Every File)

### 4.1 File Structure

Every generated markdown file must contain all of these sections in order:

1. Title
2. Version
3. Purpose
4. Audience
5. Prerequisites
6. Related Documents
7. Overview
8. Detailed Design
9. Architecture (with Mermaid diagrams where applicable)
10. Algorithms (pseudocode + complexity)
11. Implementation Notes
12. Edge Cases
13. Tradeoffs
14. Performance
15. Testing
16. Future Work
17. References

### 4.2 Length

- **Minimum:** 3,000–5,000 words per file
- Files exceeding a single response are split into `Part-1`, `Part-2`, `Part-3` etc.
- Every part must be independently readable

### 4.3 Writing Style

- Write like an RFC (React RFCs, Rust RFCs, Kubernetes KEPs, LLVM design docs)
- Avoid tutorial style and conversational language
- Assume the reader is a senior engineer
- Every design choice must explain: Why, Alternatives, Tradeoffs, Future implications

### 4.4 Diagrams

Use Mermaid for all diagrams. Include where appropriate:
- Flowcharts
- Sequence diagrams
- Class diagrams
- ER diagrams
- State diagrams
- Dependency graphs
- Pipeline diagrams

### 4.5 Algorithms

Every algorithm section must include:
- Problem statement
- Inputs and outputs
- Pseudocode
- Time complexity
- Memory complexity
- Failure cases
- Optimization opportunities

### 4.6 APIs

Every module document must define:
- Interfaces
- Classes
- DTOs
- Events
- Configuration schema
- Error types
- Usage examples
- Future extensibility

### 4.7 Performance

Every document must discuss:
- CPU complexity
- Memory complexity
- Caching strategy
- Parallelization opportunities
- Incremental execution
- Profiling guidance
- Scalability limits

### 4.8 Testing

Every subsystem document must define:
- Unit tests
- Integration tests
- Visual tests
- Stress tests
- Regression tests
- Benchmark tests

### 4.9 Edge Cases

Every document must explicitly list:
- Known browser quirks
- CSS specification corner cases
- Rendering edge cases
- Shadow DOM behavior
- Cross-origin constraints
- Constructable stylesheets
- Nested CSS
- Future CSS specifications

### 4.10 Future Research

Every document must conclude with:
- Potential optimizations
- Future RFCs
- Research ideas
- Open questions

### 4.11 File Naming

```
NNN-Name.md
```
Examples:
- `001-Vision.md`
- `002-Problem.md`
- `301-Visibility-Engine-Part-1.md`
- `302-Visibility-Engine-Part-2.md`

### 4.12 Cross-References

Every document must reference related documents by relative path:
```markdown
See [003-Design-Principles](../architecture/003-Design-Principles.md) for context.
```

---

## 5. Documentation Generation Phases

Each phase is an independent iteration. Run one phase per agent session unless the context window allows more.

### Phase 1 — Repository Foundation
**Directory:** `docs/`, `docs/architecture/`, `docs/adr/`

Files to generate:
- `docs/README.md`
- `docs/SUMMARY.md`
- `docs/STATUS.md`
- `docs/ROADMAP.md`
- `docs/architecture/001-Vision.md`
- `docs/architecture/002-Problem-Statement.md`
- `docs/architecture/003-Requirements.md`
- `docs/architecture/004-Terminology.md`
- `docs/architecture/005-Glossary.md`
- `docs/architecture/006-Design-Principles.md`
- `docs/architecture/007-Repository-Structure.md`
- `docs/adr/ADR-0001-Browser-Is-Source-of-Truth.md`
- `docs/adr/ADR-0002-No-Custom-Selector-Parser.md`
- `docs/adr/ADR-0003-Playwright-As-Browser-Abstraction.md`
- `docs/adr/ADR-0004-Plugin-Lifecycle-Model.md`
- `docs/adr/ADR-0005-Hybrid-Extraction-Mode.md`

### Phase 2 — Architecture
**Directory:** `docs/architecture/`

Files to generate:
- `docs/architecture/010-System-Overview.md`
- `docs/architecture/011-Execution-Pipeline.md`
- `docs/architecture/012-Module-Interaction.md`
- `docs/architecture/013-Component-Diagram.md`
- `docs/architecture/014-Dependency-Graph.md`
- `docs/architecture/015-Runtime-Model.md`
- `docs/architecture/016-Data-Flow.md`

### Phase 3 — Browser Layer
**Directory:** `docs/design/`

Files to generate:
- `docs/design/100-Browser-Abstraction.md`
- `docs/design/101-Playwright-Adapter.md`
- `docs/design/102-Browser-Pool.md`
- `docs/design/103-Navigation-Engine.md`
- `docs/design/104-Rendering-Stabilization.md`
- `docs/design/105-Viewport-Manager.md`
- `docs/design/106-DOM-Snapshot.md`

### Phase 4 — Visibility Engine
**Directory:** `docs/design/`

Files to generate (split as needed):
- `docs/design/200-Visibility-Engine-Overview.md`
- `docs/design/201-Geometry-Engine.md`
- `docs/design/202-Intersection-Engine.md`
- `docs/design/203-Overflow-Handling.md`
- `docs/design/204-Transform-Handling.md`
- `docs/design/205-Sticky-Elements.md`
- `docs/design/206-Fixed-Elements.md`
- `docs/design/207-Virtualized-Lists.md`

### Phase 5 — CSSOM
**Directory:** `docs/design/`

Files to generate:
- `docs/design/300-CSSOM-Walker.md`
- `docs/design/301-Stylesheet-Loader.md`
- `docs/design/302-Rule-Tree.md`
- `docs/design/303-Media-Rules.md`
- `docs/design/304-Supports-Rules.md`
- `docs/design/305-Cascade-Layers.md`
- `docs/design/306-At-Import.md`
- `docs/design/307-Constructable-Stylesheets.md`

### Phase 6 — Selector Engine
**Directory:** `docs/design/`

Files to generate:
- `docs/design/400-Selector-Matching.md`
- `docs/design/401-Selector-Memoization.md`
- `docs/design/402-Pseudo-Elements.md`
- `docs/design/403-Pseudo-Classes.md`
- `docs/design/404-Is-Where-Has.md`
- `docs/design/405-Container-Queries.md`

### Phase 7 — Dependency Resolution
**Directory:** `docs/design/`, `docs/algorithms/`

Files to generate:
- `docs/design/500-Dependency-Resolution-Overview.md`
- `docs/algorithms/501-CSS-Variables.md`
- `docs/algorithms/502-Keyframes.md`
- `docs/algorithms/503-Font-Faces.md`
- `docs/algorithms/504-At-Property.md`
- `docs/algorithms/505-Counters.md`
- `docs/algorithms/506-Cascade-Layers.md`
- `docs/algorithms/507-Dependency-Graph-Construction.md`
- `docs/algorithms/508-Cycle-Detection.md`

### Phase 8 — Serialization
**Directory:** `docs/design/`

Files to generate:
- `docs/design/600-Serialization-Overview.md`
- `docs/design/601-Rule-Ordering.md`
- `docs/design/602-Deduplication.md`
- `docs/design/603-Compression.md`
- `docs/design/604-Output-Validation.md`
- `docs/design/605-Source-Maps.md`
- `docs/design/606-Output-Formats.md`

### Phase 9 — Advanced Extraction
**Directory:** `docs/design/`

Files to generate:
- `docs/design/700-Coverage-Mode.md`
- `docs/design/701-Hybrid-Mode.md`
- `docs/design/702-Computed-Style-Mode.md`
- `docs/design/703-Visual-Diff.md`
- `docs/design/704-Incremental-Extraction.md`

### Phase 10 — Caching
**Directory:** `docs/design/`

Files to generate:
- `docs/design/800-Cache-Overview.md`
- `docs/design/801-Fingerprinting.md`
- `docs/design/802-Cache-Store.md`
- `docs/design/803-Route-Cache.md`
- `docs/design/804-Viewport-Cache.md`
- `docs/design/805-Cache-Invalidation.md`
- `docs/design/806-Distributed-Cache.md`

### Phase 11 — SSR Integration
**Directory:** `docs/design/`

Files to generate:
- `docs/design/900-SSR-Overview.md`
- `docs/design/901-React-SSR.md`
- `docs/design/902-Express.md`
- `docs/design/903-NextJS.md`
- `docs/design/904-Astro.md`
- `docs/design/905-Remix.md`
- `docs/design/906-Fastify.md`

### Phase 12 — Plugin SDK
**Directory:** `docs/plugins/`

Files to generate:
- `docs/plugins/000-Plugin-SDK-Overview.md`
- `docs/plugins/001-Lifecycle-Hooks.md`
- `docs/plugins/002-Plugin-API.md`
- `docs/plugins/003-Plugin-Examples.md`
- `docs/plugins/004-Sandboxing.md`

### Phase 13 — Diagnostics
**Directory:** `docs/design/`

Files to generate:
- `docs/design/1000-Diagnostics-Overview.md`
- `docs/design/1001-Logging.md`
- `docs/design/1002-Metrics.md`
- `docs/design/1003-Tracing.md`
- `docs/design/1004-Visualization.md`
- `docs/design/1005-Debug-UI.md`

### Phase 14 — Performance
**Directory:** `docs/performance/`

Files to generate:
- `docs/performance/000-Performance-Overview.md`
- `docs/performance/001-Worker-Threads.md`
- `docs/performance/002-Parallelization-Strategy.md`
- `docs/performance/003-Rule-Indexing.md`
- `docs/performance/004-Memory-Optimization.md`
- `docs/performance/005-Benchmarks.md`

### Phase 15 — Testing
**Directory:** `docs/testing/`

Files to generate:
- `docs/testing/000-Testing-Strategy.md`
- `docs/testing/001-Fixtures.md`
- `docs/testing/002-Visual-Tests.md`
- `docs/testing/003-Golden-Files.md`
- `docs/testing/004-Performance-Tests.md`
- `docs/testing/005-Regression-Tests.md`

### Phase 16 — Implementation Task Catalog
**Directory:** `docs/implementation/`, `docs/tasks/`

Files to generate:
- `docs/implementation/000-Architecture-Tasks.md`
- `docs/implementation/001-Task-Breakdown.md`
- `docs/implementation/002-Milestones.md`
- `docs/implementation/003-Acceptance-Tests.md`
- `docs/implementation/004-Definition-of-Done.md`
- `docs/tasks/` — One file per atomic implementation task (agent generates as many as fit)

### Phase 17 — Browser Specifications
**Directory:** `docs/spec/`

Files to generate:
- `docs/spec/000-CSSOM.md`
- `docs/spec/001-CSS-Variables.md`
- `docs/spec/002-Cascade.md`
- `docs/spec/003-Media-Queries.md`
- `docs/spec/004-Shadow-DOM.md`
- `docs/spec/005-Coverage-API.md`
- `docs/spec/006-Container-Queries.md`
- `docs/spec/007-Nested-CSS.md`
- `docs/spec/008-Constructable-Stylesheets.md`

---

## 6. Per-Phase Prompt Template

Use this prompt verbatim (substituting phase number and name) when starting each iteration:

```
You are generating engineering documentation for the Critical CSS Engine project.

Read the Documentation Agent Brief carefully before generating anything.

Generate Phase N — [Phase Name] of the documentation repository.

Follow all Global Rules (Section 4) from the brief exactly:
- Minimum 3000–5000 words per file
- RFC-style writing for senior engineers
- Mermaid diagrams wherever applicable
- Algorithms include pseudocode and complexity analysis
- Every file contains all required sections
- Every design choice explains Why / Alternatives / Tradeoffs

Produce complete markdown content for every file listed in Phase N.
Split any file that exceeds this response into sequential Part-N files.
Maintain cross-references to previously generated documents using relative paths.
Update SUMMARY.md and STATUS.md at the end of the response to reflect newly generated files.

Do not summarize. Do not write placeholders. Generate production-quality engineering documentation that an autonomous coding agent can implement from directly.

End the response only when the context window is exhausted.
The next prompt will continue exactly where this response stopped.
```

---

## 7. Consistency Tracking

After every phase, the agent must update:

| File | Update Rule |
|---|---|
| `docs/SUMMARY.md` | Add entries for every newly generated file |
| `docs/STATUS.md` | Mark phase as complete; update in-progress |
| `docs/ROADMAP.md` | Update only if scope changes |

---

## 8. Quality Checklist (Run Before Closing Each Phase)

The agent must self-verify before closing the response:

- [ ] Every file has all 17 required sections
- [ ] No file is shorter than 3,000 words
- [ ] All Mermaid diagrams are syntactically valid
- [ ] Every algorithm has pseudocode and Big-O notation
- [ ] Every design choice includes alternatives and tradeoffs
- [ ] Cross-references use correct relative paths
- [ ] SUMMARY.md and STATUS.md updated
- [ ] Split files are numbered sequentially and each is independently readable

---

## 9. Starting Instruction for First Agent Session

Feed this entire document to the agent and then append:

```
Begin with Phase 1 — Repository Foundation.

Generate all files listed in Phase 1 now.
Apply all Global Rules without exception.
After generating all Phase 1 files, update SUMMARY.md and STATUS.md.
```

For every subsequent session, feed this document again and append:

```
Phase [N-1] is complete. The generated files are listed in docs/STATUS.md.
Begin Phase N — [Phase Name] now.
```
