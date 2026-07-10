# 004 — Implement Dependency Resolver

## Title

**Implement `packages/dependency-graph`'s Fixed-Point Orchestration: `FixedPointResolver`, `DiscoveryQueue`, `DependencyDiscoverer`**

## Package/Module

`packages/dependency-graph` (Phase 7, Dependency Resolution). Owns driving a matched-rule-set to a fully resolved runtime CSS dependency graph by iterating per-construct discovery routines to a fixed point, per ../architecture/014-Dependency-Graph.md's architectural contract.

## Depends-On

- Task 003 — Selector Matcher (supplies the `MatchedRule` set this module's discovery loop starts from).
- ../architecture/014-Dependency-Graph.md (data model: node/edge taxonomy, Section 8.6/8.7's fixed-point-loop and cycle-containment architectural contract this task operationalizes).
- ../architecture/016-Data-Flow.md (DTO shapes for `MatchedRule`, `GraphNode`, `GraphEdge`).
- The six-plus per-construct algorithm documents this task's loop invokes as strategy plug-ins: ../algorithms/501-CSS-Variables.md, 502-Keyframes.md, 503-Font-Faces.md, 504-At-Property.md, 505-Counters.md, 506-Cascade-Layers.md, 507-Dependency-Graph-Construction.md, 508-Cycle-Detection.md (each specifies *what* its discovery routine returns; this task specifies *when* and *how often* it is called).

## Design Doc Reference

../design/500-Dependency-Resolution-Overview.md — the control-flow/orchestration document specifying the `FixedPointResolver`'s discovery loop: entry point, exit condition, queue discipline, complexity budget, and how each per-construct algorithm plugs in.

## Overview

This task builds the orchestration layer that ties the six-plus per-construct discovery algorithms together into one mechanical, terminating loop: given a `MatchedRule` set, discover every `var(--x)` → `Variable` reference, `animation-name` → `@keyframes` block, `@font-face`, `@property`, counter, and cascade-layer dependency, iteratively, until no new nodes/edges are added (a fixed point), while never looping forever on a cyclic reference (508's cycle-detection procedure) and while respecting a resolution-budget circuit breaker for pathological chains. This task does not reimplement or redesign any per-construct discovery algorithm (501–508 own that); it implements the queue, the strategy-dispatch mechanism, the termination check, and the circuit breaker that call those algorithms correctly.

Per 500 §7's disambiguation discipline, this task's implementation and its tests must never use the bare phrase "dependency graph" without a qualifier ("runtime CSS dependency graph") to avoid confusion with the unrelated package-build-time dependency graph in ../architecture/007-Repository-Structure.md.

## Acceptance Criteria

- `FixedPointResolver.resolve(matchedRules: MatchedRuleSet): DependencyGraph` (or equivalently named/shaped) is implemented, matching 500's documented control-flow contract and 014's data-model contract for `GraphNode`/`GraphEdge`.
- The discovery loop invokes each of the eight per-construct algorithms (501–508) as strategy plug-ins without any per-construct document having had to independently implement its own termination, ordering, or cycle-safety logic — verified by each per-construct discoverer being a narrow, injectable strategy with no loop-control code of its own.
- The loop terminates and returns a `DependencyGraph` for at least one fixture per per-construct category (variables, keyframes, font-faces, `@property`, counters, layers) plus a combined fixture exercising several simultaneously.
- Cycle safety: a fixture with a genuinely cyclic reference (e.g., two custom properties referencing each other via `var()`) does not hang the resolver — 508's cycle-detection procedure is invoked and the resolver terminates with the cycle recorded/diagnosed rather than resolved incorrectly.
- Resolution-budget circuit breaker: a pathological fixture designed to produce unbounded discovery iterations is bounded by a configurable budget, and exceeding it produces a diagnosable, fail-fast error rather than an unbounded hang or silent truncation.
- The returned `DependencyGraph` satisfies the "resolved" guarantees 014 promises to downstream consumers (Cascade Resolver, Serializer) — verified by a test that a resolved graph, handed to a stub downstream consumer, contains no dangling/unresolved reference for any construct present in the input fixtures.
- Unit tests cover the discovery-loop's queue discipline and termination check independently of any specific per-construct algorithm (using stub discoverers), plus integration tests wiring in each real per-construct algorithm.

## Estimated Complexity

**L** — a fixed-point loop over eight pluggable discovery strategies with mandatory cycle-safety and a resolution-budget circuit breaker is inherently more complex than a single linear pipeline; correctness depends on the loop's termination guarantees holding across all eight construct types simultaneously, not just individually.

## Notes & Risks

- **Termination is a property of the loop, not of any single discoverer.** A per-construct algorithm (501–508) that is individually correct can still cause the overall loop to fail to terminate if the orchestration layer's fixed-point check or circuit breaker is implemented loosely (e.g., comparing graph size instead of a stable node/edge identity set). The termination check must be specified and tested independently of which discoverers are plugged in, using stub discoverers that deliberately probe boundary conditions (a discoverer that always returns "one new node," a discoverer that oscillates).
- **Cycle detection must not be confused with cycle prevention.** 508's cycle-detection procedure identifies cycles so the loop can terminate safely and report them — it does not mean cyclic CSS constructs are rejected as invalid input; a real page may legitimately have circular `var()` references that resolve fine visually due to fallback values. This task's implementation must preserve that distinction and not treat "cycle detected" as synonymous with "input is broken."
- **The two "dependency graph" concepts must never be conflated in code, comments, tests, or PR descriptions** — this task operates exclusively on the runtime CSS dependency graph; any reference to the unrelated package-build-time graph in `docs/architecture/007-Repository-Structure.md` should be flagged in review as almost certainly a copy-paste or naming error.

## Definition of Done

This task is done when it satisfies [../implementation/004-Definition-of-Done.md](../implementation/004-Definition-of-Done.md), Section 8, at the applicability level for a "New module implementation" task. In particular: unit tests for the loop's queue/termination logic plus integration tests per per-construct algorithm (Gate 2); a cross-package integration test against a real `MatchedRule` set from Task 003 and a stub Cascade Resolver consumer, since `GraphNode`/`GraphEdge` are documented cross-package DTOs (Gate 3, per 004 §11.2.2); documentation updates to ../design/500-Dependency-Resolution-Overview.md or ../architecture/014-Dependency-Graph.md if the fixed-point loop's real termination behavior diverges from spec (Gate 4); and code review confirming the cycle-detection and circuit-breaker paths were exercised, not merely stubbed (Gate 6).
