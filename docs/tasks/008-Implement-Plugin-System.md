# 008 — Implement Plugin System

## Title

**Implement `packages/plugins`: Lifecycle-Hook Plugin SDK**

## Package/Module

`packages/plugins` (Phase 12, Plugin SDK). Owns plugin discovery/loading from configuration, validation, ordered in-memory registry construction, and dispatch at the six pipeline hook points.

## Depends-On

- `apps/cli` orchestration path (the six call sites — `beforeLaunch`, `afterNavigation`, `beforeCollection`, `afterCollection`, `beforeSerialize`, `afterSerialize` — must be stable stage boundaries per ../architecture/011-Execution-Pipeline.md before this task's dispatcher can be wired in).
- `packages/serializer` (task 006 — already hosts the `beforeSerialize`/`afterSerialize` DTO injection points this task's dispatcher must call into, per ADR-0004).
- ../adr/ADR-0004-Plugin-Lifecycle-Model.md (normative for the discrete-hooks, patch-based, engine-controlled-ordering model).
- ../adr/ADR-0005-Hybrid-Extraction-Mode.md (the orthogonal extraction-strategy axis this task's Section 8.4 composition model must not collide with).

## Design Doc Reference

../plugins/000-Plugin-SDK-Overview.md, and its three siblings 001–004 (Lifecycle Hooks, Plugin API, Plugin Examples, Sandboxing), all implemented here as one cohesive package.

## Overview

This task builds `packages/plugins` as the public surface through which third-party and first-party code extends the engine without forking the core orchestrator. A plugin is a plain module exporting a metadata object (`name`, `version`, reserved `dependsOn`) plus a `hooks` object whose keys are a subset of the six named hooks, each an `async` function with a documented context-in, patch-out signature (000 §8.1). Plugin contributions are strictly patch-based — a plugin never receives a mutable reference to internal pipeline structures, only an explicit DTO it returns a patch against, per ADR-0004.

Because 001–004 are siblings this overview delegates to but does not itself specify algorithmically, this task's scope includes the concrete loader (config → validated, ordered registry), the per-hook dispatcher (deterministic multi-plugin composition in declared order), the sandboxing/execution-isolation boundary (004), and the full `Plugin`/context/patch TypeScript surface (002) — not merely a stubbed hook registry that never actually dispatches.

## Acceptance Criteria

- A plugin loader resolves an ordered, validated `PluginRegistry` from configuration (file path or npm package name array), rejecting malformed plugins (missing `hooks`, invalid metadata) with a diagnostic rather than silently ignoring them.
- All six hooks (`beforeLaunch`, `afterNavigation`, `beforeCollection`, `afterCollection`, `beforeSerialize`, `afterSerialize`) are dispatched at the correct pipeline seams per ../architecture/011-Execution-Pipeline.md's state transitions, each hook invocation isolated with its own timeout and error-isolation semantics.
- Multi-plugin composition at a single hook is deterministic: plugins execute in declared configuration order, and each plugin's returned patch is merged into the context before the next plugin runs (or applied additively per 001's merge semantics) — not run concurrently with racing writes.
- Plugin contributions are exchanged only as explicit patch DTOs (per 002 and ADR-0004's contract shared with task 006's `beforeSerialize`/`afterSerialize` injection points), never as mutable references into `RuleTree`, `DomSnapshot`, or other internal pipeline structures.
- All five named plugin capabilities (selector ignore-lists, CSS rewriting, rule injection, custom visibility policy, custom selector-matching augmentation, per BRIEF.md §2.13) are demonstrated by at least one working example plugin each (003), exercised by an integration test.
- The sandboxing/execution-isolation boundary (004) is implemented such that a plugin throwing an uncaught error at one hook fails that hook's invocation (surfaced as a diagnostic) without crashing the orchestrator process, unless the hook is configured fail-fast.
- Section 8.4's orthogonality claim is verified by a test: the same plugin set produces identical hook-invocation behavior under CSSOM-only, Coverage-only, and Hybrid extraction strategies (ADR-0005) — no plugin-system code branches on extraction-strategy selection.
- Unit tests cover the loader, validator, and dispatcher independently; integration tests exercise real hook invocation against a running (or faked) pipeline for each of the six hook points.

## Estimated Complexity

**L** — six hook points, a deterministic multi-plugin composition model, a sandboxing/trust boundary, and an orthogonality requirement against the extraction-strategy axis together constitute a large, cross-cutting surface even though no single hook's dispatch logic is individually complex.

## Notes on Scope Boundaries

Two distinctions this task must preserve, because they are easy to blur once implementation is underway:

- **Discrete hooks vs. middleware/event-emitter shapes.** ADR-0004 explicitly rejected both alternatives. An implementer must resist the temptation to generalize the dispatcher into a generic event bus "for flexibility" — the six named hooks are the entire extension surface; a seventh, ad hoc hook or a wildcard listener is an RFC-gated change, not something this task's dispatcher should silently permit via a permissive API.
- **Plugins vs. extraction-strategy selection.** The Plugin System and the CSSOM/Coverage/Hybrid strategy selection (ADR-0005) are orthogonal configuration axes that happen to meet at exactly one seam: the `SelectorsMatched` state, where a plugin's `afterCollection` patch (e.g., a custom-matching augmentation) must be visible to whichever strategy is active. This task's dispatcher must pass that seam's data through uniformly regardless of strategy, and must not contain any `if (strategy === 'hybrid')` branching inside plugin-dispatch code — such branching belongs, if anywhere, in the strategy implementations themselves, which read plugin-contributed patches as an input, not the other way around.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, at the "New module implementation" applicability level (Section 8.2): Gates 1–7, including integration tests against `apps/cli`'s orchestration and `packages/serializer`'s existing hook injection points (Gate 3), and doc updates to 000–004 if implementation surfaces any divergence, particularly regarding the `dependsOn` field's not-yet-load-bearing status.
