# 006 — Implement Serializer

## Title

**Implement `packages/serializer`: Deterministic CSS Serialization Pipeline**

## Package/Module

`packages/serializer` (Phase 8, Serialization). Owns the transformation from a `MergedMultiViewportRuleSet` (or single-viewport `CascadedRuleSet`) into a `SerializedArtifact` — a valid, byte-deterministic CSS string plus optional source map and stats.

## Depends-On

- `packages/cascade-resolver` (upstream producer of `CascadedRuleSet` / `MergedMultiViewportRuleSet` — must exist and be stable before this task starts; treated as a task-card prerequisite even though it is not itself one of the six cards in this batch).
- `packages/dependency-graph` (`DependencyGraph` / `dependencyManifest` shape consumed for INV-2 completeness checks).
- ../design/302-Rule-Tree.md (source of `sourceOrderIndex` / `origin` fields).
- ../design/305-Cascade-Layers.md (`LayerOrderRegistry`, `layerScopePath`).
- ../adr/ADR-0004-Plugin-Lifecycle-Model.md (shape of `beforeSerialize` / `afterSerialize` hook payloads this module must host, even though `packages/plugins` itself is task 008 and may land after or in parallel).

## Design Doc Reference

../design/600-Serialization-Overview.md, and its six sub-concern siblings 601–606 (Rule Ordering, Deduplication, Compression, Output Validation, Source Maps, Output Formats), all of which this task implements as one cohesive internal pipeline.

## Overview

This task builds the full `packages/serializer` module as the fixed, linear seven-step internal pipeline specified in 600 §8.3: ordering → deduplication → AST assembly → optional source-map correlation → compression → validation → format wrapping. The module must be a **pure, host-only, browser-independent** function of its input and configuration (600 §8.1) — no wall-clock reads, no filesystem access, no iteration over an unordered collection whose order is not itself provably input-determined. This purity is what lets the module run identically whether invoked live during a cache miss or replayed during golden-file test regression with no browser attached.

Because 601–606 are siblings that this overview delegates to but does not itself specify algorithmically, this task's scope includes implementing the concrete algorithms those six documents describe, not merely stubbing the pipeline shape. A partial implementation that wires the seven-step skeleton but fakes any one sub-stage (e.g., a no-op deduplicator) does not satisfy this task — see Acceptance Criteria.

## Acceptance Criteria

- `serialize(input: MergedMultiViewportRuleSet, config: SerializerConfig): SerializedArtifact` is implemented and exported from `packages/serializer`'s public entry point, matching the contract in 600 §8.1.
- All seven internal pipeline steps (600 §8.3) are implemented in the specified order: rule ordering (601), deduplication (602), AST assembly, optional source-map correlation (605), compression (603), output validation (604) as a non-mutating gate, and output-format wrapping (606).
- **Determinism (INV-3):** two invocations against byte-identical input and identical config produce byte-identical `SerializedArtifact.css` output, verified by a repeated-run equality test (not merely a single golden-file snapshot).
- **Cascade fidelity (INV-1):** a test harness renders the original page's above-fold elements against both the original stylesheet set and the serialized output and asserts identical computed styles for at least the fixture set covering ordering, dedup, and cascade-layer edge cases.
- **Dependency completeness (INV-2):** every at-rule (`@keyframes`, `@font-face`, `@property`, `@counter-style`, layer declarations) named in `dependencyManifest` appears in the output exactly once and in a syntactically valid position.
- `beforeSerialize` / `afterSerialize` hook injection points exist and exchange only explicit patch/decision DTOs (per ADR-0004), never mutable references to internal pipeline structures — even if `packages/plugins` (task 008) has not yet landed, the DTO shape and injection points must be present and unit-testable with a stub dispatcher.
- Output validation (604) rejects and raises a diagnostic for any malformed intermediate state (unbalanced braces, missing required at-rule) rather than silently emitting broken CSS.
- Unit tests cover each of the six sub-concerns (601–606) independently, plus at least one end-to-end integration test exercising the full pipeline against a multi-viewport, multi-layer fixture.
- No output byte depends on host OS, Node version, timezone, locale, or `Intl` formatting (600 §8.2 obligation 4) — enforced by a test that runs the suite under at least two different `TZ`/locale environment settings and diffs output.

## Estimated Complexity

**L** — six non-trivial sub-algorithms (ordering, dedup, compression, validation, source maps, format wrapping) composed into one determinism-critical pipeline, with cross-cutting correctness invariants (INV-1/2/3) that must hold end-to-end, not just per-stage.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, including (at minimum, pending that document's final text): passing unit and integration tests for all six sub-concerns, a determinism regression test wired into CI, code review sign-off from the Core Architecture Working Group, and updated cross-references in 600–606 if implementation surfaces a divergence from the documented design (any such divergence must be reconciled by doc PR, not silently absorbed into code).
