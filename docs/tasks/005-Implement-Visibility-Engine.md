# 005 — Implement Visibility Engine

## Title

**Implement `packages/collector`'s Visibility Engine Sub-Module: Above-the-Fold Classification Composition**

## Package/Module

`packages/collector` (Phase 4, Visibility Engine). Owns computing, for every node in a `DomSnapshot`, the composed visibility predicate — intersects viewport/fold, non-zero dimensions, not `display:none`, not `visibility:hidden` (configurable), opacity handling (configurable), optional transformed-offscreen exclusion — and emitting a `VisibilityAnnotatedNodeSet`.

## Depends-On

- ../design/106-DOM-Snapshot.md Section 8.2 (the exact raw facts — `boundingBox`, computed-style allow-list, shadow/slot/frame linkage — this module's sole input; no additional browser round trips are permitted).
- ../design/105-Viewport-Manager.md Section 8.3 (fold computation; the single scalar fold value every visibility decision is tested against).
- The six Phase 4 sub-engine design documents this task composes: ../design/201-Geometry-Engine.md, 202-Intersection-Engine.md, 203-Overflow-Handling.md, 204-Transform-Handling.md, 205-Sticky-Elements.md, 206-Fixed-Elements.md (and 207-Virtualized-Lists.md if in scope for this phase's fixture set).
- ../architecture/011-Execution-Pipeline.md Section 8.7 (`VisibilityClassified` state — the pipeline position this module occupies).

## Design Doc Reference

../design/200-Visibility-Engine-Overview.md — the umbrella specification composing the seven cooperating concerns into the single canonical visibility predicate every sub-engine contributes a term to.

## Overview

This task builds the Visibility Engine as the composition point for seven cooperating concerns, six of which have their own sibling design documents. The engine's job is to evaluate, per node in a `DomSnapshot`, the single canonical predicate 200 states once so it is never paraphrased six different ways: visible if it intersects viewport/fold AND has non-zero dimensions AND not `display:none` AND not `visibility:hidden` (configurable) AND passes opacity handling (configurable) AND (optionally) is not transformed off-screen. This task's scope includes correctly invoking and composing the geometry, intersection, overflow, transform, sticky, and fixed-element sub-engines — not reimplementing their individual algorithms from scratch if any already exist as separate deliverables, but if they do not yet exist as separate modules, this task's acceptance criteria require the composed predicate to behave correctly against fixtures covering each concern, meaning the sub-algorithms must be implemented to whatever depth is needed to satisfy those fixtures.

The engine performs zero additional browser round trips beyond the `DomSnapshot` and fold value it is handed (per Principle 1/3: compute from browser-observed facts already captured, never re-query the live page mid-classification).

## Acceptance Criteria

- `classifyVisibility(snapshot: DomSnapshot, fold: number, config: VisibilityConfig): VisibilityAnnotatedNodeSet` (or equivalently named/shaped) is implemented and exported, matching 200's documented output contract for the Selector Matcher and CSSOM Walker's downstream consumers.
- The composed predicate is evaluated with exactly the conjunction 200 §3 states: viewport/fold intersection AND non-zero dimensions AND not-`display:none` AND not-`visibility:hidden` (configurable) AND opacity handling (configurable) AND optional transformed-offscreen exclusion — verified by a fixture-driven test suite with at least one fixture isolating each conjunct (e.g., a zero-dimension-but-in-viewport node must be classified not-visible).
- No additional DOM/browser round trip occurs during classification — verified by a test that classification runs correctly against a serialized/replayed `DomSnapshot` with no live page attached.
- Overflow/clipping propagation (203) is respected: a node fully clipped by an ancestor's `overflow:hidden` bounding box is classified not-visible even if its own bounding box nominally intersects the fold.
- Transform-aware positioning (204): a node moved off-screen purely via CSS `transform` is correctly excluded when the optional transformed-offscreen exclusion flag is enabled, and correctly included when disabled.
- Sticky (205) and fixed (206) positioned elements are classified using their resolved/effective position, not their static-layout position, per those sub-engines' documented handling.
- `visibility:hidden` and opacity handling are each independently configurable via `VisibilityConfig`, with a test demonstrating both the default and the alternate configuration paths.
- Unit tests cover each of the six sub-engine concerns independently (using isolated fixtures), plus at least one end-to-end integration test composing all seven concerns against a single realistic multi-element fixture.

## Estimated Complexity

**L** — the visibility predicate is a composition of six non-trivial sub-concerns (geometry, intersection, overflow, transforms, sticky, fixed), each with real edge cases, and the overview document itself frames correctness as depending on all seven cooperating concerns agreeing, not any single one.

## Notes & Risks

- **The predicate is stated once, canonically, for a reason — implementations must not paraphrase it.** If this task's code computes the six-conjunct predicate as six separate, loosely-related conditionals scattered across the sub-engine call sites rather than one composed expression traceable back to 200 §3, a future change to the predicate (e.g., adding a seventh term for a new CSS feature) risks being applied in five call sites and missed in a sixth. Favor a single composition point even if the sub-engines themselves remain modular.
- **"No additional browser round trips" is a hard architectural constraint, not an optimization.** Because the `DomSnapshot` is the sole input Principle 1/3 permits this module to read, any implementation detail that reaches back into a live `Page` mid-classification (even for a seemingly innocuous re-check) breaks the synchronous-snapshot-based design 200 §16 explicitly frames as the current model's stated boundary — such a change would need to be proposed as future work, not slipped into this task.
- **Configurable behavior needs test coverage on both settings, always.** `visibility:hidden` handling and opacity handling are both explicitly configurable; a test suite that only exercises the default configuration leaves the alternate path unverified and likely to silently regress the first time someone changes the default.

## Definition of Done

This task is done when it satisfies [../implementation/004-Definition-of-Done.md](../implementation/004-Definition-of-Done.md), Section 8, at the applicability level for a "New module implementation" task. In particular: unit tests per sub-engine concern plus one composed end-to-end test (Gate 2); an integration test against a real `DomSnapshot`-producing upstream and the downstream Selector Matcher (Task 003), since `VisibilityAnnotatedNodeSet` is a documented cross-package DTO (Gate 3, per 004 §11.2.2); documentation updates to ../design/200-Visibility-Engine-Overview.md or its sub-engine siblings if the composed predicate's real behavior diverges from spec (Gate 4); and code review confirming the predicate's six conjuncts were not silently narrowed or reordered relative to 200 §3 (Gate 6).
