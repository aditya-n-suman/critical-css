# 005 — Regression Tests

## 1. Title

**Critical CSS Extraction Engine — Regression-Test Discipline and the Bug-to-Fixture Pipeline**

## 2. Version

| Field | Value |
|---|---|
| Document Version | 1.0.0 |
| Status | Draft — Phase 15 (Testing) |
| Last Updated | 2026-07-10 |
| Owners | Core Architecture Working Group / Testing Guild |
| Stability | The bug-to-fixture pipeline (Section 9) and triage taxonomy (Section 8.3) are stable process contracts binding on every contributor who closes a bug. The specific subsystem tag list in Section 8.3 grows as new packages are added and is not exhaustive by design. |

## 3. Purpose

Every non-trivial software system accumulates a body of past mistakes, and a critical CSS extraction engine accumulates a particularly treacherous kind: mistakes that are silent by construction. A missing dependency does not throw; it produces a page that flashes unstyled content on first paint, weeks after the bug was introduced, on a customer's production site, discovered by a support ticket rather than a stack trace. An incorrect visibility decision does not throw; it produces critical CSS that is either bloated (safe but wasteful) or, worse, missing rules a real above-the-fold element needed (a visible layout shift). A cascade-layer misordering does not throw; it produces CSS that parses fine and looks plausible in a diff, but resolves to the wrong computed style once the browser applies layer precedence. A cycle-detection false positive incorrectly declares a legitimate two-variable mutual fallback (`--a: var(--b, red); --b: var(--a, blue);`, which the CSS custom-properties specification's guaranteed-invalid-value semantics actually make well-defined) as broken and discards it; a false negative fails to terminate the fixed-point resolution loop described in `../algorithms/508-Cycle-Detection.md` and hangs the build.

None of these failure modes is caught by a type checker. All of them are, definitionally, caught the first time only by a human noticing wrong output — which means each one, once found, represents an expensive, hard-won piece of institutional knowledge about a specific way the engine's model of the browser can diverge from the browser itself. This document specifies the discipline by which that knowledge is never lost twice: **every closed production bug produces exactly one permanent fixture-plus-expected-output pair, added to the regression suite, that fails against the pre-fix engine and passes against the post-fix engine, and that pair is never deleted.**

This document is not a general testing philosophy document — that is [000-Testing-Strategy.md](000-Testing-Strategy.md)'s job. It is a specific, mechanical discipline: how a bug becomes a fixture, how that fixture composes with the golden-file mechanism in [003-Golden-Files.md](003-Golden-Files.md) and the integration-test layer, and — because a regression suite that accretes one fixture per bug for years will eventually number in the hundreds ([BRIEF.md] itself anticipates this scale in its fixture-category list) — how those fixtures are categorized so the suite remains navigable rather than becoming an undifferentiated pile nobody trusts or understands.

## 4. Audience

- Any contributor who closes a bug against `packages/*` and is responsible for adding the corresponding regression fixture as part of that fix's pull request (Section 9's pipeline is a checklist for this contributor).
- Implementers and maintainers of the golden-file harness ([003-Golden-Files.md](003-Golden-Files.md)), whose comparison mechanism this document's regression fixtures reuse rather than reimplement.
- Implementers of the integration-test suite, who need to understand where a regression fixture graduates into (or starts as) an integration test versus remaining a narrower golden-file-only fixture.
- The Testing Guild, who own the triage taxonomy (Section 8.3) and periodically audit the suite for fixtures that have drifted out of an appropriate category as the codebase's module boundaries evolve.
- New contributors onboarding onto the project, for whom the regression suite (browsable by subsystem tag) is often the fastest way to understand which corners of CSS semantics have historically been the hardest to get right.

Readers are assumed to be comfortable with the project's general test-fixture conventions ([001-Fixtures.md](001-Fixtures.md)) and with reading a bug tracker issue and translating it into a minimal reproduction. This document does not teach how to write a test; it specifies what must exist by the time a bug is marked closed.

## 5. Prerequisites

- [000-Testing-Strategy.md](000-Testing-Strategy.md) — overall test-layer taxonomy; this document specifies one layer (regression) within it.
- [001-Fixtures.md](001-Fixtures.md) — the general fixture format and corpus conventions (Tailwind, Bootstrap, CSS Modules, Styled Components, Emotion, Shadow DOM, SVG, Container Queries, Nested CSS, huge enterprise stylesheets) that regression fixtures extend rather than replace.
- [003-Golden-Files.md](003-Golden-Files.md) — the snapshot-comparison mechanism most regression fixtures are expressed through.
- [../performance/005-Benchmarks.md](../performance/005-Benchmarks.md) and [004-Performance-Tests.md](004-Performance-Tests.md) — the sibling gate that performance-flavored regressions (e.g., a fixture that once caused pathological quadratic-time behavior) feed into, per Section 8.3's `performance` subsystem tag.
- Familiarity with the module boundaries in `../architecture/007-Repository-Structure.md`, since Section 8.3's triage taxonomy is deliberately built around those same package boundaries rather than an invented parallel taxonomy.
- Familiarity with the project's bug tracker workflow (issue lifecycle, "closed" definition) since Section 9's pipeline hooks directly into "what must be true before an issue can be closed."

