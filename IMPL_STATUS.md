# Implementation Status

> This file is the single source of truth for implementation progress.
> Every agent session **must** read this file first and **must** update it before ending.
> Do not update this file mid-task — only update at session boundaries.

---

## Current State

| Field | Value |
|---|---|
| Active milestone | **M1 — CSSOM Extraction MVP** |
| Active package | **packages/collector** |
| Active task | **M1 step 1 — collector (CSSOM Walker + DOM Collector)** |
| Last session | 2026-07-11 (M0 complete: scaffold + shared + browser) |
| Next action | See "What to do next" below |

---

## What to Do Next

**Start M1 — CSSOM Extraction MVP.** (M0 is complete.)

Execute in this order (per `AGENT_IMPL_BRIEF.md §Phase M1`):

1. **`packages/collector`** — CSSOM Walker + DOM Collector sub-modules
   - Read `docs/tasks/002-Implement-CSSOM-Walker.md`, `docs/design/300–307`, `docs/design/106`
   - Read `docs/implementation/001-Task-Breakdown.md §8.4` (BI-03.*)
2. **`packages/matcher`** — `element.matches()`-only selector matching
   - Read `docs/tasks/003-Implement-Selector-Matcher.md`, `docs/design/400–405`, `docs/adr/ADR-0002`
3. **`packages/serializer`** (basic slice: rule ordering + string output)
   - Read `docs/tasks/006-Implement-Serializer.md`, `docs/design/600–601`
4. **`apps/cli`** (MVP: `extract --url <url> [--viewport ...] [--output ...]`)
   - Read `docs/tasks/011-Implement-CLI.md`
5. **Golden baseline**: generate `fixtures/golden/{static,async,mobile}.css` and commit
6. **M1 exit criteria check**, then update this file

---

## Milestone Progress

### M0 — Foundation

| Item | Status | Notes |
|---|---|---|
| Monorepo scaffold (root config files) | Complete | Turbo 2 uses `tasks` (not `pipeline`) — see Known Blockers |
| `packages/shared` scaffold (BI-01.1) | Complete | |
| `packages/shared` DTOs (BI-01.2) | Complete | 9 DTO families + config schema; zero Node built-ins (grep-verified) |
| `packages/shared` error hierarchy (BI-01.3) | Complete | `ExtractionError` + 6 subclasses, `toDiagnostic()` |
| `packages/shared` unit tests (BI-01.4) | Complete | 29 tests: error→diagnostic, fingerprint stability, type-level DTO checks |
| `packages/browser` scaffold (BI-02.1) | Complete | |
| `packages/browser` BrowserManager + pool (BI-02.2) | Complete | FIFO semaphore, health check, shared in-flight launch, drain/teardown |
| `packages/browser` NavigationEngine + stabilization (BI-02.3) | Complete | RAF-gated mutation quiescence + fonts/readyState gates, 5s soft deadline |
| `packages/browser` ViewportManager (BI-02.4) | Complete | desktop/tablet/mobile built-ins; context-time emulation via `acquire(profile)` |
| `packages/browser` DOMSnapshot / PageHandle (BI-02.5) | Complete | Single-round-trip above-fold walk, style allow-list, 2dp geometry epsilon |
| `packages/browser` integration tests + fixtures (BI-02.6) | Complete | 18 tests vs real Chromium; fixtures static/async/mobile |
| **M0 exit criteria: all 6 pass** | Complete | install/build/typecheck 0; browser tests green; no shared Node imports; mobile profile verified in-page; async stabilization verified |

### M1 — CSSOM Extraction MVP

| Item | Status | Notes |
|---|---|---|
| `packages/collector` CSSOM Walker + DOM Collector | Not started | Blocked on M0 |
| `packages/matcher` | Not started | Blocked on collector |
| `packages/serializer` (basic) | Not started | Blocked on matcher |
| `apps/cli` (MVP — single URL → stdout CSS) | Not started | Blocked on serializer |
| Golden CSS snapshot baseline created | Not started | |
| **M1 exit criteria: all 6 pass** | Not started | |

