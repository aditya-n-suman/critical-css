# Critical CSS Engine — Implementation Plan

> Human-readable reference. For the agentic execution guide, see [AGENT_IMPL_BRIEF.md](./AGENT_IMPL_BRIEF.md).
> For live session-by-session progress, see [IMPL_STATUS.md](./IMPL_STATUS.md).

---

## Repository Context

All 17 documentation phases are complete (111 design files under `docs/`). Zero implementation code exists. This document is the bridge from documentation to code.

**Monorepo root:** this directory (`critical-css/`)
**Package manager:** pnpm with workspaces
**Language:** TypeScript (strict mode)
**Browser automation:** Playwright
**Build orchestration:** Turbo
**Test runner:** Vitest
**Node version:** ≥ 18

---

## Monorepo Layout (Target State)

```
critical-css/
├── BRIEF.md                         # documentation agent brief (existing)
├── AGENT_IMPL_BRIEF.md              # agentic implementation guide (this phase)
├── IMPLEMENTATION_PLAN.md           # this file
├── IMPL_STATUS.md                   # live session tracker
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── vitest.workspace.ts
├── .nvmrc                           # node >=18
├── docs/                            # existing 111 design docs
├── packages/
│   ├── shared/                      # AT-01 — M0
│   ├── browser/                     # AT-02 — M0
│   ├── collector/                   # AT-03 — M1
│   ├── matcher/                     # AT-04 — M1
│   ├── coverage/                    # AT-05 — M3 (parallel with AT-04)
│   ├── dependency-graph/            # AT-06 — M2
│   ├── serializer/                  # AT-07 — M1 (basic), M2 (full)
│   ├── cache/                       # AT-08 — M4 (parallel from AT-01)
│   ├── plugins/                     # AT-09 — M2 (parallel from AT-01)
│   └── reporter/                    # AT-10 — M3
├── apps/
│   ├── cli/                         # AT-11 — M1 (basic), M2+
│   ├── visualizer/                  # M5
│   └── playground/                  # M3+
├── fixtures/                        # HTML test fixtures (starts M0)
├── benchmarks/                      # M2+
└── examples/                        # M3+
```

---

## Implementation Milestones

Implementation follows the five-phase product roadmap from `BRIEF.md §2.17`, with one prerequisite foundation milestone (M0) prepended.

### M0 — Foundation *(start here)*

**Packages:** `packages/shared` (AT-01), `packages/browser` (AT-02)
**Parallel-eligible:** AT-02 can start scaffolding as soon as AT-01 exports its DTO stubs

**What gets built:**
- Root monorepo scaffold: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`, `vitest.workspace.ts`, `.nvmrc`
- `packages/shared`: all shared DTOs, configuration schema types, error type hierarchy
- `packages/browser`: `BrowserManager` (pool), `NavigationEngine` (stabilization), `ViewportManager` (device profiles), `DOMSnapshot` bridge, `PageHandle` DTO
- `fixtures/`: at minimum 3 HTML fixtures for M0 integration tests

**Design authority:** `docs/design/100–106`, `docs/adr/ADR-0001`, `docs/adr/ADR-0003`
**Task cards:** `docs/tasks/001-Implement-Browser-Pool.md`

**Exit criteria (all must be true):**
1. `pnpm install` succeeds, `pnpm build` compiles with zero TypeScript errors
2. All shared DTOs exported and stable — downstream packages compile against them
3. `BrowserManager` navigates to 3 fixtures, produces `PageHandle`, no resource leak across repeated runs
4. `ViewportManager` applies mobile `DeviceProfile` (non-default viewport)
5. `NavigationEngine` rendering-stabilization heuristic reports "stable" on a fixture with async-loaded content
6. All M0 tasks individually satisfy the 7-gate Definition of Done (`docs/implementation/004-Definition-of-Done.md`)

---

### M1 — CSSOM Extraction MVP *(BRIEF §2.17 Phase 1)*

**Packages:** `packages/collector` (AT-03, CSSOM Walker + DOM Collector sub-modules only), `packages/matcher` (AT-04), `packages/serializer` (AT-07, basic rule ordering + output only), `apps/cli` (AT-11, minimum viable CLI: single URL → stdout CSS)

**Design authority:**
- Collector: `docs/design/106`, `docs/design/300–307`
- Matcher: `docs/design/400–405`, `docs/adr/ADR-0002`
- Serializer (basic): `docs/design/600–601`
- CLI (basic): `docs/architecture/011`, `docs/architecture/016`

**Task cards:** `docs/tasks/002-Implement-CSSOM-Walker.md`, `docs/tasks/003-Implement-Selector-Matcher.md`, `docs/tasks/006-Implement-Serializer.md`, `docs/tasks/011-Implement-CLI.md`

**Exit criteria:**
1. `critical-css-engine extract --url http://localhost:PORT` emits a valid CSS string to stdout
2. Extracted CSS, when inlined in `<style>` on a fixture page, renders the above-fold viewport identically to the original (visual diff passes)
3. Selector matching uses only `element.matches()` — no custom parser
4. Output is deterministic: two identical extraction runs produce byte-identical output
5. Golden CSS snapshot suite (`docs/testing/003-Golden-Files.md`) passes for all M1 fixtures
6. All M1 tasks individually satisfy the 7-gate Definition of Done