## 6. Related Documents

- [000-Testing-Strategy.md](000-Testing-Strategy.md) — overall test-layer taxonomy this document's layer fits within.
- [001-Fixtures.md](001-Fixtures.md) — general fixture corpus and format conventions.
- [002-Visual-Tests.md](002-Visual-Tests.md) — sibling non-functional test layer; a visual regression bug's fixture also composes with the mechanism in that document (Section 10 below).
- [003-Golden-Files.md](003-Golden-Files.md) — the snapshot-comparison mechanism most regression fixtures reuse.
- [004-Performance-Tests.md](004-Performance-Tests.md) — the sibling CI-gating layer that a performance-categorized regression fixture (Section 8.3) may also need to register with.
- [../performance/005-Benchmarks.md](../performance/005-Benchmarks.md) — benchmark-harness mechanism referenced by the `performance` subsystem tag.
- `../algorithms/508-Cycle-Detection.md` — source of the cycle-detection false-positive/false-negative example used throughout this document.
- `../algorithms/507-Dependency-Graph-Construction.md` — source of the missing-dependency example.
- `../algorithms/506-Cascade-Layers.md` — source of the cascade-layer-misordering example.
- `../design/200-Visibility-Engine-Overview.md` — source of the incorrect-visibility-decision example.
- `../architecture/007-Repository-Structure.md` — package boundaries the triage taxonomy (Section 8.3) is built around.

## 7. Overview

A **regression fixture**, as defined by this document, is a triple:

1. **A minimal reproduction** — an HTML/CSS input (or, for narrower bugs, a unit-level input to a single function) that deterministically triggers the bug as originally observed. "Minimal" is a design goal, not a hard requirement: a fixture extracted verbatim from a customer's production page, with names and content redacted but structure intact, is acceptable and often preferable to a hand-reduced version, because hand-reduction risks silently losing the exact structural property that triggered the bug in the first place (a nested cascade layer three levels deep, say, that a well-meaning reduction might flatten to two).
2. **An expected output**, captured *after* the fix is applied and *manually verified* against real browser behavior (not merely "whatever the fixed code currently produces," which would make the fixture tautological and unable to catch a second, different bug that happens to produce the same wrong output as the first).
3. **A permanent test-suite entry** that runs the reproduction through the engine and asserts the output matches the expected output byte-for-byte (via the golden-file mechanism, Section 9) or matches within the visual-diff tolerance (via [002-Visual-Tests.md](002-Visual-Tests.md), for bugs whose symptom is only visually observable) or matches within the statistical performance-gate tolerance (via [004-Performance-Tests.md](004-Performance-Tests.md), for bugs whose symptom was a performance pathology rather than an output-correctness one).

