# Implementation Status

> This file is the single source of truth for implementation progress.
> Every agent session **must** read this file first and **must** update it before ending.
> Do not update this file mid-task — only update at session boundaries.

---

## Current State

| Field | Value |
|---|---|
| Active milestone | **M2 — Dependency Graph, Media/Layer, Plugins** |
| Active package | **Not started** |
| Active task | **Not started — begin with `packages/dependency-graph` (docs/tasks/004) or parallel-eligible `packages/plugins` (docs/tasks/008)** |
| Last session | 2026-07-12 (M1 complete: collector + matcher + serializer basic + CLI MVP + golden baseline) |
| Next action | See "What to do next" below |

---

## What to Do Next

**Start M2 — Dependency Graph, Media/Layer, Plugins.** (M0 and M1 are complete.)

Per `AGENT_IMPL_BRIEF.md §Phase M2` and `docs/implementation/001-Task-Breakdown.md §8.6–8.8, 8.10`:

1. **`packages/dependency-graph`** (AT-06) — read `docs/tasks/004-Implement-Dependency-Resolver.md`, `docs/design/500`, `docs/algorithms/501–508`
2. **`packages/serializer` full** (AT-07) — dedup, compression, source maps, output formats (`docs/design/602–606`)
3. **`packages/plugins`** (AT-09, parallel-eligible) — `docs/tasks/008-Implement-Plugin-System.md`, `docs/plugins/000–004`
4. **`packages/collector` Visibility Engine** (AT-03 partial) — `docs/tasks/005-Implement-Visibility-Engine.md`, `docs/design/200–207`
5. Also address the M1 deferred items in Known Blockers (visual-diff infra, @media/@supports evaluation semantics, layer ordering)

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
| `packages/collector` CSSOM Walker + DOM Collector | Complete | In-page walk, nested @media/@supports/@layer paths, cross-origin diagnostic; 6 integration tests |
| `packages/matcher` | Complete | `element.matches()`-only; comma-branch tracking, pseudo-element base extraction, dynamic pseudo-class diagnostics; 18 tests |
| `packages/serializer` (basic) | Complete | Canonical ordering (601), wrapper reconstruction, pinned pretty renderer (LF, 2-space, trailing \n); 11 tests |
| `apps/cli` (MVP — single URL → stdout CSS) | Complete | `extract --url [--viewport] [--output]`; CSS→stdout, diagnostics→stderr; exit 0/1/2 |
| Golden CSS snapshot baseline created | Complete | `fixtures/golden/{static,async,mobile}.css`, `-text` in `.gitattributes`, byte-exact tests |
| **M1 exit criteria: all 6 pass** | Complete | See session log; G4 visual-diff infra deferred (see Known Blockers) |

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
| 2026-07-12 | Implementation agent | M1 complete: `packages/collector` (CSSOM Walker + DOM Collector, snapshotId correlation), `packages/matcher` (`element.matches()`-only, batched in-page, branch/pseudo bookkeeping per 402/403), `packages/serializer` basic (601 ordering + wrapper reconstruction + pinned pretty output), `apps/cli` MVP (`extract` command), golden baseline generated via CLI and locked byte-exact (`.gitattributes -text`). Adversarial review pass (G7) run over the M1 diff | M0+M1 Complete; M2 not started |

---

## Known Blockers / Issues

- **G4 (visual regression) infrastructure not yet built (M1):** `docs/testing/002-Visual-Tests.md` tooling does not exist yet; M1 exit criterion 2 (rendering parity via pixel diff) is currently covered indirectly by browser-truth matching + golden byte-exactness. Build the visual-diff harness in M2 and backfill the three M1 fixtures.
- **M1 scope stubs (by design, per task cards):** `@media`/`@supports` conditions are captured verbatim and re-emitted as wrappers, not evaluated (303/304 → M2); `@layer` rank resolution deferred (305 → M2, `MergedRule.layerOrder` currently always `null` from the CLI); `origin` hardcoded `'author'` pending Cascade Resolver (AT-06); dependency manifest empty pending `packages/dependency-graph`.
- **G7 review deferred findings (2026-07-12 adversarial pass; fixed findings landed in the M1 commits):**
  - `@layer` statement name order is now *captured* (`RuleNode.conditionText` on `layer-statement` rules) but the LayerOrderRegistry + serializer `@layer` prelude emission (601 §8.4) are M2 — layered pages can invert cascade order until then.
  - `NavigationEngine` maps every `goto` failure (DNS/refused/SSL/timeout) to `NavigationTimeoutError` per the brief's M0/M1 contract; 103's full `NavigationError` subtype taxonomy is M2. True cause preserved in `cause`.
  - `CssomRuleMatch.atRuleChain` carries pre-rendered `@media …` strings; M2 should switch to structured `{kind, conditionText}` records before 303 media evaluation / 602 dedup need bare condition text.
  - `CollectorDiagnosticRecord` should unify with shared `Diagnostic` when the Reporter (AT-10) lands.
  - `@import` (306) and `adoptedStyleSheets` (307) walks are deferred but now surface loud `IMPORT_RULE_DEFERRED` / `ADOPTED_STYLESHEETS_DEFERRED` diagnostics instead of silent drops.
  - Stabilization polling is one evaluate per ~40ms tick; consider `page.waitForFunction` (single protocol op) in M2 perf work.
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
