# 704 — Incremental Extraction

## 1. Title

**Critical CSS Extraction Engine — Incremental Extraction: Skip, Partial, and Full Re-Extraction as an Advanced Strategy**

## 2. Version

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | Draft — Phase 9 (Advanced Extraction) |
| Last Updated | 2026-07-09 |
| Owners | Core Architecture Working Group |
| Stability | Strategy contract (skip / partial / full decision surface) is stable; the storage mechanism it depends on is defined separately in Phase 10 ([../design/800-Cache-Overview.md](../design/800-Cache-Overview.md), [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md)) and may evolve without invalidating this document's decision model |

## 3. Purpose

This document specifies **incremental extraction**: the strategy by which the Engine does *less work* on a run when it can prove, from the inputs alone, that some or all of the output it would produce is byte-identical to output it has already produced. Incremental extraction has two distinct modes beyond the naive "run everything every time" baseline:

1. **Skip** — when *nothing* that could affect a given `(route, viewport-set, mode)` output has changed, the entire extraction chain (navigation, DOM snapshot, CSSOM walk, matching, dependency resolution, cascade, merge, serialize, minify — see [016-Data-Flow.md](../architecture/016-Data-Flow.md)) is bypassed and the previously produced artifact is emitted unchanged.
2. **Partial** — when *some but not all* inputs changed, only the affected sub-work is re-executed and the unaffected sub-work is reused. Two concrete shapes of partial re-extraction are in scope: (a) one stylesheet among many was edited, so only rules originating in that stylesheet (and the dependency/cascade closure they participate in) are re-resolved; and (b) one route among many in the manifest changed, so only that route is re-extracted while sibling routes are skipped wholesale.

The central discipline of this document is the distinction between **the strategy** (deciding to do less work, and doing it correctly) and **the storage mechanism** (persisting fingerprints and prior artifacts so that "unchanged" can be established and prior output retrieved). This document owns the former. The latter — the Cache Manager module (BRIEF.md Section 2.4) — is specified in Phase 10 and is referenced here strictly as a forward dependency: [../design/800-Cache-Overview.md](../design/800-Cache-Overview.md) for the storage model and eviction/invalidation policy, and [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md) for the exact fingerprint computation. Where this document says "look up the fingerprint" or "the prior artifact is retrieved," it is invoking that mechanism as a black box with a defined contract; it deliberately does not re-specify how fingerprints are hashed, keyed, or stored.

The second discipline of this document is **correctness before speed**. Incremental extraction is an optimization, and per Design Principle 3 (Correctness over Premature Optimization, [006-Design-Principles.md](../architecture/006-Design-Principles.md)) an optimization that can ship stale CSS is worse than no optimization at all — a stale critical-CSS payload produces a visible above-the-fold rendering regression that is both severe and hard to attribute. Section 8.4 and Section 12 therefore define the guardrails under which the Engine is *permitted* to skip work, and the fail-closed default it takes whenever those guardrails cannot be satisfied.

## 4. Audience

- Implementers of `apps/cli`'s orchestration layer, who decide, per route and per viewport, whether to invoke the full pipeline or short-circuit it.
- Implementers of `packages/cache` (Phase 10), who must expose a lookup/store contract shaped to support the decision model here without this document dictating their internal storage design.
- Performance engineers reasoning about the wall-clock and CI-cost benefit of incremental runs versus the correctness risk they introduce.
- Authors of the sibling Phase 9 strategy documents ([700-Coverage-Mode.md](./700-Coverage-Mode.md), [701-Hybrid-Mode.md](./701-Hybrid-Mode.md), [702-Computed-Style-Mode.md](./702-Computed-Style-Mode.md), [703-Visual-Diff.md](./703-Visual-Diff.md)), who need to understand how their strategy's output participates in — and constrains — the fingerprint that gates a skip decision.
- Autonomous coding agents implementing the skip/partial/full decision, who need the decision surface, its inputs, and its fail-closed default nailed down before writing orchestration code.

This is a senior-engineer RFC. It assumes the reader understands the end-to-end data flow and does not re-derive it.

## 5. Prerequisites

- [016-Data-Flow.md](../architecture/016-Data-Flow.md), in full — this document reasons about *which stages of that data flow can be skipped or partially re-run*, and reuses its stage numbering (Stage 8.1 Live Page … Stage 8.11 Minified Output, Stage 8.12 Cached Artifact) throughout.
- BRIEF.md Section 2.8 (Incremental Cache): the fingerprint inputs (HTML, CSS assets, viewport, extraction mode) and the reuse rule (reuse previous extraction when fingerprints match). This document operationalizes that one-paragraph brief into a full skip/partial/full strategy.
- BRIEF.md Section 2.4 (System Modules): the module responsibility table, in particular the separation between the Cache Manager (fingerprinting, route cache, invalidation) and every other module. Incremental extraction is a cross-cutting *orchestration* concern that consumes the Cache Manager, it is not itself a module in that table.
- Design Principle 3 (Correctness over Premature Optimization), Principle 5 (Determinism of Output), and Principle 6 (Fail-Fast Diagnostics) from [006-Design-Principles.md](../architecture/006-Design-Principles.md). Determinism is load-bearing: incremental extraction is only *sound* because a given input fingerprint deterministically maps to byte-identical output, so a fingerprint match is a valid proof of output equality.
- Awareness that the fingerprint computation itself is **not** defined here — it is defined in [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md) (Phase 10). This document treats `fingerprint(inputs) -> digest` as a pure, deterministic, collision-resistant black box.