---

### M2 — Dependency Graph, Media/Layer Support, Plugin System *(BRIEF §2.17 Phase 2)*

**Packages:** `packages/dependency-graph` (AT-06, full), `packages/serializer` (AT-07, full — compression, source maps, output formats), `packages/plugins` (AT-09), `packages/collector` (AT-03, Visibility Engine sub-module)

**Design authority:**
- Dependency graph: `docs/design/500`, `docs/algorithms/501–508`
- Serializer (full): `docs/design/600–606`
- Plugins: `docs/plugins/000–004`, `docs/adr/ADR-0004`
- Visibility: `docs/design/200–207`

**Task cards:** `docs/tasks/004-Implement-Dependency-Resolver.md`, `docs/tasks/005-Implement-Visibility-Engine.md`, `docs/tasks/008-Implement-Plugin-System.md`

**Exit criteria:**
1. CSS variable references, keyframes, and `@font-face` declarations used by matched rules are always included in output
2. Dependency resolution reaches fixed point (cycle detection passes for circular `@import`)
3. Plugin lifecycle hooks (`beforeLaunch`, `afterNavigation`, `beforeCollection`, `afterCollection`, `beforeSerialize`, `afterSerialize`) are callable and sandboxed
4. Visibility Engine correctly classifies sticky, fixed, overflow-hidden, and CSS-transformed elements
5. All M2 tasks individually satisfy the 7-gate Definition of Done

---

### M3 — Multi-Device, Coverage Mode, Hybrid Mode *(BRIEF §2.17 Phase 3)*

**Packages:** `packages/coverage` (AT-05), `packages/reporter` (AT-10), `apps/playground`

**Design authority:**
- Coverage: `docs/design/700`, `docs/adr/ADR-0005`
- Hybrid: `docs/design/701–702`, bundled into `packages/dependency-graph`
- Reporter: `docs/design/1000–1005`

**Task cards:** `docs/tasks/009-Implement-Reporter.md`, `docs/tasks/010-Implement-SSR-Adapters.md`

**Exit criteria:**
1. Mobile, Tablet, Desktop extractions run independently and merge correctly
2. Coverage mode integrates Chrome DevTools Protocol, does not depend on `packages/matcher`
3. Hybrid mode composes CSSOM + Coverage outputs in `packages/dependency-graph`
4. Reporter emits: matched/unmatched selector report, dependency graph, timing report, stylesheet contribution report
5. All M3 tasks individually satisfy the 7-gate Definition of Done

---

### M4 — CI Integration, Route Manifest, Incremental Cache *(BRIEF §2.17 Phase 4)*

**Packages:** `packages/cache` (AT-08, full), `apps/cli` (full: route manifest, CI flags, baseline comparison)

**Design authority:** `docs/design/800–806`, `docs/architecture/011`

**Task cards:** `docs/tasks/007-Implement-Cache-Manager.md`

**Exit criteria:**
1. Route manifest (`{ "/": "home.css", … }`) resolves to per-route CSS output files
2. Fingerprint-gated cache returns previous result on identical HTML/CSS/viewport inputs
3. CLI `--compare-baseline` fails build when CSS grows beyond threshold
4. Distributed cache backend interface is pluggable
5. All M4 tasks individually satisfy the 7-gate Definition of Done

