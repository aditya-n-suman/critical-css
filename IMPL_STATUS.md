# Implementation Status

> This file is the single source of truth for implementation progress.
> Every agent session **must** read this file first and **must** update it before ending.
> Do not update this file mid-task — only update at session boundaries.

---

## Current State

| Field | Value |
|---|---|
| Active milestone | **M3 — Multi-Device, Coverage, Hybrid** |
| Active package | **Not started** |
| Active task | **Not started — begin with `packages/coverage` (AT-05) / `packages/reporter` (docs/tasks/009)** |
| Last session | 2026-07-12 (M2 complete: dependency-graph, visibility engine, serializer full, plugins, M1 deferrals) |
| Next action | See "What to do next" below |

---

## What to Do Next

**Start M3 — Multi-Device, Coverage, Hybrid.** (M0–M2 are complete.)

Per `AGENT_IMPL_BRIEF.md §Phase M3` and `docs/implementation/001-Task-Breakdown.md §8.7, 8.9`:

1. **`packages/coverage`** (AT-05) — CDP Coverage domain; depends ONLY on browser/shared (NEVER matcher — hard rule 3). Read `docs/design/700`, `docs/adr/ADR-0005`
2. **Hybrid mode composer** inside `packages/dependency-graph` — `docs/design/701–702`
3. **`packages/reporter`** (AT-10) — `docs/tasks/009-Implement-Reporter.md`, `docs/design/1000–1005`
4. **Multi-viewport merge** — independent per-profile extraction + merge (016 §10.1)
5. **Backfill G4 visual-diff harness** (`docs/testing/002`) and the M2 G7-review deferred items in Known Blockers
6. M3 accuracy refinements for the M2 resolver: browser-probe candidate filtering (501 §8.2), `getKeyframes()` probe (502), `document.fonts` load state (503)

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
| `packages/dependency-graph` | Complete | FixedPointResolver (waves, budget), 3-color DFS cycle detection, LayerOrderRegistry; 11 unit tests. Browser-probe accuracy refinements → M3 |
| `packages/serializer` (full) | Complete | Layer prelude, dependency emission (INV-2 validated), reference dedup (602 L1), conservative minify (603 safe subset), inline-style/json-envelope formats (606); source maps deferred per 605 (opt-in tier) |
| `packages/plugins` | Complete | 6-hook dispatcher (order, timeout, isolation, frozen contexts), validated registry, 5 reference plugins; 8 tests |
| `packages/collector` Visibility Engine | Complete | Pure host-side 7-term predicate (200 §7.1): clip-chain tree DP, sticky/fixed always-critical, transform opt-in; whole-tree snapshot + extended style allow-list; 12 unit tests |
| M1 deferrals closed | Complete | @import recursion (306, cycle-guarded), adoptedStyleSheets walk (307), media/supports activity annotation (303/304), structured `AtRuleCondition` chain, `@layer` prelude emission |
| **M2 exit criteria: all 5 pass** | Complete | e2e: deps fixture (vars/keyframes/fonts/@property/@counter-style + cycle diagnostic), layout fixture (sticky/fixed/clip/below-fold), plugins isolated, goldens still byte-exact |

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
| 2026-07-12 | Implementation agent | M2 complete: Visibility Engine (host-side 7-term predicate + whole-tree snapshot), `packages/dependency-graph` (FixedPointResolver, cycle detection, layer registry), `packages/plugins` (6-hook dispatcher + 5 reference plugins), serializer full (layer prelude, dedup L1, minify, formats, INV-2 validation), M1 deferrals closed (@import/adopted walks, condition activity, structured chains). New fixtures `deps` + `layout`. 143 tests green; goldens unchanged. G7 review pass run over M2 diff | M0–M2 Complete; M3 not started |

---

## Known Blockers / Issues

