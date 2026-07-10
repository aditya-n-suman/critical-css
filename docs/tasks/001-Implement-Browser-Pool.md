# 001 — Implement Browser Pool

## Title

**Implement `packages/browser`'s Pool Module: Playwright Browser/Context/Page Lifecycle Manager**

## Package/Module

`packages/browser` (Phase 2/3, Browser Manager). Owns the acquire/release protocol for Playwright `Browser`, `BrowserContext`, and `Page` objects and hands ready-to-navigate `PageHandle`s to the orchestration layer in `apps/cli`.

## Depends-On

- `packages/logger` or equivalent shared diagnostics library (for fail-fast crash/health-check reporting; treated as a pre-existing infrastructure dependency, not a Phase 16 task card).
- ../architecture/015-Runtime-Model.md Section 8.2 (pool lifecycle states) and Section 8.3 (concurrency model this pool's sizing must compose with).
- ../adr/ADR-0003-Playwright-As-Browser-Abstraction.md (commits to Playwright; sketches the baseline acquire/release algorithm this task extends).
- ../architecture/011-Execution-Pipeline.md Section 8.3/8.15 (the `BrowserAcquired` state and `RetryingBrowserAcquisition` super-state — this pool's primary caller-side contract).

## Design Doc Reference

../design/102-Browser-Pool.md — the implementation-grade specification for pool state machine, acquisition/release protocol, health checks, crash recovery, warm-up strategy, backpressure, and drain/shutdown semantics.

## Overview

This task builds the concrete pool module inside `packages/browser`: a finite-state-machine-driven object pool over Playwright `Browser` → `BrowserContext` → `Page` handles, exposing `acquire()`/`release()` to the orchestration layer. The pool must never hand out a `PageHandle` that isn't isolated, fresh, and health-checked, and it must recover from a crashed `Browser`/`Page` without silently degrading the pool's advertised capacity. Sizing is driven by 102 §8's guidance composed with the three-axis concurrency model from 015 §8.3 — this task does not re-derive sizing policy, it implements it.

## Acceptance Criteria

- `acquire(): Promise<PageHandle>` and `release(handle: PageHandle): Promise<void>` are implemented per 102's state machine (Section 8.1/8.2 equivalent), matching the lifecycle states 015 §8.2 introduces at architecture level.
- Every `PageHandle` returned by `acquire()` comes from a fresh, isolated `BrowserContext` (no state bleed between successive callers reusing the same underlying `Browser` process).
- Health checks detect a crashed/disconnected `Browser` or `Page` (via `browser.on('disconnected')` and `page.on('crash')`) and trigger the documented crash-recovery procedure — a crashed resource is replaced transparently, never silently removed from the pool's advertised capacity without compensating provisioning.
- Backpressure: when the pool is saturated (all slots checked out), `acquire()` either queues the caller per 102's documented backpressure behavior or rejects with a typed, catchable error — never hangs indefinitely with no diagnostic.
- Graceful drain/shutdown: a `drain()` (or equivalently named) method stops issuing new `acquire()` grants, waits for in-flight handles to be released (up to a configurable timeout), and then closes all underlying `Browser` processes — verified by a test that asserts no orphaned browser processes remain after shutdown.
- Warm-up: the pool can pre-launch a configured minimum number of `Browser`/`Context` instances before the first `acquire()` call, per 102's warm-up strategy, verified by a test asserting first-caller latency is below the cold-launch baseline.
- Pool sizing respects the concurrency model in 015 §8.3 (does not launch more concurrent browsers than the configured worker/route-batching ceiling allows).
- Unit tests cover the acquire/release happy path, the crash-and-recover path, the saturated-pool backpressure path, and the drain/shutdown path independently.

## Estimated Complexity

**M** — a single well-specified state machine with a moderate number of edge cases (crash recovery, backpressure, drain), but no cross-cutting algorithmic complexity comparable to the serialization or dependency-resolution pipelines.

## Notes & Risks

- **Sizing is a composed constraint, not a free parameter.** This task must not invent its own pool-sizing heuristic independent of 015 §8.3's concurrency model — a pool sized without regard to the worker/route-batching ceiling can either starve the orchestration layer or oversubscribe host CPU/memory, and either failure mode is a design-doc-level defect, not merely a bug in this task's code. If implementation reveals that 102's sizing guidance and 015's concurrency model produce a contradictory or under-specified combination, that is a documentation gap to raise with the Core Architecture Working Group, not a gap to paper over with an undocumented magic number.
- **Crash recovery must be observable.** Per Design Principle 6 (Fail-Fast Diagnostics), a replaced `Browser`/`Page` after a crash must emit a diagnosable event (log line, metric, or equivalent) distinguishable from a normal release — silently replacing a crashed resource so the pool "just keeps working" hides a signal the orchestration layer and on-call engineers need.
- **Shutdown ordering matters for CI.** A `drain()` that leaves any Playwright-spawned OS process alive will manifest as flaky, resource-starved CI runs on later, unrelated tasks; the orphaned-process check in Acceptance Criteria should be treated as a hard gate, not an optional nicety.

## Definition of Done

This task is done when it satisfies [../implementation/004-Definition-of-Done.md](../implementation/004-Definition-of-Done.md), Section 8, at the applicability level for a "New module implementation" task. In particular: unit tests for acquire/release, crash-recovery, backpressure, and drain paths (Gate 2); an integration test exercising real Playwright `Browser`/`Context`/`Page` objects rather than a mocked stand-in, since this module crosses the boundary between "module doesn't exist" and "module is a producer for `apps/cli`'s orchestration layer" by construction (Gate 3, per 004 §11.2.3); updated cross-references in ../design/102-Browser-Pool.md if implementation surfaces any divergence from the documented state machine (Gate 4); and code review sign-off confirming no undocumented coupling to `apps/cli` internals (Gate 6).
