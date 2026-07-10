# 009 — Implement Reporter

## Title

**Implement `packages/reporter`: Diagnostics and Reporting System**

## Package/Module

`packages/reporter` (Phase 13, Diagnostics). Owns the shared cross-pipeline data-collection substrate and the seven report types named in BRIEF.md Section 2.12: dependency graph, matched-selector report, unmatched-selector report, stylesheet-contribution report, timing report, extraction trace, and HTML visualization.

## Depends-On

- Every upstream pipeline stage (Navigation Engine, DOM Collector, Visibility Engine, CSSOM Walker, Selector Matcher, Dependency Resolver, Cascade Resolver, `packages/serializer` (task 006), Cache Manager (task 007)) — each must emit the instrumentation events this task's data-collection contract requires; this task cannot be meaningfully tested end-to-end until at least the Serializer and Cache Manager exist.
- ../design/605-Source-Maps.md (origin-mapping — a Reporter *input* for two of the seven report types, not a Reporter dependency-in-the-build sense, but its DTO shape must be stable before those two reports can consume it).
- ../architecture/011-Execution-Pipeline.md (the fourteen-state pipeline whose transitions are the Reporter's primary event source).
- ../architecture/016-Data-Flow.md (`MatchedRule`, `GraphNode`, `GraphEdge`, `SerializedOutput` DTOs the Reporter reads rather than redefines).

## Design Doc Reference

../design/1000-Diagnostics-Overview.md, and its five sub-concern siblings 1001–1005 (Logging, Metrics, Tracing, Visualization, Debug UI), all implemented here as one cohesive package.

## Overview

This task builds `packages/reporter` as a terminal consumer of diagnostics emitted at every stage boundary (per ../architecture/010-System-Overview.md §7) — not a stage itself. It must implement the shared data-collection substrate all seven report types draw from, then the five sibling concerns: structured per-stage logging (1001), aggregate numeric telemetry (1002), a replayable per-decision extraction trace (1003), dependency-graph and above-fold HTML visualization (1004), and the interactive `apps/visualizer` debug UI (1005).

A critical scope boundary (1000 §7.1) this task must respect: origin-mapping (605) is one *input* to two of the seven reports, not the Reporter itself, and diagnostics must be at full fidelity — all seven report types present — even with `--source-map` off, the common zero-overhead production path. A partial implementation that only works when origin-mapping is enabled does not satisfy this task.

## Acceptance Criteria

- All seven report types (BRIEF.md §2.12) are implemented and produce correct output against Table 7.1's data-source mapping in 1000: dependency graph, matched-selector report, unmatched-selector report, stylesheet-contribution report, timing report, extraction trace, HTML visualization.
- The five report types with "No" in the origin-mapping column (unmatched selectors, stylesheet contribution, timing, extraction trace, and HTML visualization's core overlay) are verified, by test, to produce full-fidelity output with `--source-map` off.
- The two origin-mapping-enriched reports (dependency graph, matched-selector) correctly annotate with source-stylesheet attribution when `--source-map` is on, and degrade gracefully (omit the annotation, not error) when it is off.
- Structured logging (1001) emits one event per pipeline stage transition (per ../architecture/011-Execution-Pipeline.md's fourteen states), machine-parseable (JSON) and human-readable.
- Metrics (1002) aggregate timing, counts, and sizes across a run and are queryable/exportable as JSON.
- The extraction trace (1003) records a replayable, structured event per element/rule/dependency decision at finer granularity than logging, sufficient to answer "why was rule X included/excluded."
- Visualization (1004) renders the resolved dependency graph and an above-fold/matched-rule HTML overlay from real pipeline output, not synthetic fixtures only.
- `apps/visualizer` (1005) composes logging, metrics, tracing, and visualization into a single browsable session for at least one real extraction run.
- Instrumentation hooks added to upstream stages impose negligible overhead on the common (non-debug) path — verified by a benchmark comparing extraction time with and without Reporter instrumentation attached.
- Unit tests cover each of 1001–1005 independently; at least one end-to-end integration test runs a full extraction and asserts all seven report types are produced and internally consistent with each other (e.g., timing report's stage durations sum consistently with the extraction trace's event timestamps).

## Estimated Complexity

**L** — five distinct sub-concerns (logging, metrics, tracing, visualization, debug UI) each with real design surface, plus a cross-cutting instrumentation contract that must be threaded through every other pipeline stage without materially affecting production performance.

## Notes on Scope Boundaries

The single most important boundary this task must hold, stated plainly because 1000 §7.1 devotes an entire section to preventing its confusion: **origin-mapping (605) is a Reporter input, not the Reporter itself.** An implementer who finds the Reporter module's design gravitating toward "wrap 605's source-map machinery and expose it" has drifted from scope — the Reporter answers a much broader family of questions (navigation timing, DOM node classification counts, per-stylesheet selector match ratios, dependency-resolution fixed-point iteration counts, dead-selector candidates in the *original* site) that have nothing to do with per-rule provenance, and five of the seven report types must work at full fidelity with source-mapping permanently disabled. Concretely: before marking this task done, run the full report suite with `--source-map` off and confirm all seven report types still produce output, with only the two origin-mapping-enriched reports gracefully omitting their optional per-rule attribution rather than erroring or producing empty output.

A second boundary worth flagging for reviewers: the Reporter is a *terminal consumer*, not a stage on the twelve-stage pipeline (010 §7) — it must never be positioned such that another stage blocks on it or depends on its output to proceed. Instrumentation calls into the Reporter from upstream stages should be fire-and-forget with respect to the pipeline's own control flow.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, at the "New module implementation" applicability level (Section 8.2): Gates 1–7, including integration tests against the upstream stages whose instrumentation events this task consumes (Gate 3), a performance-overhead benchmark (Gate 5's performance suite), and doc updates to 1000–1005 and 605 if implementation surfaces a divergence in the Reporter/origin-mapping boundary.