## 6. Related Documents

- [016-Data-Flow.md](../architecture/016-Data-Flow.md) — the transformation chain this document decides to skip, partially re-run, or fully run; its Section 16 explicitly flags incremental extraction (REQ-704) as future work whose data shapes it was designed to accommodate (`contributingViewports`, `perViewportRetained`, stable join keys). This document is the realization of that flag.
- [700-Coverage-Mode.md](./700-Coverage-Mode.md) — Coverage-mode output feeds the fingerprint; runtime-observed coverage introduces a determinism caveat (Section 12) that constrains when a Coverage-mode run may be skipped.
- [701-Hybrid-Mode.md](./701-Hybrid-Mode.md) — Hybrid mode's three-way strategy combination is itself part of the "extraction mode" fingerprint input per BRIEF.md Section 2.8; changing mode invalidates a skip.
- [702-Computed-Style-Mode.md](./702-Computed-Style-Mode.md) — computed-style verification is a mode variant that participates in the mode fingerprint identically to the above.
- [703-Visual-Diff.md](./703-Visual-Diff.md) — visual diffing is the independent correctness oracle that validates a *full* extraction; Section 15 describes how it is used to periodically audit that skip decisions have not silently drifted.
- [../design/800-Cache-Overview.md](../design/800-Cache-Overview.md) (Phase 10) — the storage mechanism: how prior artifacts and fingerprints are persisted, keyed, evicted, and invalidated. Forward reference; not yet written.
- [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md) (Phase 10) — the exact fingerprint computation this document consumes as a black box. Forward reference; not yet written.
- BRIEF.md Section 2.8 (Incremental Cache) and Section 2.4 (System Modules) — the authoritative source for the fingerprint inputs and the module boundary this document respects.

## 7. Overview

The naive Engine runs the full [016-Data-Flow.md](../architecture/016-Data-Flow.md) chain for every `(route, viewport, mode)` tuple on every invocation. In a CI setting where a developer changed one component's styles and re-runs extraction across a 200-route manifest, this is enormously wasteful: 199 routes and, within the changed route, most of its stylesheets and DOM, are byte-for-byte identical to the previous run and will produce byte-identical CSS. Incremental extraction converts that waste into skipped work.

The strategy operates at two granularities, and the decision is made in a fixed order — coarsest first, because a coarse skip subsumes all finer work:

1. **Per-route skip (coarsest).** Before touching a browser, the orchestrator computes (or retrieves) the fingerprint for a route's `(HTML, CSS assets, viewport-set, mode)` per BRIEF.md Section 2.8. If it matches the fingerprint stored alongside a prior artifact, the *entire* chain for that route is skipped and the prior artifact is emitted. This is the highest-value case: it short-circuits before Stage 8.1 (Live Page acquisition), saving a full browser navigation, which [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 14 identifies as the dominant latency term.
2. **Partial re-extraction (finer).** When the route-level fingerprint does *not* match, the orchestrator asks: *is the mismatch total, or localized?* If sub-fingerprints (per-stylesheet, per-viewport) reveal that only a subset of inputs changed, only the affected sub-work is re-run and the rest is reused from the prior run's retained intermediates. Two concrete shapes:
   - *One stylesheet edited among many:* re-resolve only the rules originating in the changed stylesheet plus the dependency/cascade closure they touch; reuse matched rules from unchanged stylesheets verbatim.
   - *One route changed among many:* trivially reduces to per-route skip for all sibling routes plus a full (or itself-partial) re-extraction of the one changed route.
3. **Full re-extraction (fallback).** When nothing can be proven reusable — first run, cache miss with no usable prior intermediates, a mode change, a fingerprint-algorithm version bump, or *any* guardrail failure (Section 8.4) — the full chain runs. This is the correctness-preserving default: when in doubt, do the work.

The remainder of this document defines the decision surface precisely (Section 8), diagrams it (Section 9), gives the decision and partial-resolution algorithms with complexity (Section 10), and — most importantly — defines the guardrails (Section 8.4, Section 12) that make "skip" safe. A recurring theme: incremental extraction is *permitted to be wrong only in the direction of doing too much work*, never in the direction of shipping stale output.

## 8. Detailed Design

### 8.1 The Decision Inputs

The skip/partial/full decision consumes exactly these inputs, and no others (any input that can affect output but is not fingerprinted is a correctness hole — see Section 12):

- **Route fingerprint** — `fingerprint(HTML, CSS-assets, viewport-set, mode)` for the route, computed per [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md). Per BRIEF.md Section 2.8 these four are the canonical inputs. This document adds one more that BRIEF.md's one-liner leaves implicit but that correctness demands: the **Engine version / fingerprint-algorithm version**, because a change to how the Engine extracts (a bug fix in the Visibility Engine, say) changes output for unchanged inputs, and a stale skip would hide the fix. This is folded into the mode/version component of the fingerprint, per Section 8.4.
- **Prior artifact + its stored fingerprint** — retrieved from the Cache Manager (Phase 10, black box). Absent (cache miss) ⇒ no skip possible ⇒ full.
- **Sub-fingerprints**, when available: a per-stylesheet fingerprint of each CSS asset, and a per-viewport fingerprint of each viewport-scoped result. These enable partial re-extraction; their absence (e.g., an older cache entry that only stored the coarse route fingerprint) degrades gracefully to full re-extraction, never to an unsound skip.
- **Retained intermediates**, when available: the prior run's per-viewport `CascadedRuleSet`s and per-stylesheet matched-rule partitions (see [016-Data-Flow.md](../architecture/016-Data-Flow.md) Sections 8.5–8.7 and 9.3's `perViewportRetained`). These are what partial re-extraction reuses. Their absence forces full re-extraction of the changed portion (but sibling-route skips still apply).

