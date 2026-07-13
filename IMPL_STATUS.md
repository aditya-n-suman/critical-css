# Implementation Status

> This file is the single source of truth for implementation progress.
> Every agent session **must** read this file first and **must** update it before ending.
> Do not update this file mid-task — only update at session boundaries.

---

## Current State

| Field | Value |
|---|---|
| Active milestone | **M4 — CI, Route Manifest, Cache** |
| Active package | **Not started** |
| Active task | **Not started — begin with `packages/cache` (AT-08, docs/tasks/007)** |
| Last session | 2026-07-13 (out-of-band fix: CLI `--sandbox-policy` flag) |
| Next action | See "What to do next" below |

---

## What to Do Next

**Start M4 — CI, Route Manifest, Incremental Cache.** (M0–M3 are complete.)

Per `AGENT_IMPL_BRIEF.md §Phase M4` and `docs/implementation/001-Task-Breakdown.md §8.11`:

1. **`packages/cache`** (AT-08 full) — read `docs/tasks/007-Implement-Cache-Manager.md`, `docs/design/800–806`. `CacheFingerprint` DTO + `computeCacheFingerprint` already exist in `@critical-css/shared`; add the store backends, route/viewport caches, invalidation.
2. **`apps/cli` full** — route manifest expansion, `--compare-baseline` (fail build on CSS growth), CI flags.
3. Also open (carry-over, not blocking M4):
   - G4 visual-diff harness (`docs/testing/002`) still not built.
   - M3 coverage byte-mapping is an approximation (see Known Blockers) — deeper `RuleTree` byte-offset model conflicts with ADR-0002; raise with project owner.
   - M2 nested-`@layer` scopePath model; M3 resolver browser-probe accuracy refinements (501 §8.2 / 502 / 503).

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
| `packages/coverage` (AT-05) | Complete | CDP coverage via `PageHandle.startCoverage()`; used/unused rule-key mapping; depends only on browser+shared (no matcher/collector); 2 integration tests |
| Hybrid mode (in dependency-graph) | Complete | `reconcileHybrid` strong/provisional-include/provisional-exclude set algebra + fidelity bias + `coverageOnlyRules`; 4 unit tests |
| Multi-viewport merge | Complete | `mergeViewports` (serializer): matched-in-all → unconditional, subset → synthetic width-band `@media`; single-viewport is byte-identical to prior path (goldens hold); 11 unit tests |
| `packages/reporter` (AT-10) | Complete | 4 reports (matched/unmatched/timing/stylesheet-contribution) + dependency-graph JSON (REQ-460); pure sink; 6 unit tests |
| `apps/playground` | Deferred | Not an M3 exit criterion; looser scope per plan, deferred |
| **M3 exit criteria: all 5 pass** | Complete | e2e: multi-viewport merge, coverage-only, hybrid reconcile, reporter reports — all against real Chromium; G7 review pass run |

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
| 2026-07-13 | Implementation agent | M3 complete: `packages/coverage` (AT-05, CDP via browser abstraction), hybrid composer + `coverageOnlyRules` in dependency-graph, multi-viewport `mergeViewports` in serializer (synthetic width-bands), `packages/reporter` (AT-10, 4 reports + dep-graph JSON). Browser gains `PageHandle.startCoverage()`. CLI gains `--mode`/`--viewports`/`--report`. New fixture `coverage`. All 20 turbo tasks green; goldens byte-identical; typecheck clean. G7 review pass run over M3 diff | M0–M3 Complete; M4 not started |
| 2026-07-13 | Implementation agent (out-of-band) | Fixed `BROWSER_ACQUISITION_FAILED` on hosts where Chromium's default (`full`) sandbox can't initialize: `apps/cli` hardcoded `new BrowserManager({ maxConcurrency: 1 })` with no way to request `@critical-css/browser`'s existing `sandboxPolicy` (`'full'\|'ci-container'\|'unsafe-no-sandbox'`, 101 §8.8). Added `ExtractRequest.sandboxPolicy` (`apps/cli/src/extract.ts`) threaded into `BrowserManager`, plus CLI surface in `apps/cli/src/main.ts`: `--sandbox-policy full\|ci-container\|unsafe-no-sandbox` flag (validated), falling back to `CRITICAL_CSS_SANDBOX_POLICY` env var, defaulting to `'full'` — no auto-detection, per 101 §8.8's explicit-opt-in requirement. Follow-up: the CLI's error handler (`main.ts` catch block) only printed the outer `ExtractionError` message and silently dropped `err.cause`, so the sandbox theory couldn't be distinguished from other launch failures — added a `caused by:` chain walk (Design Principle 6, Fail-Fast Diagnostics) that surfaces the full wrapped-error chain. That chain is what revealed the actual root cause on this host: not sandboxing at all, but a Playwright/Chromium version mismatch (`pnpm-lock.yaml` resolved `playwright@1.61.1`, expecting Chromium build 1228; only build 1217 was cached) — fixed by re-running `playwright install chromium`, no code change needed for that part. Verified end-to-end: `extract --url <live shiksha URL> --viewport mobile --mode cssom --minify` now exits 0 and produces valid CSS output. No `docs/` changes (Hard Rule 6) — none of this changes documented behavior, just exposes an already-specified option and un-swallows an already-specified error field. `pnpm build`/`pnpm typecheck` green across all 10 packages | M0–M3 Complete; M4 not started |
| 2026-07-13 | Implementation agent (out-of-band) | Two more CLI improvements, requested ahead of the M4 "full CLI" milestone item (BI-11 in `001-Task-Breakdown.md`, currently blocked on cache — see "What to Do Next"): (1) **Diagnostic `source.url` was silently dropped on stderr.** `SelectorMatcher.matchRules` (`packages/matcher/src/matcher.ts:124-148`) already attaches `source: { url: d.href }` to `CROSS_ORIGIN_STYLESHEET_SKIPPED`/other per-sheet diagnostics, but `apps/cli/src/main.ts`'s success-path diagnostic loop only printed `severity`/`code`/`message` — the one piece of information (which stylesheet/hostname) needed to act on the diagnostic never reached the user. Now appends ` (url)` when `diagnostic.source.url` is present. This is what let us identify, for the live shiksha.com URL used to verify this session's fixes, that all `CROSS_ORIGIN_STYLESHEET_SKIPPED` warnings point at a single first-party host (`js.shiksha.ws`, `/pwa/public/js/*.css`) — not an engine bug: `docs/design/300-CSSOM-Walker.md` §8.3 explains `cssRules` throws `SecurityError` per-spec for cross-origin sheets without CORS, and §15 (Future Work) explicitly reserves a CDP-based bypass for third-party origins as a separate, ADR-gated feature — not applicable here since the operator (project owner) controls this host; the actual fix is server-side (`Access-Control-Allow-Origin` + `crossorigin` attribute on the `<link>`), out of this repo's scope. (2) **Config file support** (`010-System-Overview.md` §8.1's "Configuration Loader", `011-Implement-CLI.md` — previously spec'd only, zero code, confirmed by repo-wide grep). Added `apps/cli/src/config.ts`: `loadConfigFile(path)` reads/validates a JSON file field-by-field against the same flag vocabulary (`url`, `viewport`/`viewports`, `mode`, `output`, `report`, `minify`, `format`, `sandboxPolicy`), rejecting unknown keys or wrong types as a usage error (exit `2`) before any browser launches, per 010 §8.1's "validate before launch." Wired into `main.ts` as `--config <path>` via a two-pass parse (first pass locates `--config` anywhere in argv, second pass applies CLI flags on top) — precedence CLI flag > config file > `CRITICAL_CSS_SANDBOX_POLICY` env var (sandboxPolicy only) > built-in default. Kept inside `apps/cli` (not a new `packages/config`) per `007-Repository-Structure.md`'s promotion-only-on-second-consumer guidance; no auto-discovery/rc-file convention added since no design doc specifies one (Hard Rule 1). No `docs/` changes (Hard Rule 6). `pnpm build`/`pnpm typecheck` green across all 10 packages; manually verified config load/validation/override and a real extraction via `--config`. Note: `apps/cli` test suite has one pre-existing intermittent flake unrelated to this session's changes — `golden::async::desktop matches byte-for-byte` (`test/extract.e2e.test.ts`) fails ~1-in-3 runs even on a clean `git stash` revert to the pre-session state (confirmed by re-running 3× before and after); likely a stabilization-window race in the `async` fixture, not yet root-caused — flagged below under Known Blockers | M0–M3 Complete; M4 not started |

