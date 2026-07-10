# 003 — Implement Selector Matcher

## Title

**Implement `packages/matcher`: Baseline `Element.matches()`-Based Selector Matching Pipeline**

## Package/Module

`packages/matcher` (Phase 6, Selector Engine). Owns the correctness-first pass that, for every `(node, rule)` pair drawn from the Visibility Engine's node set and the CSSOM Walker's rule tree, determines whether the rule applies to the node.

## Depends-On

- `packages/collector` (Task 002 — CSSOM Walker; supplies the rule tree with `selectorText` per rule).
- Task 005 — Visibility Engine (supplies the `VisibilityAnnotatedNodeSet` of candidate DOM nodes; may land in parallel, but this module's integration test requires a real or fixture-stable node set).
- ../adr/ADR-0002-No-Custom-Selector-Parser.md (the formal decision record this module implements in full: matching is delegated entirely to `element.matches()`).
- ../design/302-Rule-Tree.md (source of the rule tree's `selectorText` and rule identity this module reads).
- ../design/200-Visibility-Engine-Overview.md (source of the `VisibilityAnnotatedNodeSet` this module reads).

## Design Doc Reference

../design/400-Selector-Matching.md — the baseline, correctness-first matching algorithm; explicitly scoped to exclude the performance layer (401-Selector-Memoization.md), which is out of scope for this task.

## Overview

This task builds the naive, correctness-first `packages/matcher` pipeline exactly as 400 specifies: for each node/rule pair, call `element.matches(rule.selectorText)` and record the boolean result, with zero custom selector parsing or evaluation logic. The full modern selector surface must be supported — combinators, nesting, pseudo-elements, `:is()`, `:where()`, `:has()` (browser permitting), attribute selectors, namespace selectors — because "support" here means "correctly delegate to the browser's native implementation," not "reimplement." This document establishes the ground-truth semantics later memoization work (401, a separate future task) must remain provably equivalent to; this task does not implement that optimization layer.

Pseudo-element (402), pseudo-class (403), `:is()`/`:where()`/`:has()` (404), and container-query (405) considerations are sibling documents this task's algorithm must not contradict, but this task's scope is the baseline pass they all sit on top of, not their individually documented edge-case handling — where a sibling document's edge case requires special-casing beyond calling `matches()` correctly, that special case is in scope only insofar as 400 itself describes it as part of the baseline.

## Acceptance Criteria

- A `matchRules(nodes: VisibilityAnnotatedNodeSet, rules: CssomRuleList): MatchedRuleSet` (or equivalently named/shaped) function is implemented and exported from `packages/matcher`'s public entry point, matching 400's documented output contract for the Cascade Resolver and Serializer.
- Matching is performed exclusively via `element.matches(rule.selectorText)` inside a `page.evaluate()`-style bridge call — no regex, no custom AST, no hand-rolled combinator logic anywhere in the implementation. Enforced by code review and a test asserting the module never imports a CSS-selector-parsing library.
- The full modern selector surface is exercised by fixtures: combinators (descendant, child, sibling), `:is()`, `:where()`, `:has()` (with a documented fallback/skip behavior if the target browser lacks support), attribute selectors, and namespace selectors — each with at least one passing-match and one non-matching fixture case.
- `matches()` throwing (e.g., an invalid or unsupported selector reaching the browser) is caught and surfaces a diagnosable per-rule error rather than aborting the entire matching pass for all other rules (Fail-Fast Diagnostics, non-silent).
- Output DTO shape (`MatchedRule`) matches what ../architecture/016-Data-Flow.md documents as flowing to the Cascade Resolver — verified by a contract/type-level test, not just visual inspection.
- The naive O(nodes × rules) pass is explicitly what ships in this task; no memoization or reverse-indexing optimization is introduced here (that is out of scope, deferred to a future 401-based task).
- Unit tests cover the baseline algorithm's correctness against each selector-surface category independently, plus one end-to-end integration test against a real Playwright page exercising the full node-set × rule-tree pass.

## Estimated Complexity

**M** — the algorithm itself is deliberately simple (a single delegated browser call), but correctness across the full modern selector surface, plus robust per-rule error containment, requires a broad fixture matrix.

## Notes & Risks

- **Resist the urge to "help" `matches()`.** Because the entire point of this module is that selector evaluation is the browser's job, any implementation detail that pre-filters, rewrites, or short-circuits a selector before handing it to `element.matches()` (e.g., stripping a pseudo-class the implementer assumes is irrelevant) reintroduces exactly the custom-parser risk ADR-0002 forbids. If a selector category genuinely needs special handling (as flagged by 402–405), that handling should be scoped narrowly and justified against the sibling document that describes it, not invented ad hoc during this task.
- **`:has()` support is browser-version-dependent.** Because this task's fixtures must exercise `:has()` "browser permitting," the test suite should explicitly assert and log which behavior (native match vs. documented skip) was exercised in a given CI run, so a future browser-version bump that changes `:has()` support silently is caught by a changed test result rather than an unnoticed behavior shift.
- **This task ships the baseline only.** It is important that this task's own code not casually introduce a memoization cache "for performance" — the 401 memoization layer is a separate, future task that must be provably equivalent to this baseline; blending the two here would make that later equivalence proof unnecessarily hard to construct and review.

## Definition of Done

This task is done when it satisfies [../implementation/004-Definition-of-Done.md](../implementation/004-Definition-of-Done.md), Section 8, at the applicability level for a "New module implementation" task. In particular: unit tests per selector-surface category (Gate 2); an integration test against the real upstream CSSOM Walker and Visibility Engine outputs (or their stable fixtures), since `MatchedRule` is a documented cross-package DTO (Gate 3, per 004 §11.2.2); documentation updates to ../design/400-Selector-Matching.md if any selector-surface edge case forces a documented deviation from pure delegation (Gate 4); and code review confirming ADR-0002's no-custom-parser constraint was not silently violated (Gate 6).