- **M2 G7 review — deferred finding (nested `@layer` conflation):** `buildLayerOrderRegistry` walks the flat rule list, so a nested `@layer base { @layer sub {…} }` registers `sub` as a top-level layer, potentially conflating it with an unrelated top-level `sub` and corrupting the emitted `@layer` prelude order. Fix in M3 alongside 305's full scopePath model (`base.sub` dotted paths). Fixed in the same review pass: font-face bare-declaration emission, lexicographic path ordering in last/first-wins, duplicate-cssText INV-2 false positive, fixed-position clip escape, CSS-nesting silent drop, forceInclude wrapper-chain/disabled-sheet handling, list-style counter-style refs, non-ASCII custom-property names, foldMarginPx in matchableNodeIds.
- **CSS nesting (M3):** nested style-rule children are now walked and their raw `&`-selectors surface as `UNSUPPORTED_SELECTOR` diagnostics — loud, but not yet resolved to matchable selectors (needs 302's nesting-resolution treatment).
- **G4 (visual regression) infrastructure not yet built (M1):** `docs/testing/002-Visual-Tests.md` tooling does not exist yet; M1 exit criterion 2 (rendering parity via pixel diff) is currently covered indirectly by browser-truth matching + golden byte-exactness. Build the visual-diff harness in M2 and backfill the three M1 fixtures.
- **M1 scope stubs (by design, per task cards):** `@media`/`@supports` conditions are captured verbatim and re-emitted as wrappers, not evaluated (303/304 → M2); `@layer` rank resolution deferred (305 → M2, `MergedRule.layerOrder` currently always `null` from the CLI); `origin` hardcoded `'author'` pending Cascade Resolver (AT-06); dependency manifest empty pending `packages/dependency-graph`.
- **G7 review deferred findings (2026-07-12 adversarial pass; fixed findings landed in the M1 commits):**
  - `@layer` statement name order is now *captured* (`RuleNode.conditionText` on `layer-statement` rules) but the LayerOrderRegistry + serializer `@layer` prelude emission (601 §8.4) are M2 — layered pages can invert cascade order until then.
  - `NavigationEngine` maps every `goto` failure (DNS/refused/SSL/timeout) to `NavigationTimeoutError` per the brief's M0/M1 contract; 103's full `NavigationError` subtype taxonomy is M2. True cause preserved in `cause`.
  - `CssomRuleMatch.atRuleChain` carries pre-rendered `@media …` strings; M2 should switch to structured `{kind, conditionText}` records before 303 media evaluation / 602 dedup need bare condition text.
  - `CollectorDiagnosticRecord` should unify with shared `Diagnostic` when the Reporter (AT-10) lands.
  - `@import` (306) and `adoptedStyleSheets` (307) walks are deferred but now surface loud `IMPORT_RULE_DEFERRED` / `ADOPTED_STYLESHEETS_DEFERRED` diagnostics instead of silent drops.
  - Stabilization polling is one evaluate per ~40ms tick; consider `page.waitForFunction` (single protocol op) in M2 perf work.
- ~~**Doc divergences (RESOLVED 2026-07-12):**~~ the three brief-vs-design divergences flagged during M0 are closed: (1) `AGENT_IMPL_BRIEF.md`'s `turbo.json` sample corrected to Turbo 2.x `"tasks"`; (2) built-in viewport profiles aligned to `docs/design/105 §8.1` in both code (`BUILT_IN_PROFILES`: desktop 1920×1080/DPR 1, tablet 768×1024/DPR 2, mobile 375×667/DPR 2) and the brief — golden files verified byte-identical under the canonical profiles; (3) the brief's `ViewportProfile` entry now documents it as 105's `DeviceProfile` fields flattened + `foldOffset`, with the `viewportProfileId` wrapper explicitly deferred to M3. `docs/` untouched (Hard Rule 6).

---

## Update Protocol

When updating this file, change:
1. **Current State** table — `Active milestone`, `Active package`, `Active task`, `Last session`, `Next action`
2. The relevant **Milestone Progress** table row(s) — change `Not started` → `In progress` → `Complete`
3. Add a row to **Session Log**
4. Add any blockers to **Known Blockers / Issues**
