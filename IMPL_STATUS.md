# Implementation Status

> This file is the single source of truth for implementation progress.
> Every agent session **must** read this file first and **must** update it before ending.
> Do not update this file mid-task — only update at session boundaries.

---

## Current State

| Field | Value |
|---|---|
| Active milestone | **M0 — Foundation** |
| Active package | **Not started** |
| Active task | **Not started — begin with monorepo scaffold** |
| Last session | 2026-07-11 (plan + agent brief authored) |
| Next action | See "What to do next" below |

---

## What to Do Next

**Start M0 — Foundation.**

Execute in this order:

1. **Monorepo scaffold** (no package — root level)
   - Create `package.json` (pnpm workspace root, scripts: `build`, `test`, `typecheck`, `lint`, `format`)
   - Create `pnpm-workspace.yaml` (include `packages/*`, `apps/*`)
   - Create `tsconfig.base.json` (strict, ES2022 target, NodeNext module)
   - Create `turbo.json` (pipeline: `build` → `test` → `typecheck`)
   - Create `vitest.workspace.ts`
   - Create `.nvmrc` (`18`)
   - Create `.gitignore`
   - Run `pnpm install` — must succeed

2. **`packages/shared`** (AT-01)
   - Read `docs/implementation/001-Task-Breakdown.md §8.2` (BI-01.1 through BI-01.5)
   - Read `docs/architecture/003-Requirements.md`, `004-Terminology.md`, `005-Glossary.md`
   - Read `docs/design/1000-Diagnostics-Overview.md` (error taxonomy)
   - Implement: all DTOs, config schema types, error hierarchy
   - Write unit tests for error-to-diagnostic conversion
   - Verify: `pnpm --filter shared build` exits 0, no Node/DOM imports in `src/`

3. **`packages/browser`** (AT-02) — can scaffold in parallel with step 2 once shared DTOs are stubbed
   - Read `docs/tasks/001-Implement-Browser-Pool.md` (primary task card)
   - Read `docs/design/100–106` (all 7 browser layer design docs)
   - Read `docs/adr/ADR-0001-Browser-Is-Source-of-Truth.md`, `ADR-0003-Playwright-As-Browser-Abstraction.md`
   - Implement: `BrowserManager`, `NavigationEngine`, `ViewportManager`, `DOMSnapshot`
   - Create `fixtures/` with 3 HTML test fixtures (static, async-content, mobile-layout)
   - Write integration tests: navigate 3 fixtures, assert no resource leak, mobile viewport applied, stabilization reports stable
   - Verify: `pnpm --filter browser test` exits 0

4. **M0 exit criteria check** (see `IMPLEMENTATION_PLAN.md §M0` — all 6 must pass)
5. **Update this file** (`IMPL_STATUS.md`) before ending the session

---

## Milestone Progress

### M0 — Foundation

| Item | Status | Notes |
|---|---|---|
| Monorepo scaffold (root config files) | Not started | |
| `packages/shared` scaffold (BI-01.1) | Not started | |
| `packages/shared` DTOs (BI-01.2) | Not started | |
| `packages/shared` error hierarchy (BI-01.3) | Not started | |
| `packages/shared` unit tests (BI-01.4) | Not started | |
| `packages/browser` scaffold (BI-02.1) | Not started | |
| `packages/browser` BrowserManager + pool (BI-02.2) | Not started | |
| `packages/browser` NavigationEngine + stabilization (BI-02.3) | Not started | |
| `packages/browser` ViewportManager (BI-02.4) | Not started | |
| `packages/browser` DOMSnapshot / PageHandle (BI-02.5) | Not started | |
| `packages/browser` integration tests + fixtures (BI-02.6) | Not started | |
| **M0 exit criteria: all 6 pass** | Not started | |

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

---

## Known Blockers / Issues

*None currently.*

---

## Update Protocol

When updating this file, change:
1. **Current State** table — `Active milestone`, `Active package`, `Active task`, `Last session`, `Next action`
2. The relevant **Milestone Progress** table row(s) — change `Not started` → `In progress` → `Complete`
3. Add a row to **Session Log**
4. Add any blockers to **Known Blockers / Issues**