---

## Known Blockers / Issues

- **Intermittent flake in `apps/cli` test suite (found 2026-07-13, not yet root-caused):** `test/extract.e2e.test.ts`'s `golden::async::desktop matches byte-for-byte` fails roughly 1-in-3 runs, missing the `.late` rule that the `async` fixture injects post-load. Reproduces on a clean revert (pre-session `git stash`, no code changes from this session involved), so it's a pre-existing race, most likely in the stabilization window's post-load quiescence detection for that fixture, not this session's CLI changes. Needs investigation before M4 (a CI gate on top of a flaky golden test is not viable).

- **M3 coverage byte-mapping is an approximation, and the design docs' resolution conflicts with ADR-0002 (raise with project owner):** `docs/design/700` §10.3 maps CDP used-byte-ranges to rules via a "RuleTree with rule-boundary bookkeeping" — but obtaining per-rule source byte offsets requires either offsets the CSSOM does not expose, or parsing the raw stylesheet text (a CSS parser, forbidden by ADR-0002). M3 instead locates each rule's verbatim `selectorText` in the coverage source text (string search, ADR-0002-safe) and tests range membership — approximate for whitespace-divergent/minified/duplicated selectors. This is **safe in hybrid mode** (coverage only upgrades/flags, never drops a CSSOM match — 701 fidelity bias) but affects **coverage-only** precision. Needs a design decision: expose source offsets from the browser layer, or accept the selector-search approximation as canonical.
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
