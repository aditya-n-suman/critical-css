# 002 — Implement CSSOM Walker

## Title

**Implement `packages/collector`'s CSSOM Walker Sub-Module: Stylesheet Tree Traversal and Rule Tree Production**

## Package/Module

`packages/collector` (Phase 5, CSSOM). Owns traversal of `document.styleSheets` and every nested `CSSRule` reachable from it, inside a live browser page context, producing an in-memory, host-addressable rule tree consumed downstream by the Selector Matcher.

## Depends-On

- `packages/browser` (Task 001 — Browser Pool; supplies the `PageHandle` this module's `page.evaluate()` bridge payload runs inside).
- ../design/106-DOM-Snapshot.md Section 8.7 (establishes the CSSOM Walker as a peer, not a downstream consumer, of `DomSnapshot`, correlated only via shared `snapshotId`).
- ../design/302-Rule-Tree.md (the generic `RuleNode` envelope this module's output must conform to; changes to this shape require RFC per 300's stability note).
- ../adr/ADR-0001-Browser-Is-Source-of-Truth.md and ../adr/ADR-0002-No-Custom-Selector-Parser.md (the two non-negotiable constraints this module operationalizes: no CSS text parsing, ever).

## Design Doc Reference

../design/300-CSSOM-Walker.md — the traversal algorithm over `StyleSheetList` and nested `CSSRuleList`s, per-rule captured facts, same-origin/cross-origin handling, `<style>` vs `<link>` sheet distinction, and source-order preservation.

## Overview

This task builds the CSSOM Walker as specified: a `page.evaluate()` payload that walks every stylesheet and recursively every nested rule (`@media`, `@supports`, `@layer`, `@import`, `@font-face`, `@keyframes`, etc.), reading facts directly off already-parsed `CSSRule` objects and never re-parsing or re-deriving CSS syntax. The module's sole output is a rule tree honoring the `RuleNode` envelope from 302, with source order preserved exactly — the single ordering property the Cascade Resolver and Serializer downstream depend on for correct cascade resolution (300 §3, Principle 5).

The at-rule-specific recursive structures (303–307) are out of scope for this task except insofar as this module must correctly delegate into their node shapes; this task implements the generic traversal contract, not each at-rule's specialized semantics.

## Acceptance Criteria

- The Walker traverses `document.styleSheets` and recursively every nested `CSSRuleList`, producing a `CssomRuleList`/rule tree matching the `RuleNode` envelope in ../design/302-Rule-Tree.md.
- Zero CSS text parsing anywhere in the implementation — every reported fact (`selectorText`, declaration block, nesting position) is read directly from `CSSRule` object properties, never tokenized or re-derived from raw source text. Enforced by code review per ADR-0002 and a test asserting no regex/parser library is invoked on stylesheet text.
- Source order is preserved exactly: a test asserts the rule tree's traversal order matches the DOM's stylesheet-then-rule enumeration order for a fixture with multiple `<style>` and `<link>` sheets interleaved.
- Cross-origin stylesheets that throw on `cssRules` access (per the same-origin policy) are handled without crashing the traversal — the Walker records a diagnosable "inaccessible" marker for that sheet rather than silently dropping it or aborting the whole run.
- `<style>`-authored and `<link>`-authored sheets are both handled and distinguishable in the output (per 300 §3's stated distinction).
- The Walker correlates its output with a `DomSnapshot` via shared `snapshotId` only — it does not read from or depend on `DomSnapshot`'s internal structure (peer relationship per 106 §8.7).
- Unit tests cover: nested at-rule traversal (at least `@media` and `@layer` nesting), cross-origin sheet handling, source-order preservation, and `<style>` vs `<link>` sheet distinction, independently.
- An end-to-end test exercises the full `page.evaluate()` bridge against a real Playwright page (not a DOM-mocking library), per 300's audience note that this runs inside a live browser-controlled context.

## Estimated Complexity

**M** — traversal logic itself is bounded, but correct handling of cross-origin access, multiple at-rule nesting types, and exact source-order preservation across `<style>`/`<link>` interleaving adds real edge-case surface.

## Notes & Risks

- **The "never parse CSS text" discipline is the whole point of this task, not a stylistic preference.** Any temptation to fall back to a regex or lightweight tokenizer when a `CSSRule` subtype's property access is inconvenient must be resisted and instead raised as a question about whether the `RuleNode` envelope (302) needs an additional field — the fix belongs in the contract, not in a parser reintroduced through the back door.
- **Source order is load-bearing downstream, not merely cosmetic.** Because the Cascade Resolver and Serializer both depend on this module's ordering guarantee for correct cascade resolution, a traversal implementation that is "usually" in order (e.g., an implementation that processes same-origin sheets before cross-origin ones for convenience) is a correctness bug, not a performance nit — it must be caught by the source-order test, not discovered downstream in the Serializer's determinism tests.
- **Cross-origin handling should degrade gracefully, not silently.** A page with a mix of accessible and inaccessible stylesheets is the common case in production, not an edge case; the "inaccessible" marker this task introduces should carry enough information (e.g., the sheet's `href`) for downstream diagnostics to explain why a stylesheet contributed no rules, rather than leaving a silent gap in the rule tree that looks like a missed traversal bug.

## Definition of Done

This task is done when it satisfies [../implementation/004-Definition-of-Done.md](../implementation/004-Definition-of-Done.md), Section 8, at the applicability level for a "New module implementation" task. In particular: unit tests per sub-concern (Gate 2); an integration test against a real Playwright-driven page, since this module's output DTO (`CssomRuleList`/`RuleNode`) is documented as flowing to the Selector Matcher package (Gate 3, per 004 §11.2.2); documentation updates to ../design/302-Rule-Tree.md if the implemented envelope diverges from spec (Gate 4); and code review confirming no CSS-text-parsing shortcut was introduced under time pressure (Gate 6).