### 8.2 Skip: Full-Route Reuse

A skip fires when: the route fingerprint is present, the stored fingerprint for the same `(route, bundleId)` is present, they are equal, and the guardrails of Section 8.4 all pass. On a skip:

- The orchestrator emits the prior `CacheEntry.css` (the shape defined in [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 10.2) unchanged, threaded to the same `bundleId`.
- No browser is launched for this route. This is the critical property: the skip must short-circuit **before Stage 8.1**, not merely before serialization, to realize the full benefit ([016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 14 makes the same point about cache-hit replay).
- A `RouteSkipped` diagnostic is recorded (Principle 6), carrying the matched fingerprint digest so the reason for the skip is auditable. Skips are never silent — a run that skips 199 of 200 routes must say so, so an operator can distinguish "correctly skipped, nothing changed" from "erroneously skipped, cache is stale."

Because output is deterministic (Principle 5), the emitted artifact is provably byte-identical to what a full re-run would produce **given the fingerprint captures every output-affecting input**. That proviso is the entire correctness burden, discharged in Section 8.4.

### 8.3 Partial Re-Extraction

When the route fingerprint mismatches but sub-fingerprints localize the change, partial re-extraction re-runs only the affected sub-work. This document defines two localizations; the design generalizes to others but these two are the ones BRIEF.md's inputs directly support.

**8.3.1 Stylesheet-localized partial re-extraction.** The route's CSS assets are individually fingerprinted. When exactly the set `Δ` of stylesheets changed (the rest matching prior sub-fingerprints), the Engine still must navigate and snapshot the DOM (because HTML matched, the DOM snapshot could be reused *only if* HTML fingerprint matched — and here it did, so DOM snapshot and visibility annotations are reusable from retained intermediates if present; if HTML also changed, this is not a stylesheet-localized case, it is full). Given a reusable visibility-annotated node set:

- Matched rules originating in stylesheets *not* in `Δ` are reused verbatim from the prior `MatchedRuleSet` partitions (keyed by `stylesheetIndex`, [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 8.5).
- Matched rules for stylesheets in `Δ` are recomputed by re-running Selector Matching for those stylesheets' rules only.
- **The dependency and cascade closure is re-resolved, not reused**, because a changed stylesheet can add/remove a `var()` reference, a `@keyframes` name, a `@layer` declaration, or a specificity-affecting selector that shifts cascade order for rules in *unchanged* stylesheets. Cascade is a whole-document property (Principle 1: browser is source of truth for layer order and specificity). Reusing the closure across a stylesheet edit is exactly the kind of "clever" reuse that silently ships wrong cascade order; it is prohibited. The closure re-resolution is cheap relative to matching, so this is a good trade (Section 14).

**8.3.2 Route-localized partial re-extraction.** Across a manifest, each route is fingerprinted independently. A change to one route's HTML or a route-specific stylesheet leaves sibling routes' fingerprints untouched. The orchestrator therefore skips every sibling route per Section 8.2 and re-extracts only the changed route (which may itself be stylesheet-localized partial, per 8.3.1, or full). This is the highest-frequency real-world case: a developer edits one page.

**8.3.3 Viewport-localized partial re-extraction.** A corollary enabled by [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 9.3's per-viewport provenance: if only one viewport profile's inputs changed (rare, but possible with viewport-conditional CSS-in-JS), only that viewport branch is re-run and the merge (Section 9.3 of the data-flow doc) is recomputed from the one fresh branch plus the retained sibling branches. The merge itself always re-runs because a new branch's rules can dedup against retained branches differently; the merge is `O(V·R log(V·R))` and cheap.

### 8.4 Correctness Guardrails

These are the conditions under which a skip or a reuse is **permitted**. If any fails, the decision falls back one level of granularity (partial ⇒ full; skip ⇒ partial or full). The Engine is fail-closed: the default when a guardrail's precondition cannot be evaluated is "do not reuse."

1. **Fingerprint completeness.** A skip is sound only if the fingerprint covers every output-affecting input. The fingerprint inputs are fixed by BRIEF.md Section 2.8 (HTML, CSS assets, viewport, mode) plus Engine/algorithm version (Section 8.1). If a run uses any input *outside* this set that could affect output — e.g., an environment variable that toggles a plugin, a non-deterministic data source read during rendering — that input MUST be added to the fingerprint (in [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md)) or incremental extraction MUST be disabled for that run. This guardrail is a design-review obligation, not a runtime check; it is listed first because it is the one whose violation is silent and severe.
2. **Version gate.** The stored fingerprint carries the Engine version and the fingerprint-algorithm version that produced it. A skip is refused if either differs from the current run's. This makes bug fixes and fingerprint schema changes automatically re-extract everything, rather than serving output from a version whose extraction logic is known-different.
3. **Determinism gate.** Modes whose output is not a pure function of the fingerprinted inputs cannot be safely skipped on the basis of those inputs alone. Coverage mode ([700-Coverage-Mode.md](./700-Coverage-Mode.md)) observes runtime execution, which can vary run-to-run for the same static inputs; a Coverage-mode fingerprint must therefore either incorporate a stabilized coverage trace or accept that skips are heuristic and gate them behind an explicit opt-in with a periodic full-run audit (Section 15). This document does not force Coverage mode to be non-incremental; it forces the *risk* to be explicit and audited, never silent.
4. **Sub-fingerprint availability gate.** Partial re-extraction is permitted only when the required sub-fingerprints *and* retained intermediates are present and their own version gate passes. A partial that cannot prove which sub-work is unaffected degrades to full. There is no "assume unchanged" path.
5. **Byte-identity gate (audit).** Independent of the above, a configurable fraction of skipped routes (default: a small sample, `--verify-skip-rate`) is re-extracted in full and the fresh output compared byte-for-byte against the served prior artifact. A mismatch is a hard failure (`SkipVerificationFailed`), aborts the run, and disables incremental extraction for the remainder — because a single confirmed stale skip means the fingerprint is unsound and *every* skip this run is suspect. This is the empirical backstop behind guardrail 1's design-review obligation.

The net invariant, stated once: **a skip is emitted only when the Engine can prove, via a complete and version-gated fingerprint, that re-running would produce byte-identical output; when it cannot prove this, it does the work.**

## 9. Architecture

### 9.1 Skip / Partial / Full Decision Flow

```mermaid
flowchart TD
    START([Route work item]) --> VER{Version gate:
stored Engine/algo version
== current?}
    VER -- no --> FULL[Full re-extraction]
    VER -- yes / no prior --> FP{Route fingerprint
present & == stored?}

    FP -- "no prior artifact" --> FULL
    FP -- "match" --> DET{Determinism gate:
mode safely skippable?
(700 Coverage caveat)}
    FP -- "mismatch" --> SUB{Sub-fingerprints &
retained intermediates
available?}

    DET -- yes --> SKIP[Skip:
emit prior artifact
before Stage 8.1]
    DET -- "no (heuristic mode,
no opt-in)" --> FULL

    SUB -- no --> FULL
    SUB -- "yes: only some
stylesheets/routes/viewports
changed" --> PARTIAL[Partial re-extraction:
re-run affected sub-work,
reuse the rest,
always re-resolve
cascade closure]

    SKIP --> AUDIT{Sampled for
byte-identity audit?}
    AUDIT -- yes --> VERIFY[Full re-extract +
byte-compare]
    VERIFY -- mismatch --> ABORT[SkipVerificationFailed:
abort, disable incremental]
    VERIFY -- match --> DONE([Emit + RouteSkipped diag])
    AUDIT -- no --> DONE

    PARTIAL --> MERGE[Re-merge + serialize + minify]
    MERGE --> STORE[Store fresh artifact + fingerprints]
    FULL --> STORE
    STORE --> DONE

    classDef danger fill:#a33,stroke:#722,color:#fff;
    classDef safe fill:#363,stroke:#252,color:#fff;
    class ABORT danger;
    class SKIP,DONE safe;
```

The diagram encodes the fail-closed discipline structurally: every ambiguous or unprovable branch (`no prior`, `mismatch` without sub-fingerprints, heuristic mode without opt-in, version mismatch) drains toward `FULL`, never toward `SKIP`. `SKIP` is reachable only through the conjunction of version gate, fingerprint match, and determinism gate.

### 9.2 Where the Decision Sits Relative to the Data Flow

```mermaid
flowchart LR
    subgraph Orchestrator["apps/cli orchestration (this document)"]
        DEC{{skip / partial / full
decision}}
    end
    subgraph Cache["packages/cache (Phase 10, black box)"]
        LK[["lookup(fingerprint)
-> prior artifact + subFPs"]]
        ST[["store(fingerprint, artifact,
subFPs, intermediates)"]]
    end
    subgraph Pipeline["016 Data-Flow chain"]
        S1[Stage 8.1 Live Page]
        S5[Stage 8.5 Matching]
        S6[Stage 8.6-8.7 Dep/Cascade]
        S9[Stage 9.3 Merge]
        S11[Stage 8.11 Minify]
    end

    DEC -- reads --> LK
    DEC -- "skip: bypass entire chain" -.-> S11
    DEC -- "partial: enter at 8.5" --> S5
    DEC -- "full: enter at 8.1" --> S1
    S1 --> S5 --> S6 --> S9 --> S11
    S11 -- writes --> ST
```

This diagram makes the module boundary explicit: the decision logic lives in the orchestrator and *consumes* the Cache Manager's `lookup`/`store` contract. The Cache Manager (Phase 10) owns *how* fingerprints and artifacts are persisted; this document owns *whether and how much* of the pipeline runs given what `lookup` returns. The dashed skip arrow bypasses the entire chain, entering only at emit-time.

## 10. Algorithms

### 10.1 The Skip/Partial/Full Decision

**Problem statement.** Given a route work item, a Cache Manager lookup result, and the current Engine configuration, decide whether to skip, partially re-extract, or fully re-extract, such that the decision never yields stale output (Section 8.4's invariant) and yields the least work consistent with that constraint.

**Inputs.** `route: RouteWorkItem`; `current: { routeFP, subFPs: Map<stylesheetId,fp>, mode, engineVersion, algoVersion }`; `prior = cache.lookup(route.key)` → `{ artifact, storedRouteFP, storedSubFPs, retained, storedEngineVersion, storedAlgoVersion } | null`.

**Outputs.** `Decision = { kind: "skip" | "partial" | "full", entryStage, reuse }` plus a diagnostic.

**Pseudocode.**

```
function decide(route, current, prior) -> Decision
    if prior == null:
        return { kind: "full", entryStage: 8.1, reason: "cache-miss" }

    // Guardrail 2: version gate (fail-closed)
    if prior.storedEngineVersion != current.engineVersion
       or prior.storedAlgoVersion != current.algoVersion:
        return { kind: "full", entryStage: 8.1, reason: "version-changed" }

    if current.routeFP == prior.storedRouteFP:
        // Guardrail 3: determinism gate
        if not isSkippableMode(current.mode):        // e.g. raw Coverage w/o opt-in
            return { kind: "full", entryStage: 8.1, reason: "non-deterministic-mode" }
        return { kind: "skip", entryStage: "emit", reason: "fingerprint-match",
                 artifact: prior.artifact }

    // route fingerprint mismatched -> attempt partial
    // Guardrail 4: sub-fingerprint + retained-intermediate availability
    if prior.storedSubFPs == null or prior.retained == null:
        return { kind: "full", entryStage: 8.1, reason: "no-partial-basis" }

    changed = diffSubFingerprints(current.subFPs, prior.storedSubFPs)
    // changed = { stylesheets: Set, htmlChanged: bool, viewports: Set }

    if changed.htmlChanged:
        // DOM/visibility not reusable -> cannot localize to stylesheets
        return { kind: "full", entryStage: 8.1, reason: "html-changed" }

    if changed.stylesheets.isEmpty() and changed.viewports.isEmpty():
        // fingerprint mismatched but no sub-fingerprint changed:
        // an input outside the sub-fingerprint set changed -> fail-closed
        return { kind: "full", entryStage: 8.1, reason: "unlocalizable-mismatch" }

    return { kind: "partial", entryStage: 8.5,
             reuse: { unchangedStylesheets: prior.retained.matchedPartitions
                                            .exceptKeys(changed.stylesheets),
                      unchangedViewports: prior.retained.branches
                                            .exceptKeys(changed.viewports) },
             recompute: { stylesheets: changed.stylesheets,
                          viewports: changed.viewports },
             reason: "stylesheet-or-viewport-localized" }
```

**Time complexity.** `O(1)` for the version/fingerprint equality checks; `O(K)` for `diffSubFingerprints` where `K` is the number of CSS assets plus viewport profiles for the route (small, typically < 30). The decision is negligible relative to the work it gates.

**Memory complexity.** `O(K)` for the `changed` sets; the retained intermediates are held by the Cache Manager and referenced, not copied, into `reuse`.

**Failure cases.** The `unlocalizable-mismatch` branch is the critical one: a route fingerprint mismatch with *no* sub-fingerprint change means some output-affecting input is fingerprinted at the route level but not decomposed into sub-fingerprints (or an input outside the whole scheme changed). The only sound response is full re-extraction — never a skip, and never a partial that would reuse everything on the false premise that nothing changed. Every branch that cannot prove reuse-safety returns `full`.

**Optimization opportunities.** The per-route decision is embarrassingly parallel across the manifest and can be evaluated for all routes up front (a "plan phase") before any extraction begins, so the orchestrator knows the skip/partial/full split and can schedule the non-skipped work optimally (e.g., batching partials that share a changed shared stylesheet). Flagged in Future Work.

### 10.2 Stylesheet-Localized Partial Resolution

**Problem statement.** Given a reusable visibility-annotated node set (HTML unchanged) and a set `Δ` of changed stylesheets, produce a `CascadedRuleSet` per viewport equal to what a full re-extraction would produce, while re-running Selector Matching only for `Δ`.

**Inputs.** `visibility` (reused per viewport), `cssomΔ` (freshly walked rules for `Δ` only), `priorMatched` (prior `MatchedRuleSet` partitions keyed by `stylesheetIndex`).

**Outputs.** Per-viewport `CascadedRuleSet`.

**Pseudocode.**

```
function partialResolve(visibility, cssomΔ, priorMatched, Δ) -> CascadedRuleSet
    matched = []
    for stylesheetId in allStylesheetIds:
        if stylesheetId in Δ:
            matched += matchSelectors(cssomΔ[stylesheetId], visibility)   // recompute
        else:
            matched += priorMatched[stylesheetId]                         // reuse verbatim
    // MANDATORY full closure — never reused across a stylesheet edit (Section 8.3.1)
    graph   = resolveDependencies(matched)          // 016 Stage 8.6, fixed point
    cascade = resolveCascade(graph)                 // 016 Stage 8.7, browser-authoritative
    return cascade
```

**Time complexity.** `O(|Δ| · S_Δ · E)` for matching only the changed stylesheets' `S_Δ` rules against `E` elements, versus `O(S · E)` for a full match — the saving is proportional to the unchanged fraction of rules. Dependency resolution and cascade are re-run in full at their usual `O(n log n)`/fixed-point cost, which is not the dominant term ([016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 14 identifies matching as the cost center).

**Memory complexity.** `O(S · E)` transient for the matched set, same as full; the win is CPU, not peak memory.

**Failure cases.** If `priorMatched` for an unchanged stylesheet is absent or version-stale, this function must not fabricate an empty partition — it must signal the caller to fall back to full re-extraction (guardrail 4). Reusing a missing partition as "no matched rules" would silently drop that stylesheet's critical CSS.

**Optimization opportunities.** When `Δ` is a stylesheet known (by static analysis or a manifest hint) to define no `@keyframes`/`@property`/`@layer`/custom properties and to only tighten/loosen non-cascade-affecting declarations, the mandatory full closure *could* in principle be narrowed — but this is explicitly deferred to Future Work and gated behind proof, because the failure mode (wrong cascade) is severe and the closure is cheap.

## 11. Implementation Notes

- The decision (Section 10.1) MUST run before Stage 8.1 for the skip case to yield its benefit. Structure `apps/cli` so the browser is acquired lazily, only after a route's decision resolves to `partial` or `full`. A common implementation error is to launch the browser pool eagerly per route and then decide; that discards most of the skip benefit ([016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 14).
- The Cache Manager contract this document depends on is: `lookup(routeKey) -> CacheEntry | null` and `store(routeKey, entry)`, where `CacheEntry` extends [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 10.2's shape with `storedSubFPs`, `retained`, `storedEngineVersion`, `storedAlgoVersion`. Do not inline fingerprint computation into the orchestrator — call into `packages/cache` / [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md). Keeping the boundary crisp is what lets Phase 10 change storage without touching this strategy.
- Every skip and every partial MUST emit a diagnostic (`RouteSkipped`, `PartialReExtraction` with the recompute set, `FullReExtraction` with the reason). Per Principle 6, a run's incremental behavior must be fully auditable from its diagnostics alone. An operator seeing an unexpected regression must be able to read "route X was skipped, fingerprint abc123" and immediately test the hypothesis "the fingerprint is missing an input."
- The version gate (guardrail 2) depends on the Engine embedding its version and the fingerprint-algorithm version into every stored entry at `store` time. Treat a fingerprint-algorithm change as a semver-breaking change to the cache: bumping `algoVersion` MUST invalidate all prior skips automatically via the gate, never require a manual cache purge.
- `isSkippableMode` (guardrail 3) is a small, explicit allow-list, not a heuristic. Pure CSSOM matching is skippable; Hybrid ([701-Hybrid-Mode.md](./701-Hybrid-Mode.md)) is skippable iff its Coverage component is stabilized/opt-in; raw Coverage ([700-Coverage-Mode.md](./700-Coverage-Mode.md)) is skippable only under explicit opt-in with audit. Encode this as data, versioned alongside the fingerprint algorithm.

## 12. Edge Cases

- **Fingerprint collision.** Two distinct input sets hashing to the same digest would cause a false skip. Mitigated by [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md)'s choice of a collision-resistant hash; this document assumes collision resistance and does not defend against a broken hash beyond the byte-identity audit (guardrail 5), which would eventually catch a collision empirically.
- **First run / empty cache.** `prior == null` ⇒ full for every route. Correct and expected; incremental extraction has no effect on a cold cache, only on subsequent runs.
- **Route removed from manifest.** A route present in cache but absent from the current manifest is simply not processed; its stale entry is the Cache Manager's eviction concern (Phase 10, [../design/800-Cache-Overview.md](../design/800-Cache-Overview.md)), not this document's. Incremental extraction never *emits* a route not in the current manifest.
- **Route added to manifest.** No prior entry ⇒ full. No special handling.
- **Shared stylesheet edited, referenced by many routes.** Every route referencing the changed stylesheet fingerprints differently and re-extracts (partial or full); routes not referencing it skip. This is correct fan-out of a shared-asset change and is the case where the plan-phase optimization (Section 10.1) pays off most.
- **HTML changed but all CSS unchanged.** DOM/visibility must be recomputed (different above-fold node set) but the CSSOM is reusable; this is a partial *dual* to Section 8.3.1 (recompute matching against fresh visibility using reused CSSOM rules). The decision algorithm routes `htmlChanged` to full for simplicity in v1; narrowing it to "reuse CSSOM, recompute visibility+matching" is a Future Work refinement, deliberately conservative now because matching-against-fresh-visibility is most of the cost anyway.
- **Non-deterministic rendering under the same fingerprint.** If a page renders differently on identical inputs (e.g., A/B randomization, time-of-day content), the fingerprint cannot capture the variation and a skip could serve the wrong variant's critical CSS. This is a guardrail-1 (fingerprint completeness) violation surfaced empirically by guardrail 5; the correct fix is to disable incremental extraction for such routes (a manifest hint) or to stabilize rendering before extraction ([104-Rendering-Stabilization.md](./104-Rendering-Stabilization.md) territory). The Engine does not silently paper over it.
- **Partial reuse of a version-stale intermediate.** Caught by guardrail 4's version sub-check; falls back to full. Never reused.
- **Clock/timestamp in fingerprint.** Must never happen — fingerprints are over content, not time (Principle 5). A timestamp in the fingerprint would defeat every skip. `createdAtLogical` ([016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 10.2) lives in the cache envelope, not the fingerprint input.

## 13. Tradeoffs

| Decision | Why | Alternative Considered | Tradeoff Accepted |
|---|---|---|---|
| Fail-closed default (any unprovable branch ⇒ full) | A stale skip ships a visible above-fold regression that is severe and hard to attribute (Principle 3) | Fail-open / best-effort reuse for speed | Occasionally do redundant work when reuse *would* have been safe but couldn't be proven; accepted because wasted CPU is cheap and stale CSS is expensive |
| Cascade closure always re-resolved on any stylesheet edit (never reused) | Cascade is a whole-document property; a changed stylesheet can shift layer/specificity order for unchanged rules (Principle 1) | Reuse closure when the edit "looks local" | Lose some partial-reuse savings; accepted because closure is cheap vs. matching and the failure mode (wrong cascade) is severe |
| Strategy vs. storage split (this doc = strategy, Phase 10 = storage) | Lets storage evolve (backend, eviction, keying) without touching correctness-critical skip logic; clean module boundary (BRIEF.md 2.4) | Single combined "incremental cache" document | Two documents and a forward reference to maintain; accepted for separation of concerns |
| Version gate auto-invalidates on Engine/algo bump | Bug fixes and schema changes must re-extract, not serve known-different output | Manual cache purge on release | Every Engine release cold-starts the cache; accepted as the safe default, mitigated by fine-grained versioning if churn becomes a problem (Future Work) |
| Byte-identity audit sampling (guardrail 5) | Empirical backstop for the un-checkable "fingerprint completeness" obligation | Trust the fingerprint design entirely | Small extra full-extraction cost on sampled routes; accepted as cheap insurance against silent staleness |
| Coverage mode skips gated behind opt-in + audit, not forbidden | Coverage's runtime observation is not a pure function of static inputs (Principle 5); but forbidding all reuse wastes real savings | Forbid incremental in Coverage mode entirely / allow it silently | Explicit opt-in friction for Coverage users; accepted over both silent risk and total prohibition |

## 14. Performance

- **Skip is the dominant lever.** A full-route skip avoids a browser navigation, which [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 14 identifies as the largest latency term, plus the entire `O(S·E)` matching cost. In the canonical CI case (one route changed of N), incremental extraction turns an `O(N)` run into `O(1)` extraction + `O(N)` fingerprint checks; fingerprint checks are `O(size of inputs)` hashing, far cheaper than extraction.
- **Partial saves matching proportionally to the unchanged rule fraction.** Per Section 10.2, matching cost drops from `O(S·E)` to `O(S_Δ·E)`. For a small edit to one of many stylesheets, `S_Δ ≪ S` and the saving approaches the full-match cost. Dependency/cascade re-resolution is re-paid in full but is not the cost center.
- **Plan-phase parallelism.** Because the decision (Section 10.1) is a pure function of cache lookups, the whole manifest's skip/partial/full split can be computed before any browser work, enabling optimal scheduling: skips cost nothing, partials sharing a changed shared stylesheet can batch, and full re-extractions parallelize across the browser pool ([102-Browser-Pool.md](./102-Browser-Pool.md)).
- **Audit overhead.** Guardrail 5's sampling adds one full extraction per sampled skip; at a default low sample rate this is a small, bounded, tunable overhead traded for staleness detection. Setting the rate to zero disables the empirical backstop and should be reserved for environments with strong fingerprint-completeness confidence.
- **Memory.** Incremental extraction adds no peak-memory cost to a full or partial run beyond holding the (small) `changed` sets and referencing retained intermediates owned by the Cache Manager. The retained intermediates' storage cost is Phase 10's concern ([../design/800-Cache-Overview.md](../design/800-Cache-Overview.md)); this document only reads them.
- **Cold vs. warm.** Worst case (cold cache, everything full) is exactly the naive baseline plus negligible fingerprint-check overhead — incremental extraction never makes a run slower than not having it, only equal (cold) or faster (warm). This monotonic-improvement property is a deliberate design goal.

## 15. Testing

- **Unit tests — decision function.** Table-driven tests over Section 10.1's branches: null prior ⇒ full; version mismatch ⇒ full; fingerprint match + skippable mode ⇒ skip; fingerprint match + non-skippable mode ⇒ full; mismatch + no sub-FPs ⇒ full; mismatch + localized stylesheet change ⇒ partial; mismatch + no sub-FP change (`unlocalizable-mismatch`) ⇒ full. Each asserts the fail-closed direction explicitly.
- **Unit tests — partial equivalence.** Assert that `partialResolve` (Section 10.2) with a synthetic `Δ` produces a `CascadedRuleSet` byte-identical to a full re-extraction over the same inputs — the core correctness property of partial reuse — including a case where the changed stylesheet alters `@layer` order for a rule in an *unchanged* stylesheet, proving the mandatory closure re-resolution catches it.
- **Integration tests — end-to-end incremental run.** Run extraction, mutate exactly one stylesheet, re-run, and assert: (a) only the affected route(s) re-extracted, (b) sibling routes emitted `RouteSkipped`, (c) the changed route's output equals a from-scratch full extraction of the mutated inputs. Repeat mutating one route's HTML, and one viewport's conditional CSS.
- **Correctness audit — byte-identity oracle.** Guardrail 5 realized as a test mode: force `--verify-skip-rate=1.0` (verify every skip) across a large fixture manifest and assert zero `SkipVerificationFailed`. This is the primary defense against a fingerprint that silently omits an input.
- **Visual-diff cross-check.** Periodically (CI nightly), run the full [703-Visual-Diff.md](./703-Visual-Diff.md) oracle against the output of an *incremental* run and against a *cold full* run of the same manifest; the two must produce identical visual-diff results. A divergence proves incremental extraction changed observable output — a correctness bug — independent of byte comparison.
- **Determinism-gate tests.** Assert Coverage-mode ([700-Coverage-Mode.md](./700-Coverage-Mode.md)) routes are *not* skipped without the explicit opt-in, and that with opt-in they participate in the audit sampling at the configured rate.
- **Regression tests.** A version bump (Engine or fingerprint algorithm) must invalidate every prior skip: assert that after bumping `algoVersion`, a run with an otherwise-warm cache re-extracts everything.

## 16. Future Work

- **HTML-changed CSSOM reuse.** Section 8.3.1 / Edge Cases currently route any HTML change to full. A refinement would reuse the CSSOM Rule List (CSS unchanged) while recomputing only DOM snapshot, visibility, and matching against the fresh above-fold node set — a real saving when CSS dwarfs DOM churn. Deferred because matching-against-fresh-visibility is most of the cost regardless, so the payoff is modest and the added decision complexity nontrivial.
- **Narrowed cascade closure (proof-gated).** Section 10.2's mandatory full closure could be narrowed for stylesheets provably free of cascade-affecting constructs (no `@layer`/`@property`/`@keyframes`/custom properties, no specificity-shifting selectors). Requires a sound static proof; deferred behind that proof because the failure mode is a silent wrong cascade.
- **Plan-phase scheduler.** Formalize the up-front, whole-manifest decision pass (Section 10.1 optimization note) into an explicit planner that emits an execution plan (skip list, partial batches grouped by shared changed asset, full list) consumed by the browser-pool scheduler ([102-Browser-Pool.md](./102-Browser-Pool.md)). Coordinate with the CLI orchestration design.
- **Diff-oriented data shapes.** [016-Data-Flow.md](../architecture/016-Data-Flow.md) Section 16 flags that a mature incremental mode may want `DomSnapshotDelta`-style structures rather than full snapshots. This document currently reuses whole retained intermediates; a delta representation would shrink the retained-intermediate storage cost (Phase 10) and enable finer partials. Open design question shared with the Cache Manager design.
- **Fine-grained version gating.** The current version gate is all-or-nothing (any Engine bump cold-starts the cache). A future gate could map specific Engine components to the fingerprint sub-inputs they affect, so a Minifier bug fix invalidates only serialization, not matching. High value for release-frequency but requires a dependency map from Engine components to output-affecting stages; deferred.
- **Coverage-mode stabilized fingerprint.** Resolve, with [700-Coverage-Mode.md](./700-Coverage-Mode.md), whether a stabilized coverage trace can be made a deterministic fingerprint input, upgrading Coverage skips from opt-in-heuristic to provably-sound.

## 17. References

- [016-Data-Flow.md](../architecture/016-Data-Flow.md) — the transformation chain and stage numbering this document decides to skip / partially run / fully run; Section 14 (caching/performance) and Section 16 (incremental future work) are directly operationalized here.
- [006-Design-Principles.md](../architecture/006-Design-Principles.md) — Principle 3 (Correctness over Premature Optimization), Principle 5 (Determinism of Output), Principle 6 (Fail-Fast Diagnostics), Principle 8 (Incremental-by-Default Caching).
- [700-Coverage-Mode.md](./700-Coverage-Mode.md) — determinism caveat that constrains Coverage-mode skips (guardrail 3).
- [701-Hybrid-Mode.md](./701-Hybrid-Mode.md) — mode component of the fingerprint; Hybrid skippability condition.
- [702-Computed-Style-Mode.md](./702-Computed-Style-Mode.md) — computed-style verification as a mode variant participating in the mode fingerprint.
- [703-Visual-Diff.md](./703-Visual-Diff.md) — independent visual correctness oracle used to audit that incremental runs match cold full runs (Section 15).
- [../design/800-Cache-Overview.md](../design/800-Cache-Overview.md) — Phase 10 storage mechanism: persistence, keying, eviction, invalidation. Forward reference (not yet written).
- [../design/801-Fingerprinting.md](../design/801-Fingerprinting.md) — Phase 10 fingerprint computation consumed here as a black box. Forward reference (not yet written).
- [102-Browser-Pool.md](./102-Browser-Pool.md) — the scheduler onto which non-skipped work is dispatched (plan-phase optimization).
- [104-Rendering-Stabilization.md](./104-Rendering-Stabilization.md) — stabilization prerequisite for a fingerprint to be a valid proof of output equality (non-deterministic-rendering edge case).
- Project Brief, Section 2.8 (Incremental Cache) and Section 2.4 (System Modules) — `BRIEF.md` at repository root.
- W3C CSS Cascading and Inheritance Level 5 — https://www.w3.org/TR/css-cascade-5/