The defining discipline is procedural, not technical: **a bug is not "done" until its fixture exists and is committed in the same pull request as the fix, and CI verifies the fixture actually fails against the pre-fix commit** (Section 9.2's mandatory verification step). This second clause matters more than it first appears — it is trivially easy to write a "regression test" that, due to a mistake in the reproduction, never actually exercised the buggy code path, and passes against both the buggy and fixed versions equally uselessly. Requiring a demonstrated red-then-green transition, checked mechanically rather than trusted to reviewer diligence, is this document's answer to that failure mode.

The population of regression fixtures grows monotonically and is never pruned for being "old" (a bug that was fixed three years ago is exactly as capable of being silently reintroduced by a future refactor as one fixed last week) — which is precisely why Section 8 exists: an unpruned, ever-growing, undifferentiated pile of hundreds of fixtures becomes unnavigable long before it becomes technically unmanageable to *run*. Categorization is a discoverability and maintainability concern, not a performance concern (the suite's total runtime, even at several hundred fixtures, is dwarfed by a single [../performance/005-Benchmarks.md](../performance/005-Benchmarks.md) `large`-tier benchmark run).

## 8. Detailed Design

### 8.1 Fixture Anatomy

Every regression fixture lives at `fixtures/regressions/<subsystem>/<issue-id>-<slug>/` and contains:

```
fixtures/regressions/dependency-graph/BUG-1842-missing-at-property-dep/
├── input.html                # minimal or redacted-production repro
├── input.css                 # (if not inlined in input.html)
├── expected.css               # manually browser-verified expected critical CSS
├── expected.meta.json         # { viewport, mode, browserEngine, verifiedOn }
├── ISSUE.md                   # 1-paragraph: symptom, root cause, fix commit SHA
└── config.json                # extraction options this fixture must run under
```

`ISSUE.md` is not documentation decoration — it is the artifact a future engineer reads when this fixture's test fails five years from now during an unrelated refactor, to understand in thirty seconds whether the failure represents "you just reintroduced BUG-1842" or "this fixture's assumptions are stale and need updating." **Why require this narrative field rather than relying on the linked issue-tracker ticket?** Issue trackers are not guaranteed to be permanent (migrations, tool changes, access-control changes over a multi-year project lifetime), while the fixture directory, committed to the main repository, is exactly as permanent as the codebase itself. A one-paragraph summary duplicated into the repository costs little and removes a durability dependency on external infrastructure.

### 8.2 Composition with Golden-File Tests (003)

[003-Golden-Files.md](003-Golden-Files.md) defines the general mechanism for "run the engine on a fixture, compare byte-for-byte (or structurally-normalized) output against a stored snapshot, fail on any diff, require an explicit, reviewed snapshot update to accept an intentional change." Regression fixtures under `fixtures/regressions/` are, mechanically, just more input to that exact same golden-file runner — there is no separate regression-test execution engine. The `expected.css` file in Section 8.1's anatomy *is* a golden file in the sense of [003-Golden-Files.md](003-Golden-Files.md); it is discovered, loaded, and compared by the identical code path used for the general fixture corpus in [001-Fixtures.md](001-Fixtures.md).

**What distinguishes a regression fixture from an ordinary golden-file fixture is provenance and mutability policy, not mechanism.** An ordinary golden-file fixture's snapshot is expected to be updated relatively routinely as the engine's output legitimately evolves (a new CSS feature gains support, output format improves). A regression fixture's `expected.css`, by contrast, requires an elevated review bar to change at all: any pull request touching a file under `fixtures/regressions/**/expected.css` is automatically routed (via a `CODEOWNERS` entry) to a mandatory second reviewer from the Testing Guild, on the theory that a change to a regression fixture's expected output is exactly as likely to represent "the bug came back and someone updated the snapshot to make the red test green" as it is to represent a legitimate reason the expectation changed. This is the single most important process safeguard in this document — a regression suite whose expected outputs can be casually updated by whoever is inconvenienced by a failure provides approximately zero of the protection this document exists to provide.

### 8.3 Subsystem Triage Taxonomy

Fixtures are tagged by subsystem, mirroring the package boundaries in `../architecture/007-Repository-Structure.md` rather than inventing a parallel classification, so that "which fixtures exist for the module I'm about to touch" is answerable by directory listing alone:

| Tag | Scope | Example bug class | Primary consumer package |
|---|---|---|---|
| `browser-abstraction` | Navigation, browser pool, viewport handling | Race condition in multi-tab browser pool reuse | `packages/browser` |
| `collector` | CSSOM walking, stylesheet loading, `@import` resolution | Missed stylesheet behind a redirect chain | `packages/collector` |
| `dependency-graph` | Custom properties, keyframes, font-faces, `@property`, counters, cascade layers, cycle detection | Missing dependency; cycle false-positive/negative; cascade-layer misordering | `packages/dependency-graph` |
| `visibility` | Geometry, intersection, overflow, transforms, sticky/fixed elements, virtualized lists | Incorrect above-fold decision for a `position: sticky` element under a transformed ancestor | `packages/matcher` (visibility subcomponent) |
| `matcher` | Selector matching, specificity, pseudo-classes | Unmatched selector due to `:has()` misevaluation | `packages/matcher` |
| `serializer` | CSS output generation, formatting, deduplication | Non-deterministic property ordering in serialized output | `packages/serializer` |
| `coverage` | Coverage-mode extraction (as opposed to DOM-mode) | Coverage-mode over-reporting used rules due to speculative parse | `packages/coverage` |
| `cache` | Incremental cache, fingerprinting | Stale cache hit after a viewport-only config change | `packages/cache` |
| `plugins` | Plugin lifecycle hooks | `afterCollection` hook mutation not observed by downstream `beforeSerialize` hook | `packages/plugins` |
| `performance` | Pathological time/memory behavior, not output incorrectness | Quadratic-time selector matching on a 50k-rule enterprise stylesheet | cross-cutting; feeds [004-Performance-Tests.md](004-Performance-Tests.md) |
| `visual` | Bugs whose only observable symptom is a rendered-pixel difference | Above-fold clipping boundary off by one scroll-container level | cross-cutting; feeds [002-Visual-Tests.md](002-Visual-Tests.md) |
| `ssr-integration` | Framework adapters (React SSR, Next.js, Astro, Remix, Express, Fastify) | Next.js adapter double-injecting critical CSS on client-side hydration | `apps/*` adapters |
| `cli` | Command-line interface, route manifest, config parsing | Route-manifest glob pattern (`/blog/*`) not matching nested routes | `apps/cli` |

A fixture is assigned exactly one primary tag (matching where the root cause lived) and may carry secondary tags (e.g., a bug in `dependency-graph` whose *symptom* was a visual regression gets primary tag `dependency-graph`, secondary tag `visual`, and is discoverable from both directories via a symlink-free manifest entry rather than a filesystem symlink, to keep the fixture's single source of truth unambiguous). **Why root-cause tagging as primary, rather than symptom-based tagging?** A contributor investigating "why does the dependency graph package have this weird fixture" needs the root-cause view; a contributor investigating "what visual regressions has this project had historically" needs the symptom view. Root-cause-primary with symptom-secondary serves the more common maintenance question (understanding a package's own historical failure modes while working in it) as the direct, unmediated lookup, and the rarer cross-cutting question via the secondary-tag manifest.

**Alternative considered:** a flat, single-level tag with no primary/secondary distinction. Rejected because the `performance` and `visual` categories are inherently cross-cutting (a performance pathology can originate in any package) and collapsing them into the same flat namespace as root-cause package tags would make neither view clean — every performance bug would need its own `dependency-graph-performance`, `matcher-performance`, etc. compound tag, multiplying the taxonomy's size without adding real discriminating power.

### 8.4 Suite Navigability at Scale

At the scale [BRIEF.md] §2.15 implies (a fixture corpus spanning ten-plus categories, growing over years of production incidents into the hundreds), navigability requires more than directory structure. This document mandates a generated `fixtures/regressions/INDEX.md` (auto-generated by a script reading each fixture's `ISSUE.md` and `config.json`, run as a pre-commit or CI-time check that fails if `INDEX.md` is stale relative to the fixture directory) — a single flat table of every regression fixture, its subsystem tag(s), its originating issue ID, and a one-line symptom summary, sorted by subsystem then by date. This gives a "grep one file" answer to "has this specific bug shape been seen before" without needing to open dozens of individual `ISSUE.md` files, and gives the Testing Guild's periodic audits (Section 4) a single artifact to review for taxonomy drift.

## 9. Architecture (Mermaid)

```mermaid
flowchart TD
    A[Bug reported<br/>production incident, support ticket,<br/>or contributor-discovered] --> B[Root-cause investigation]
    B --> C[Minimal or redacted-production<br/>reproduction constructed]
    C --> D["Reproduction run against<br/>pre-fix engine (buggy commit)"]
    D --> E{Does repro<br/>demonstrate the bug?}
    E -->|no, repro insufficient| C
    E -->|yes| F[Fix implemented in<br/>relevant package]

    F --> G["expected.css manually derived<br/>and browser-verified<br/>(NOT copied from fixed-engine output blindly)"]
    G --> H[Fixture committed:<br/>input + expected + ISSUE.md + config.json<br/>under fixtures/regressions/&lt;subsystem&gt;/]
    H --> I[CI: red-then-green verification]

    I --> J{"Fixture run against<br/>pre-fix commit (in CI sandbox)"}
    J -->|passes pre-fix — repro is inert| K[BLOCK MERGE:<br/>fixture does not actually<br/>exercise the bug]
    K --> C

    J -->|fails pre-fix as expected| L{"Fixture run against<br/>post-fix commit (the PR HEAD)"}
    L -->|fails post-fix| M[BLOCK MERGE:<br/>fix is incomplete]
    M --> F
    L -->|passes post-fix| N[Golden-file runner (003)<br/>registers fixture into<br/>permanent regular CI run]

    N --> O[INDEX.md regenerated,<br/>CI fails if stale]
    O --> P[PR mergeable]
    P --> Q[Fixture now runs on<br/>every future CI run, forever]

    Q -.->|future refactor<br/>reintroduces bug| R[Fixture fails<br/>on unrelated PR]
    R --> S["CODEOWNERS-gated review:<br/>is this a real regression,<br/>or a legitimate expected.css update?"]
    S -->|real regression| T[Block merge,<br/>original bug re-investigated]
    S -->|legitimate change,<br/>Testing Guild approves| U[expected.css updated<br/>with second-reviewer sign-off]
```

The diagram's two mandatory gates — the pre-fix-must-fail check (`J`) and the post-fix-must-pass check (`L`) — are what separates this document's discipline from an honor-system convention of "please add a regression test." Both are mechanically enforced in CI (Section 11), not left to reviewer judgment, because reviewer judgment is exactly the weak point a rushed incident-response fix is most likely to skip under time pressure.

## 10. Algorithms (pseudocode + complexity)

### 10.1 Regression-Suite Execution

**Problem statement:** Given the full regression fixture corpus (potentially several hundred fixtures spanning the Section 8.3 taxonomy) and a candidate engine build, determine which fixtures still pass, which have regressed, and produce a report partitioned by subsystem so a failure is immediately attributable to a package without a human needing to cross-reference the taxonomy by hand.

**Inputs:**
- `fixtures: RegressionFixture[]` — loaded from `fixtures/regressions/**/`, each with `{ subsystemTags, input, expected, config }`.
- `engineBuild: EngineHandle` — the candidate build under test (a specific commit's compiled `packages/*`).
- `executionMode: "full" | "changed-subsystems-only"` — the second mode exists because, per Implementation Notes (Section 11), a full run of several hundred fixtures on every commit is unnecessary when a change is provably scoped to one package.

**Output:** `RegressionReport = { bySubsystem: Map<Tag, {passed, failed, fixtures: FailureDetail[]}>, overallStatus: "pass" | "fail", totalDurationMs }`

```
function runRegressionSuite(fixtures, engineBuild, executionMode, changedPackages):
    if executionMode == "changed-subsystems-only":
        # Map changed source packages to affected subsystem tags via the same
        # package-boundary mapping used to build the Section 8.3 table, plus
        # always include fixtures with NO primary tag mapped to any changed
        # package's declared dependents (transitive), to catch cross-package
        # regressions a narrow filter would otherwise miss.
        relevantTags = mapPackagesToSubsystemTags(changedPackages)
        activeFixtures = filter(fixtures, f => intersects(f.subsystemTags, relevantTags))
    else:
        activeFixtures = fixtures

    results = []
    # Fixtures are independent (no shared mutable state per BRIEF.md's
    # single-writer graph-mutation discipline established in
    # 507-Dependency-Graph-Construction.md); execute in parallel, bounded by
    # available worker count, mirroring the harness's own parallelization
    # posture (BRIEF.md §2.14).
    for fixture in activeFixtures, in parallel (bounded by workerCount):
        actualOutput = engineBuild.extract(fixture.input, fixture.config)
        comparison = goldenFileCompare(actualOutput, fixture.expected)  # per 003-Golden-Files.md
        results.append({
            fixtureId: fixture.id,
            tags: fixture.subsystemTags,
            status: comparison.matches ? "passed" : "failed",
            diff: comparison.matches ? null : comparison.diff
        })

    report = partitionBySubsystemTag(results)   # groups FailureDetail entries under each tag
    report.overallStatus = any(r.status == "failed" for r in results) ? "fail" : "pass"
    return report
```

**Time complexity:** `O(F * E / W)` where `F` = number of active fixtures, `E` = average per-fixture extraction cost (dominated by the underlying engine pipeline, not by this orchestration), and `W` = worker parallelism — the orchestration overhead itself (partitioning, comparison) is `O(F)` and negligible relative to `E`. In `changed-subsystems-only` mode, `F` is reduced to the subset intersecting `relevantTags`, which — as the corpus grows into the hundreds per subsystem tag (Section 8.4) — is the difference between a multi-minute full run and a sub-minute scoped run for the common case of a change confined to one package.

**Memory complexity:** `O(F)` to hold all fixture inputs/expected-outputs and results simultaneously if run non-streamed; can be reduced to `O(W)` (only in-flight fixtures held in memory) with a streaming/generator-based fixture loader, relevant once the corpus is large enough that loading all `expected.css` files upfront becomes a measurable memory cost (not yet reached at current corpus scale, per Section 14).

**Failure cases:**
- `mapPackagesToSubsystemTags` under-mapping a changed package to too narrow a tag set, causing `changed-subsystems-only` mode to skip a fixture that should have run — mitigated by the deliberately conservative "always include transitively dependent tags" clause in the pseudocode, and by running the `full` mode unconditionally on every merge to `main` (never relying on the scoped mode as the sole gate, only as the faster PR-time signal), mirroring the same PR-time-vs-merge-time separation principle used in [004-Performance-Tests.md](004-Performance-Tests.md) Section 8.3.
- A fixture whose `config.json` has drifted out of sync with a since-changed default extraction option, causing a spurious failure unrelated to the code under test — mitigated by the CODEOWNERS-gated review policy (Section 8.2) applying equally to `config.json` changes, and by the `ISSUE.md` narrative giving a fast way to distinguish "real regression" from "stale fixture config" during triage.
- Parallel execution race conditions if a fixture's extraction has any hidden shared mutable state (e.g., an in-process cache keyed insufficiently) — mitigated by the same single-writer-graph discipline cited in the pseudocode; this is a correctness assumption of the broader engine architecture (`../algorithms/507-Dependency-Graph-Construction.md`), not something this test runner independently guarantees.

**Optimization opportunities:** cache `mapPackagesToSubsystemTags` results per commit (it depends only on the changed-file list, which is stable for a given commit) to avoid recomputing the package-to-tag mapping on every re-run of a flaky CI job; incrementally re-run only previously-failed fixtures on a "re-run failed jobs" CI action rather than the full active set, once a failure report already exists from a prior attempt.

### 10.2 Bug-to-Fixture Admission Check (CI Gate)

**Problem statement:** Mechanically enforce, at CI time, the two gates in Section 9's diagram (`J` and `L`): a new regression fixture's expected output must fail against the pre-fix commit and pass against the post-fix (PR HEAD) commit, so the "does this fixture actually exercise the bug" question is answered by CI rather than by reviewer trust.

**Inputs:** `newFixtures: RegressionFixture[]` (fixtures added or whose `expected.css`/`input.*` changed in this PR's diff), `preFixCommit: CommitRef` (the PR's merge-base with `main`), `postFixCommit: CommitRef` (the PR HEAD).

**Output:** `AdmissionVerdict = { admitted: boolean, reason: string }` per fixture.

```
function checkFixtureAdmission(newFixtures, preFixCommit, postFixCommit):
    verdicts = []
    for fixture in newFixtures:
        preFixBuild  = buildEngineAt(preFixCommit)
        postFixBuild = buildEngineAt(postFixCommit)

        preFixOutput  = preFixBuild.extract(fixture.input, fixture.config)
        postFixOutput = postFixBuild.extract(fixture.input, fixture.config)

        preFixMatches  = goldenFileCompare(preFixOutput, fixture.expected).matches
        postFixMatches = goldenFileCompare(postFixOutput, fixture.expected).matches

        if preFixMatches:
            # The "buggy" commit already produces the expected output —
            # either the bug was already fixed by something else in this
            # range, or the repro never actually exercised it.
            verdicts.append({admitted: false, reason: "fixture passes on pre-fix commit; repro is inert"})
        elif not postFixMatches:
            verdicts.append({admitted: false, reason: "fixture still fails on post-fix commit; fix is incomplete"})
        else:
            verdicts.append({admitted: true, reason: "red-then-green verified"})
    return verdicts
```

**Time complexity:** `O(N * (E_pre + E_post))` where `N` = number of new/changed fixtures in the PR (typically 1, occasionally a handful for a fix touching several related bug shapes) and `E_pre`/`E_post` are single-fixture extraction costs; this requires building the engine twice (pre-fix and post-fix commits), which is the dominant cost and the reason this check runs only on the diff's new fixtures, never the full corpus.

**Memory complexity:** `O(N)` — negligible; the two engine builds themselves are the resource cost, not fixture data.

**Failure cases:** a PR that both fixes the bug and separately, coincidentally, changes `fixture.config.json` in a way that happens to make the pre-fix build also pass — this would incorrectly reject a valid fixture as "inert." Mitigated by requiring the pre-fix build step to use the *new* PR's `config.json` (not the pre-fix commit's own, likely-nonexistent, version of that file) paired with the pre-fix commit's *engine code* — i.e., the config is taken from the fixture as authored, only the extraction engine binary varies between the two builds.

## 11. Implementation Notes

- **`checkFixtureAdmission` (Section 10.2) runs as a distinct, mandatory CI job**, separate from the ordinary `runRegressionSuite` (Section 10.1) job that runs on every commit; it only executes for PRs that touch `fixtures/regressions/**`, since building the engine twice is not a cost worth paying for PRs that add no new regression fixture.
- **`changed-subsystems-only` execution mode (Section 10.1) is the default for PR-time CI**, with the `full` mode reserved for merge-time and nightly runs — the same "cheap-and-fast at PR time, thorough at merge time" split already established in [004-Performance-Tests.md](004-Performance-Tests.md) Section 8.3 for the performance gate, applied here for consistency of contributor mental model across the two CI-gating layers.
- **`INDEX.md` generation (Section 8.4) is a pre-commit hook and a CI check**, not merely a suggested manual step, because an index that is only regenerated when someone remembers to do so degrades to inaccurate within a few fixture additions.
- **The `ISSUE.md` narrative field is enforced by a lightweight schema check** (non-empty, contains a `Root cause:` and `Fix commit:` line) rather than free-form prose validated only by review, so the discipline survives inattentive reviewers.
- **Fixtures tagged `visual` (Section 8.3) are additionally registered with the [002-Visual-Tests.md](002-Visual-Tests.md) snapshot mechanism**, not only the golden-file text comparison — a bug whose symptom was purely visual (e.g., a clipping-boundary error that produces syntactically valid but visually wrong critical CSS) needs a rendered-pixel assertion in addition to a text-diff assertion, since a text-level `expected.css` alone cannot capture "renders one pixel further right than it should."
- **Fixtures tagged `performance` (Section 8.3) register their reproduction as a named benchmark case** consumed by [004-Performance-Tests.md](004-Performance-Tests.md)'s harness, with a threshold specific to that fixture (e.g., "must not exceed O(n log n) empirically, verified by running at 3 input sizes and checking the growth ratio") rather than the standard tiered thresholds in that document's Section 8.1, since a performance-regression fixture's entire purpose is to re-verify a *specific* previously pathological growth pattern is gone, not to track general drift.

## 12. Edge Cases

- **A bug that cannot be reduced to a fixture at all** (e.g., a race condition dependent on real network timing against a third-party CDN, not reproducible deterministically in a sandboxed CI browser) — this document does not pretend every bug fits its mold. Such bugs still get an `ISSUE.md`-only entry under `fixtures/regressions/<subsystem>/<issue-id>-<slug>/NOTES.md` (no `input`/`expected` pair), explicitly marked `non-reproducible`, preserved for institutional memory and cross-referenced from the `INDEX.md`, but excluded from `runRegressionSuite`'s automated execution.
- **Two different bugs producing the same wrong output** on overlapping inputs — the second bug's fixture is still added in full, even though it may look superficially redundant with the first; the `ISSUE.md` narrative distinguishes the two root causes, and both fixtures are kept, because a future refactor could plausibly reintroduce one without the other.
- **A regression fixture whose expected output later needs to legitimately change** because the *specification itself* changed (e.g., a CSS spec clarification changes correct guaranteed-invalid-value behavior after `../algorithms/508-Cycle-Detection.md`'s expected semantics were fixed) — handled by the CODEOWNERS-gated review path (Section 8.2, diagram node `S`/`U`), with the `ISSUE.md` amended (not replaced) to record both the original bug and the subsequent specification-driven update, preserving the full history rather than silently overwriting it.
- **A fixture that depends on a specific browser engine's behavior** (e.g., a WebKit-specific rendering quirk) that later differs from a Chromium-based CI runner's behavior (per `../design/101-Playwright-Adapter.md`'s multi-engine support) — `expected.meta.json`'s `browserEngine` field (Section 8.1) allows a single bug to have multiple expected-output variants keyed by engine, rather than forcing an artificial single "correct" answer across engines that may legitimately diverge.
- **Volume growth eventually straining `full`-mode CI runtime** even with parallelization (Section 10.1) — addressed procedurally, not just technically, by the `changed-subsystems-only` default and the Section 14 scalability discussion, rather than assuming corpus growth is unbounded without any operational response.
- **A fixture reproduction that only manifests under a specific plugin combination** (`BRIEF.md` §2.13's lifecycle hooks) — tagged `plugins` per Section 8.3, with `config.json` recording the exact plugin set and order, since plugin-order-dependent bugs are a known sharp edge of any hook-based extensibility model.

## 13. Tradeoffs

- **Mechanically enforced red-then-green verification (Section 10.2) vs. trusting reviewer diligence.** The mechanical check costs a second engine build per admitted fixture (real CI compute and wall-clock cost) in exchange for eliminating an entire class of "regression test that doesn't actually test the regression" failure — judged worth the cost given this document's stated purpose is specifically to prevent silent failure modes from being silently reintroduced; a regression suite whose fixtures are not verified to have ever failed is only theater.
- **Never deleting/pruning old fixtures vs. periodically retiring "stale" ones.** An ever-growing suite has a real, if currently subdominant, execution-cost tail (Section 14); the alternative — some policy for retiring fixtures after N years of never failing — was rejected because "hasn't failed recently" is not evidence "cannot fail again," and the entire premise of a regression suite is that a fixed bug's risk of reintroduction does not meaningfully decay with elapsed time, only with the codebase's continued discipline in avoiding the code paths that caused it. The `changed-subsystems-only` execution mode (Section 10.1) is this document's answer to the cost side of this tradeoff, rather than pruning.
- **Root-cause-primary tagging vs. symptom-primary tagging (Section 8.3).** Discussed in Section 8.3; the tradeoff is optimizing the common lookup (package-local historical failure modes) at a small cost to the rarer cross-cutting lookup (mediated by secondary tags and the generated index rather than being the default view).
- **Reusing the golden-file mechanism (003) rather than a bespoke regression-test runner.** Reduces implementation surface and keeps one comparison semantics for the whole project, at the cost of regression fixtures inheriting any limitation of that mechanism (e.g., [003-Golden-Files.md](003-Golden-Files.md)'s normalization rules for acceptable non-deterministic output, such as attribute ordering, apply here too, even though a given regression fixture might in principle want stricter byte-exact comparison than the general corpus).
- **CODEOWNERS-gated second review on `expected.css` changes vs. standard single-reviewer process.** Slower merge velocity for any PR that legitimately needs to touch a regression fixture's expectation, in exchange for a structural obstacle against the single most damaging failure mode this document is designed to prevent (quietly "fixing" a failing regression test by updating its expectation to match a reintroduced bug).

## 14. Performance

- **CPU complexity:** dominated by `F * E` (Section 10.1) — fixture count times average extraction cost; at current corpus scale (tens of fixtures, per the nascent state of `fixtures/regressions/` as of this writing) this is a minor fraction of overall CI time, but the document's design (parallelization, `changed-subsystems-only` mode) anticipates growth into the hundreds without requiring an architectural rework, only configuration (worker count, mode defaults).
- **Memory complexity:** `O(F)` non-streamed / `O(W)` streamed, per Section 10.1; not expected to become a binding constraint before execution time does.
- **Caching strategy:** engine builds for a given commit are cached and reused across both `runRegressionSuite` and `checkFixtureAdmission` CI jobs (a build artifact, not rebuilt per job) to avoid the double-build cost of Section 10.2 compounding with the general CI build step already required for every other test layer.
- **Parallelization opportunities:** fixture execution within `runRegressionSuite` (Section 10.1), and, orthogonally, the pre-fix/post-fix builds within `checkFixtureAdmission` (Section 10.2) can run concurrently as two independent build jobs rather than sequentially, halving that gate's wall-clock contribution.
- **Incremental execution:** `changed-subsystems-only` mode (Section 10.1) is this layer's primary incremental-execution mechanism; a secondary opportunity — re-running only fixtures whose `config.json`/`input.*` content hash changed since the last successful full run — is noted as a Future Work item (Section 16) rather than implemented in v1, since correctness (never missing a real regression on `main`) is prioritized over speed for the merge-time and nightly runs where this would apply.
- **Scalability limits:** the design remains architecturally sound into the low thousands of fixtures; beyond that, the flat directory-per-fixture layout under `fixtures/regressions/<subsystem>/` may need a further subdirectory layer per subsystem (e.g., date-bucketed) purely for filesystem and `git status` ergonomics — a cosmetic reorganization, not a design change, and explicitly out of scope until the corpus approaches that scale.

## 15. Testing

- **Unit tests** for `checkFixtureAdmission`'s pre-fix/post-fix comparison logic (Section 10.2), including the edge case noted in that section's failure-cases discussion (config taken from PR HEAD, engine binary varied).
- **Integration tests** that exercise `runRegressionSuite` end-to-end against a small synthetic fixture corpus with a deliberately seeded mix of passing and failing fixtures, verifying the `RegressionReport`'s subsystem partitioning (Section 10.1) correctly attributes each failure to its tag(s), including a fixture with both primary and secondary tags.
- **Visual tests:** the `INDEX.md` generation output (Section 8.4) and any rendered failure-report dashboard are subject to the same snapshot discipline as other generated-document surfaces described in [002-Visual-Tests.md](002-Visual-Tests.md).
- **Stress tests:** a synthetic corpus of several hundred generated fixtures (not real bugs — mechanically generated permutations of the existing fixture shapes) used to validate that `runRegressionSuite`'s parallel execution (Section 10.1) and `INDEX.md` generation (Section 8.4) hold up at the scale anticipated by Section 14 before the real corpus organically reaches it.
- **Regression tests:** recursively, this document's own admission-gate mechanism (Section 10.2) has itself, in practice at similar organizations, been the subject of bugs (e.g., an admission check that silently passed because the pre-fix build step was cached from a stale prior run) — any such bug in the gate's own implementation follows this exact same discipline and gains its own fixture, filed under a `testing-infrastructure` subsystem tag reserved for meta-bugs in the test suite's own tooling.
- **Benchmark tests:** `runRegressionSuite`'s wall-clock time at both `changed-subsystems-only` and `full` execution modes is itself tracked over time via [004-Performance-Tests.md](004-Performance-Tests.md)'s mechanism (the suite's own runtime is a `performance`-tagged metric worth trending, per Section 14's scalability discussion), so that suite-runtime growth is caught proactively rather than discovered only when CI timeouts start firing.

## 16. Future Work

- **Content-hash-based incremental re-execution** (only re-run a fixture whose own input/config content hash changed since the last known-good full run on `main`), noted as deferred in Section 14, to further reduce merge-time/nightly full-run cost as the corpus grows.
- **Automatic fixture-shape clustering** — mining the `expected.css` diffs of past regression fixtures within a subsystem tag to detect near-duplicate bug shapes at fixture-authoring time (warn a contributor "this looks structurally similar to BUG-1204, are you sure this is a new fixture and not a duplicate reproduction of the same root cause"), reducing accidental redundancy in the corpus without resorting to deletion.
- **A `non-reproducible` fixture graduation path**: tooling that periodically retries `NOTES.md`-only fixtures (Section 12) against newly available deterministic-network-mocking capabilities, promoting them to full `input`/`expected` fixtures once reproducibility becomes achievable, rather than leaving them permanently in the degraded, non-automated state.
- **Cross-project regression-fixture sharing**: once downstream consumers of this engine (per [004-Performance-Tests.md](004-Performance-Tests.md) Section 16's cross-repository trend comparison future item) report their own bugs against the engine, establish a channel for their regression fixtures to be contributed upstream, extending this document's discipline beyond the engine's own repository boundary.
- **Taxonomy evolution tooling**: as `../architecture/007-Repository-Structure.md`'s package boundaries evolve (new packages added, existing ones split), build a semi-automated migration tool for Section 8.3's tag table and the historical fixtures tagged under a renamed/split package, rather than requiring a fully manual Testing Guild re-tagging pass.
- **Statistical confidence for `performance`-tagged regression fixtures**: currently (Section 11) these use a fixture-specific empirical-growth-ratio check rather than the full statistical apparatus of [004-Performance-Tests.md](004-Performance-Tests.md); evaluate whether that document's Welch's-t-test-based gate should subsume fixture-specific performance regressions entirely, unifying the two mechanisms.

## 17. References

- [000-Testing-Strategy.md](000-Testing-Strategy.md) — overall test-layer taxonomy.
- [001-Fixtures.md](001-Fixtures.md) — general fixture corpus and format conventions.
- [002-Visual-Tests.md](002-Visual-Tests.md) — sibling visual-regression CI-gating layer; composition point for `visual`-tagged fixtures.
- [003-Golden-Files.md](003-Golden-Files.md) — snapshot-comparison mechanism reused by this document's fixtures.
- [004-Performance-Tests.md](004-Performance-Tests.md) — sibling CI-gating layer; composition point for `performance`-tagged fixtures.
- [../performance/005-Benchmarks.md](../performance/005-Benchmarks.md) — benchmark-harness mechanism referenced by the `performance` subsystem tag.
- `../algorithms/508-Cycle-Detection.md` — source of this document's cycle-detection false-positive/negative example.
- `../algorithms/507-Dependency-Graph-Construction.md` — source of the missing-dependency example and the single-writer mutation discipline this document relies on for safe parallel fixture execution.
- `../algorithms/506-Cascade-Layers.md` — source of the cascade-layer-misordering example.
- `../design/200-Visibility-Engine-Overview.md` — source of the incorrect-visibility-decision example.
- `../design/101-Playwright-Adapter.md` — source of the multi-browser-engine consideration in Section 12.
- `../architecture/007-Repository-Structure.md` — package boundaries the Section 8.3 taxonomy mirrors.
- `../architecture/002-Problem-Statement.md` — source of the §2.15 Testing Strategy requirement this document elaborates.