---

### M5 — Visual Debugger, IDE Support, Distributed Crawler *(BRIEF §2.17 Phase 5)*

**Apps:** `apps/visualizer` (HTML debug overlay), `apps/playground` (interactive extraction sandbox)

**Design authority:** `docs/design/1004–1005`, `docs/performance/000–005`

**Exit criteria:**
1. Visualizer renders above-fold node highlights and matched rule overlay on any fixture
2. Performance benchmarks run against Tailwind/Bootstrap/enterprise stylesheet fixtures and emit CSV/JSON reports
3. Distributed crawler interface defined and documented
4. All M5 tasks individually satisfy the 7-gate Definition of Done

---

## Package Build Order (Topological)

| Level | Package | Milestone | Depends on |
|---|---|---|---|
| 0 | `packages/shared` | M0 | — |
| 1 | `packages/browser` | M0 | shared |
| 2 | `packages/cache` | M4 | shared (parallel-eligible from level 0) |
| 2 | `packages/plugins` | M2 | shared (parallel-eligible from level 0) |
| 3 | `packages/collector` | M1 (CSSOM+DOM), M2 (Visibility) | browser, shared |
| 3 | `packages/coverage` | M3 | browser, shared |
| 4 | `packages/matcher` | M1 | collector, browser, shared |
| 5 | `packages/dependency-graph` | M2 | matcher, coverage, shared |
| 6 | `packages/serializer` | M1 (basic), M2 (full) | dependency-graph, shared |
| 7 | `packages/reporter` | M3 | serializer, shared |
| 8 | `apps/cli` | M1 (MVP), M4 (full) | all packages |
| 8 | `apps/visualizer` | M5 | reporter, serializer |
| 8 | `apps/playground` | M3+ | browser, collector, matcher |

---

## Definition of Done (7 Gates)

Every task card must pass all applicable gates before it is considered complete. Reference: `docs/implementation/004-Definition-of-Done.md`.

| Gate | Requirement |
|---|---|
| G1 — Type-check | `pnpm typecheck` exits 0 with strict mode, no `any` suppressions without justification |
| G2 — Unit tests | All public functions/classes have colocated unit tests; coverage ≥ 90% of new lines |
| G3 — Golden files | Serialized output for all applicable fixtures matches golden snapshots in `fixtures/golden/` |
| G4 — Visual tests | Visual regression suite passes for all applicable fixtures |
| G5 — Performance | No regression beyond ±5% against the baseline benchmark for the affected package |
| G6 — Docs updated | Public API surface reflected in the package's `README.md`; cross-references in `docs/` updated if signatures changed |
| G7 — Code review | At least one review pass (human or agent-driven adversarial review) before marking complete |

*Gate applicability by task type: New module — all 7. Bug fix — G1, G2, G3, G7. Performance optimization — G1, G5, G7.*

---

## Tech Stack (Canonical)

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x, strict mode | Type-safe DTOs, project references for build isolation |
| Package manager | pnpm 9.x | Workspaces, disk efficiency, deterministic lockfile |
| Monorepo orchestration | Turbo 2.x | Task pipeline caching, parallel execution |
| Browser automation | Playwright latest | ADR-0003; cross-browser, stable pool API |
| Test runner | Vitest 2.x | Native ESM, workspace-aware, inline coverage |
| Linter | ESLint 9 + `@typescript-eslint` | Consistent code style |
| Formatter | Prettier | Deterministic formatting |
| Node version | ≥ 18.0.0 | Playwright requirement; `fetch`, `structuredClone` builtins |

---

## References

- `docs/implementation/000-Architecture-Tasks.md` — package build order rationale
- `docs/implementation/001-Task-Breakdown.md` — breakdown items per package
- `docs/implementation/002-Milestones.md` — full exit criteria per milestone
- `docs/implementation/003-Acceptance-Tests.md` — per-requirement acceptance tests
- `docs/implementation/004-Definition-of-Done.md` — 7-gate completion checklist
- `docs/tasks/001–011*.md` — atomic task cards
- `BRIEF.md §2.17` — five-phase product roadmap
- `BRIEF.md §2.19` — canonical repository layout
