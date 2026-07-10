# 011 — Implement CLI

## Title

**Implement `apps/cli`: Orchestrator and Command-Line Entry Point**

## Package/Module

`apps/cli` (Phase 2 architecture, realized as an implementation task in this phase). Owns configuration resolution, route-manifest expansion, the fourteen-state single-work-unit orchestration state machine, retry/timeout policy, Plugin System hook dispatch invocation, and CI-facing exit-code/diagnostic behavior.

## Depends-On

- `packages/cache` (task 007 — the orchestrator's first state, `CacheChecked`, is a hard dependency on a working `CacheStore` lookup before any browser is acquired).
- `packages/plugins` (task 008 — the orchestrator is the caller of the six hook dispatch points; this task wires the calls, task 008 implements what they call into).
- `packages/reporter` (task 009 — every state transition emits a diagnostic into the Reporter's stream per Principle 6; the orchestrator is the Reporter's primary event source).
- `packages/serializer` (task 006) and the browser-layer packages (Browser Manager, Navigation Engine, Collector, Matcher, Dependency Resolver) — all must exist and expose stable typed contracts, since this task's job is sequencing calls into them, not reimplementing them.

## Design Doc Reference

No single design doc covers the CLI holistically. This task is grounded in ../architecture/010-System-Overview.md (the twelve-stage pipeline, module taxonomy, and the Cache Manager's dual gate/writer position) and ../architecture/011-Execution-Pipeline.md (the precise fourteen-state machine, retry policy, plugin-hook transition points, and the single `Failed` terminal state this task must implement exactly as specified).

## Overview

This task builds `apps/cli` as the orchestration code that sequences every other package's invocation for one `(route, viewportProfile)` work unit, per 011's state machine: `ConfigResolved` → `CacheChecked` → `BrowserAcquired` → `Navigated` → `Stabilized` → `DomCollected` → `VisibilityClassified` → `CssomWalked` → `SelectorsMatched` → `DependenciesResolved` → `CascadeResolved` → `Serialized` → `Minified` → `CacheWritten`, plus the plugin-hook sub-states, retry super-states, and diagnostic emission layered on top (011 §7). The `CacheChecked` state placement is load-bearing and non-negotiable: a hit must terminate the work unit before `BrowserAcquired` is ever entered (010 §7, "Cache Manager ... also sits in front of the entire pipeline as a short-circuit gate").

Because no single design doc specifies the CLI end-to-end, this task's scope includes: the configuration loader (file/CLI-flag/environment precedence, per 010 §8.1), route-manifest expansion into concrete work units, the state machine driver itself (state transitions, not stage internals — those belong to the packages this task calls), the bounded exponential-backoff retry policy for `BrowserAcquired`/`Navigated`/`Stabilized`, the single `Failed` terminal state with attributed `Diagnostic`, and CI-strict-mode nonzero exit codes once all work units in a batch are attempted (REQ-451–REQ-453).

## Acceptance Criteria

- The configuration loader resolves settings from file, CLI flags, and environment in the documented precedence order, and validates the resolved configuration against a schema before any browser is launched (010 §8.1).
- The route manifest (BRIEF.md §2.9) is expanded into a concrete list of `(route, viewportProfile, extractionMode)` work units, supporting both exact-match and glob-pattern entries.
- The orchestrator implements all fourteen states in 011 §7's exact nominal order for a cache-miss path, verified by a state-transition trace test.
- A cache hit at `CacheChecked` terminates the work unit without ever entering `BrowserAcquired` — verified by a test asserting zero Browser Manager invocations on the hit path (mirrors task 007's short-circuit acceptance criterion, tested here from the orchestrator's side).
- All four plugin-hook transition points (`beforeLaunch` before `BrowserAcquired`, `afterNavigation` after `Stabilized`, `beforeCollection`/`afterCollection` bracketing `DomCollected`, `beforeSerialize`/`afterSerialize` bracketing `Serialized`) invoke the Plugin System dispatcher at the correct sequence position, each with its own timeout.
- Retry super-states are entered only from `BrowserAcquired`, `Navigated`, and `Stabilized` on transient failure, governed by bounded exponential backoff — verified by a test simulating a transient browser crash and confirming bounded retry count, not infinite retry.
- Every state transition (success or failure) emits a diagnostic into the Reporter's stream (Principle 6) — verified by asserting the Reporter receives one event per traversed state in a full run.
- The single `Failed` terminal state is reachable from any state on unrecoverable error, always carries an attributed `Diagnostic`, and in CI-strict mode produces a nonzero process exit code only after all work units in the batch have been attempted (not on first failure) — REQ-451–REQ-453.
- `Minified` is skipped (not failed) when minification is disabled, verified by a test asserting the skip does not trip the `Failed` path.
- Unit tests cover the config loader, route-manifest expansion, and retry policy independently; an end-to-end integration test runs a multi-work-unit batch mixing at least one cache hit, one cache miss, and one transient-then-recovered failure, asserting correct final states and exit code.

## Estimated Complexity

**L** — this task is the integration point for every other package in the system; while no single piece of orchestration logic is deeply algorithmic, correctly sequencing fourteen states, four plugin-hook brackets, three retry super-states, and CI-facing exit semantics against six-plus upstream packages is large in surface area and high in correctness risk.

## Notes on Scope Boundaries

Because no single design document specifies this package end-to-end, the risk this task card exists to manage is scope creep in the opposite direction of the other five cards in this batch: an implementer under-specified by documentation may be tempted to *also* redesign a stage's internals while wiring it in ("while I'm here, let me fix how the Selector Matcher handles X"). That is explicitly out of scope — this task sequences calls into already-stable typed contracts from `packages/browser`, `packages/serializer` (006), `packages/cache` (007), `packages/plugins` (008), and `packages/reporter` (009); it does not modify any of their internals. If wiring this task up surfaces a genuine contract mismatch with an upstream package, the correct action is a linked follow-up task against that package, not an inline fix bundled into this one.

Conversely, this task must not under-scope by treating "orchestration" as merely a thin function-call chain. 011 is explicit that retry policy, timeout scoping, and error propagation are exactly the class of defect a state-machine specification exists to make impossible to get subtly wrong — a reviewer checking this task's completion should verify the actual code against 011's state diagram transition-by-transition, not merely confirm that "the pipeline runs" on a happy-path fixture.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, at the "New module implementation" applicability level (Section 8.2): Gates 1–7, including integration tests against `packages/cache`, `packages/plugins`, and `packages/reporter` (Gate 3, crosses boundary by construction against all three), and doc updates to 010–011 if implementation surfaces any divergence from the documented state machine or stage sequencing.