### M2 — Dependency Graph, Media/Layer, Plugins

| Item | Status | Notes |
|---|---|---|
| `packages/dependency-graph` | Not started | Blocked on M1 |
| `packages/serializer` (full) | Not started | Blocked on dependency-graph |
| `packages/plugins` | Not started | Parallel-eligible from M0 |
| `packages/collector` Visibility Engine | Not started | Blocked on M0 |
| **M2 exit criteria: all 5 pass** | Not started | |

### M3 — Multi-Device, Coverage, Hybrid

| Item | Status | Notes |
|---|---|---|
| `packages/coverage` | Not started | Blocked on M0 (parallel with M1) |
| Hybrid mode (in dependency-graph) | Not started | Blocked on M2 |
| `packages/reporter` | Not started | Blocked on M2 |
| `apps/playground` | Not started | |
| **M3 exit criteria: all 5 pass** | Not started | |

### M4 — CI, Route Manifest, Cache

| Item | Status | Notes |
|---|---|---|
| `packages/cache` | Not started | Blocked on M3 |
| `apps/cli` (full: routes, baseline, CI) | Not started | Blocked on cache |
| **M4 exit criteria: all 5 pass** | Not started | |

### M5 — Visual Debugger, IDE, Distributed Crawler

| Item | Status | Notes |
|---|---|---|
| `apps/visualizer` | Not started | Blocked on M4 |
| Benchmarks (`benchmarks/`) | Not started | |
| **M5 exit criteria: all 4 pass** | Not started | |

---

## Session Log

| Date | Agent/Person | Work Done | Status After |
|---|---|---|---|
| 2026-07-11 | Planning session | Created `IMPLEMENTATION_PLAN.md`, `AGENT_IMPL_BRIEF.md`, `IMPL_STATUS.md` | Pre-M0, no code |
| 2026-07-11 | Implementation agent | M0 complete: root scaffold (pnpm/turbo/tsconfig/vitest), `packages/shared` (DTOs, error hierarchy, 29 unit tests), `packages/browser` (BrowserManager pool, NavigationEngine + Stability Window, ViewportManager, DOMSnapshot, PageHandle; 18 tests incl. real-Chromium integration), 3 HTML fixtures | M0 Complete; M1 not started |

---

## Known Blockers / Issues

- **Doc divergence — `turbo.json` key:** `AGENT_IMPL_BRIEF.md §6 Step 1` shows a Turbo 1.x `"pipeline"` key, but the canonical stack pins Turbo 2.x, which requires `"tasks"`. Implemented with `"tasks"`. Brief sample should be corrected by the doc owner.
- **Doc divergence — built-in viewport profiles:** `AGENT_IMPL_BRIEF.md` specifies desktop 1280×800 / tablet 768×1024 / mobile 375×812, while `docs/design/105-Viewport-Manager.md §8.1` shows Mobile 375×667 / Desktop 1920×1080. Implemented per the brief (its M0 exit checklist tests reference these values). Raise with project owner which set is canonical.
- **`ViewportProfile` naming:** the brief's shared DTO list names `ViewportProfile` with a `foldOffset` field; design doc 105 models a `DeviceProfile` (with `customFoldOffsetPx`) wrapped by a `ViewportProfile` id. M0 implements the brief's flat `ViewportProfile` carrying all 105 emulation fields + `foldOffset`; the id-wrapper split can be layered in M3 (multi-viewport merge) without breaking downstream consumers.

---

## Update Protocol

When updating this file, change:
1. **Current State** table — `Active milestone`, `Active package`, `Active task`, `Last session`, `Next action`
2. The relevant **Milestone Progress** table row(s) — change `Not started` → `In progress` → `Complete`
3. Add a row to **Session Log**
4. Add any blockers to **Known Blockers / Issues**
