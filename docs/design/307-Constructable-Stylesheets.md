# Constructable Stylesheets in the CSSOM Walker

## Version

1.0.0 — Phase 5 (CSSOM)

## Purpose

This document specifies how the CSSOM Walker discovers and traverses Constructable Stylesheets — `CSSStyleSheet` objects created via `new CSSStyleSheet()` and adopted into a document or shadow root through `document.adoptedStyleSheets` or `shadowRoot.adoptedStyleSheets` — a discovery mechanism that is structurally disjoint from both the `document.styleSheets` collection ([301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md)) and `@import` resolution ([306-At-Import.md](./306-At-Import.md)). It exists because Constructable Stylesheets are invisible to any traversal strategy that only enumerates `<link>`/`<style>`-sourced sheets, and because this exact blind spot is one of the most consequential correctness gaps in every predecessor critical-CSS tool when applied to Web Components and modern CSS-in-JS libraries that target Shadow DOM.

## Audience

Senior engineers implementing the CSSOM Walker (`packages/collector`) or the DOM Collector, and reviewers evaluating changes to stylesheet discovery. Familiarity with the Constructable Stylesheets specification (`CSSStyleSheet.prototype.replace`/`replaceSync`, `adoptedStyleSheets`), Shadow DOM fundamentals, and this project's Design Principles is assumed.

## Prerequisites

- [006-Design-Principles.md](../architecture/006-Design-Principles.md), specifically Principle 1 (Browser Is the Source of Truth) and its Edge Cases section, which explicitly calls out Constructable Stylesheets as a case the CSSOM Walker must handle by direct browser query rather than by assuming `document.styleSheets` is exhaustive
- [300-CSSOM-Walker.md](./300-CSSOM-Walker.md) — the base traversal algorithm this document adds a second discovery root to
- [301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md) — the `document.styleSheets`-based discovery this document is explicitly *not* an extension of, but a sibling to
- Familiarity with the Shadow DOM specification and the concept of shadow-root encapsulation as it affects `querySelectorAll`/style scoping
- Familiarity, at a conceptual level, with how component libraries (Lit, Stencil, native Web Components) attach styles to shadow roots

## Related Documents

- [300-CSSOM-Walker.md](./300-CSSOM-Walker.md) — the walker this module contributes a second, independent discovery pass to
- [301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md) — discovery of `<link>`/`<style>`-sourced sheets via `document.styleSheets`, structurally parallel but not overlapping with this document's mechanism
- [302-Rule-Tree.md](./302-Rule-Tree.md) — the IR that adopted-sheet-derived rules are attached to, tagged with their adoption context
- [306-At-Import.md](./306-At-Import.md) — the other CSSOM Walker extension in this phase, handling a different, non-overlapping discovery gap (`@import` targets are never Constructable Stylesheets, and vice versa)
- [106-DOM-Snapshot.md](./106-DOM-Snapshot.md) — Shadow DOM handling during DOM traversal, whose shadow-root enumeration this document's discovery pass rides on top of conceptually
- [006-Design-Principles.md](../architecture/006-Design-Principles.md) — Principle 1's explicit Edge Case callout for Constructable Stylesheets, and the general thesis on browser-as-source-of-truth
- [002-Problem-Statement.md](../architecture/002-Problem-Statement.md) — the thesis that static-approximation tools systematically diverge from real rendering, of which Constructable Stylesheets are argued here to be a particularly acute, modern instance

## Overview

The Constructable Stylesheets API (`new CSSStyleSheet()`, `sheet.replaceSync(cssText)` or `await sheet.replace(cssText)`, and `document.adoptedStyleSheets = [sheet, ...]` / `shadowRoot.adoptedStyleSheets = [sheet, ...]`) was introduced specifically to give JavaScript-authored components — Web Components built with Lit, Stencil, or hand-written custom elements, and CSS-in-JS libraries that target Shadow DOM — an efficient way to share a single parsed stylesheet across many shadow roots without either (a) inlining a `<style>` tag's text into every shadow root's markup (which defeats sharing and multiplies parse cost per instance) or (b) fetching the same external stylesheet URL redundantly per component instance. A `CSSStyleSheet` object constructed this way is a fully legitimate CSSOM stylesheet — it has a real `cssRules` collection, participates in the cascade, and is subject to `getComputedStyle()` resolution exactly like any `<link>`- or `<style>`-sourced sheet — but it has **no natural home in `document.styleSheets`**. It is not "attached" to the document tree the way a `<link>` or `<style>` element is; it is *adopted* by reference into one or more `adoptedStyleSheets` arrays, and a sheet with no adopter is a perfectly valid, constructed-but-inert `CSSStyleSheet` object sitting in JavaScript memory, contributing nothing to any render tree until adopted.

This creates a discovery problem that is qualitatively different from the `@import` case in [306-At-Import.md](./306-At-Import.md): `@import` targets are always reachable by walking edges *within* the stylesheet tree the walker is already traversing. Constructable Stylesheets that have been adopted are reachable only by asking the document, or a shadow root, "what sheets have you adopted?" — a query that has nothing to do with parsing any stylesheet's rule list, because the adopting document/shadow-root object is not itself a stylesheet. A CSSOM Walker that only enumerates `document.styleSheets` (Principle 1's baseline mechanism, per [301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md)) will silently miss every rule that lives exclusively in an adopted, constructed sheet — and, critically, this is not a rare edge case for the class of sites this engine's target audience runs: any nontrivial deployment of Lit or Stencil, and a growing share of CSS-in-JS output that targets Shadow DOM for style encapsulation, puts a meaningful fraction — sometimes the *majority* — of a component's styling exclusively into adopted, constructed stylesheets, precisely because that is the API those libraries were built to exploit.

This document specifies three things: (1) the discovery strategy — where the walker must look, beyond `document.styleSheets`, to find every adopted sheet in a page, including inside every shadow root encountered during DOM traversal; (2) sharing semantics — because a single constructed `CSSStyleSheet` object can be adopted by many documents/shadow roots simultaneously (that is the entire point of the API), the walker must deduplicate by object identity, not by content, or it will either double-count rules or, worse, treat two *different* sheets that happen to produce identical CSS text as the same sheet; and (3) why this matters disproportionately for exactly the modern component-library-heavy sites that motivate this project's existence, tying back to the general thesis in [002-Problem-Statement.md](../architecture/002-Problem-Statement.md) that static-approximation tools diverge from real rendering precisely at the seams the browser introduced to make component encapsulation efficient.

## Detailed Design

### 9.1 Why `adoptedStyleSheets` cannot be found by walking `document.styleSheets`

`document.styleSheets` is defined by the CSSOM specification as the list of stylesheets associated with the document via a `<link rel="stylesheet">` or `<style>` element (plus, transitively, whatever those sheets `@import`). It is explicitly *not* defined to include sheets adopted via `document.adoptedStyleSheets`, and shadow roots do not have a `styleSheets` property in the traditional sense at all — a shadow root's only style surface, beyond `<style>` elements physically present inside its shadow tree, is its own `adoptedStyleSheets` array. This is a deliberate specification choice, not an oversight: `adoptedStyleSheets` was designed as a parallel, explicit adoption mechanism precisely so that a single parsed `CSSStyleSheet` could be shared by reference across many consumers (documents and shadow roots) without needing to be "attached" to the document tree the way a `<link>` element structurally is. Attaching it to the document tree would have forced one-sheet-per-consumer semantics (or required inventing a new kind of multiply-parented DOM node), which is exactly what the API exists to avoid.

The practical consequence: a walker that assumes "every stylesheet is reachable by enumerating `document.styleSheets` and recursively following `@import` edges" (the correct and complete strategy for [301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md) and [306-At-Import.md](./306-At-Import.md) alone) has a structural blind spot for any sheet whose *only* attachment to the render tree is through `adoptedStyleSheets`. This is not a bug to be patched with better `@import` handling — it is a categorically different discovery mechanism that must be run as an independent pass.

**Why not require a fallback that scans generated `<style>` output instead.** Some libraries offer a build-time or runtime fallback that injects equivalent `<style>` tags for environments without Constructable Stylesheets support (older engines, or specific SSR configurations). It is tempting to rely on this fallback path and simply extract from the `<style>` tag content in all cases. This is rejected as the *primary* discovery strategy because: (a) it silently produces wrong output on any target browser version where the library actually uses the native adopted-sheet path (the majority case in current browser support), since the fallback `<style>` tags simply won't exist there; (b) it makes correctness depend on knowing implementation details of every possible component library's fallback behavior, which is precisely the static-approximation failure mode this project exists to avoid (Principle 1); and (c) per Principle 1's Edge Case callout in [006-Design-Principles.md](../architecture/006-Design-Principles.md), the walker is required to "query the browser for the actual attached sheet set," which for a page using native Constructable Stylesheets means querying `adoptedStyleSheets` directly, not inferring adoption from a fallback artifact that may or may not be present.

### 9.2 Discovery strategy: two independent enumeration sites

The walker must query `adoptedStyleSheets` at exactly two kinds of site, both of which must be visited during the same DOM/shadow traversal already performed for other purposes (DOM Collector's node enumeration, per [106-DOM-Snapshot.md](./106-DOM-Snapshot.md)):

1. **`document.adoptedStyleSheets`** — a single array, queried once per document (including, in principle, any same-origin nested document such as an iframe the engine is configured to extract from, though iframe traversal is out of scope for this document and covered by the DOM Collector's iframe policy).
2. **`shadowRoot.adoptedStyleSheets`** — queried once for *every* shadow root discovered during DOM traversal, open or closed-mode alike where the automation layer has script access (Playwright/CDP-based traversal has access to closed shadow roots that ordinary page script does not, because the automation protocol operates at a level below the JS-visible open/closed distinction — this is itself a Principle 1-aligned advantage worth noting explicitly: the engine's privileged automation access lets it see strictly more than a naive `document.querySelectorAll` from within page script could).

**Why piggyback on existing shadow-root discovery rather than running a separate DOM walk.** [106-DOM-Snapshot.md](./106-DOM-Snapshot.md)'s DOM Collector already performs a full DOM traversal that must descend into shadow roots for node enumeration and visibility purposes (an element's above-the-fold status is meaningless without traversing into the shadow trees that may contain the actually-rendered content). Running a second, independent DOM walk purely to find shadow roots for the purpose of reading their `adoptedStyleSheets` would duplicate traversal cost and risk the two walks disagreeing about which shadow roots exist (e.g., one walk running before a component's shadow root is attached, if timing differs). The CSSOM Walker's Constructable Stylesheets discovery pass is therefore specified as a *hook* into the DOM Collector's existing shadow-root visitation callback, not a standalone traversal: whenever the DOM Collector's walk visits an element and finds `element.shadowRoot` non-null, it invokes the CSSOM Walker's `adoptedStyleSheets` reader on that shadow root as a side-channel query, in addition to whatever DOM-enumeration work the DOM Collector was already doing there.

**Alternative considered and rejected.** A separate, purely CSSOM-focused document/shadow-root walk (independent of the DOM Collector's node-enumeration walk) was considered for separation-of-concerns reasons — keeping DOM traversal and stylesheet traversal as cleanly independent modules. It is rejected because it doubles the cost of shadow-root discovery (which, unlike stylesheet parsing, requires actually walking the light DOM to find elements with attached shadow roots — there is no "list of all shadow roots" primitive analogous to `document.styleSheets`) and introduces a subtle timing-consistency risk: if the two walks run at different points in the page lifecycle (e.g., after a hydration step that attaches new shadow roots asynchronously), they could disagree about which shadow roots exist, producing rule sets attributed to a DOM snapshot that doesn't match. Sharing one traversal pass guarantees both views are consistent by construction.

### 9.3 Sharing semantics: dedup by reference identity, not content

The Constructable Stylesheets specification explicitly permits — and the component-library ecosystem actively relies on — a single `CSSStyleSheet` object being adopted by many different documents and shadow roots simultaneously. This is, in fact, the API's primary value proposition over inline `<style>` tags: a design-system base stylesheet constructed once and adopted by every shadow root of every component instance avoids re-parsing that CSS text once per instance. A page with a thousand instances of a Lit component might have exactly one constructed `CSSStyleSheet` object for that component's base styles, adopted a thousand times.

This has two direct consequences for the walker:

1. **The walker must maintain a `discoveredSheets: Set<CSSStyleSheet>` keyed by object/reference identity, global to the entire extraction run** (unlike `@import`'s path-scoped `activePath` set in [306-At-Import.md](./306-At-Import.md) — a distinction addressed explicitly in §9.4 below). When the same `CSSStyleSheet` object is encountered as an adoptee of a second, third, or thousandth shadow root, its rules are **not** re-extracted or re-emitted a second time as a duplicate rule set — the walker records only that this sheet is adopted by (potentially) many roots, and extracts its rule content exactly once.
2. **Deduplication must be by reference identity, never by comparing `cssText` or serialized rule content.** Two distinct `CSSStyleSheet` objects can legitimately contain byte-identical CSS text (e.g., two different libraries both shipping the same normalize.css reset as separate constructed sheets) and must be treated as two separate sheets — collapsing them by content-equality would be a category error (conflating "these two sheets happen to produce the same text today" with "this is provably the same sheet," which nothing in the API guarantees and which could change independently if one is later mutated via `replaceSync`). Conversely, relying on any identity proxy other than true object reference (e.g., a `WeakMap`-assigned synthetic ID, which is an acceptable *implementation* of reference identity tracking, versus a content hash, which is not) is required to avoid the opposite error.

**Why this differs from `@import`'s path-scoped set.** In [306-At-Import.md](./306-At-Import.md) §8.2, the cycle-detection set is scoped to the *active recursion path* because the same underlying sheet reached via two different import edges may need to be walked twice, once per distinct conditional (media/layer) context wrapping that edge. Constructable Stylesheets have no equivalent per-edge conditional wrapping: `adoptedStyleSheets` carries no media query, no layer designator, no conditional gating whatsoever — a sheet is either in the array (fully, unconditionally adopted, subject only to the cascade's normal specificity/origin/order rules) or it is not. There is therefore no reason to ever re-extract the same sheet's rules under a different "context" for this discovery mechanism, and a single global, run-scoped dedup set is both sufficient and strictly cheaper than the path-scoped structure required for imports. What *does* vary per adoption site is not the sheet's own conditional applicability, but its **position in cascade order** relative to other sheets adopted by the same root (array order in `adoptedStyleSheets` is cascade-significant — later entries win ties, per the specification) — this is recorded as metadata on each adoption *edge* (document/shadow-root → sheet, with an explicit position index), not as a re-walk of the sheet's rules.

### 9.4 What gets attached to each rule: adoption-site attribution, not sheet-identity duplication

Because one physical `CSSStyleSheet` can be adopted by many roots, and because critical-CSS extraction is fundamentally about "does this rule matter for *this* rendered page, in *this* viewport, given *this* DOM" — not "does this rule exist somewhere in memory" — the walker's output representation must track, for a given extracted rule, every adoption site that makes it apply, not merely that it was found once. Concretely, a `MatchedRule` derived from a constructed sheet's rule list is emitted once per structurally distinct extraction unit but annotated with a set of `AdoptionSite` records: `{ rootType: 'document' | 'shadow-root', rootIdentity, positionInAdoptedArray }` for every root that adopts the underlying sheet and is reachable/relevant in the current DOM snapshot.

This matters concretely for the Selector Matcher and Cascade Resolver: a rule's selector must be matched against elements *within the scope the adopting root defines* — a shadow root's adopted sheet's rules apply only within that shadow tree (Shadow DOM style encapsulation means `element.matches()` calls for these rules must be scoped to that shadow root's tree, not the whole document), even though the underlying `CSSStyleSheet` object is shared. Two shadow roots adopting the same constructed sheet do **not** mean a selector in that sheet matches elements in both shadow trees' *union* — each shadow root's matching is independent and scoped, exactly mirroring how the DOM Collector's Shadow DOM handling in [106-DOM-Snapshot.md](./106-DOM-Snapshot.md) already treats shadow trees as independent matching scopes for other purposes. The walker's job here is narrow: make the adoption-site-to-sheet mapping explicit and complete so the Selector Matcher can apply per-scope matching correctly; the walker itself does not perform matching (Principle 2).

### 9.5 Why this matters disproportionately for Lit, Stencil, and CSS-in-JS-over-Shadow-DOM

[002-Problem-Statement.md](../architecture/002-Problem-Statement.md)'s general thesis is that static-approximation critical-CSS tools diverge from real rendering precisely at the points where CSS semantics require actual browser evaluation rather than pattern matching over source text. Constructable Stylesheets are a particularly sharp instance of this thesis for a structural reason specific to how these tools are typically built: nearly every predecessor tool (Critical, Critters, Penthouse) was designed around an implicit model of "a page's CSS is the union of its `<link>` and `<style>` tags' text, discoverable by parsing HTML." That model was a reasonable approximation of the web circa the mid-2010s, when it was written. It has no representation whatsoever for "CSS that exists only as JavaScript-constructed objects, attached to the render tree via a property assignment rather than a markup tag" — because that mechanism did not exist yet when those tools' core architecture was designed, and retrofitting it requires more than an incremental patch: it requires a JS-execution-aware, live-browser-state-aware discovery pass exactly like the one this document specifies, which is architecturally incompatible with an HTML-text-parsing foundation.

Lit and Stencil (and most CSS-in-JS libraries offering a Shadow DOM target) specifically use Constructable Stylesheets as their primary or exclusive styling delivery mechanism for exactly the sharing efficiency described in §9.3 — a component library with many instances per page has a strong efficiency incentive to construct each component's stylesheet once and adopt it everywhere, rather than duplicating `<style>` tag text per shadow root (which was the pre-Constructable-Stylesheets norm and carries real per-instance parse and memory cost at scale). This means that for a page built with these libraries, an extraction tool with this document's blind spot does not merely miss "some" CSS — it can miss the **majority** of a component-heavy page's actual styling, because the mechanism the library uses specifically to be efficient at scale is exactly the mechanism static analysis cannot see. A critical-CSS tool that silently omits this majority-share of rules produces output that, when applied, causes exactly the flash-of-unstyled-content failure mode this project exists to prevent — for the modern component-library sites that are disproportionately likely to be this engine's actual target users, given the framing in [002-Problem-Statement.md](../architecture/002-Problem-Statement.md) that this project's market position is "the accurate one" relative to tools with a documented history of exactly this class of gap.

## Architecture

The Constructable Stylesheets discovery pass runs as a side-channel query hooked into the DOM Collector's shadow-root visitation, feeding a run-scoped dedup set that the CSSOM Walker consults alongside its `document.styleSheets`- and `@import`-derived rule sets before handing everything to the Rule Tree.

```mermaid
flowchart TD
    A[Extraction run starts] --> B[Query document.adoptedStyleSheets]
    B --> C{For each sheet in array}
    C -->|Not in discoveredSheets| D[Add to discoveredSheets\nExtract sheet.cssRules once]
    C -->|Already in discoveredSheets| E[Record new AdoptionSite\n(document, position)\nSkip re-extraction]
    D --> F[Record AdoptionSite\n(document, position)]

    G[DOM Collector: DFS over light DOM] --> H{Element has\nshadowRoot?}
    H -->|No| G
    H -->|Yes| I[Continue DOM enumeration\ninto shadow tree\n(106-DOM-Snapshot.md)]
    I --> J[Side-channel: query\nshadowRoot.adoptedStyleSheets]
    J --> K{For each sheet in array}
    K -->|Not in discoveredSheets| L[Add to discoveredSheets\nExtract sheet.cssRules once]
    K -->|Already in discoveredSheets| M[Record new AdoptionSite\n(shadowRoot id, position)\nSkip re-extraction]
    L --> N[Record AdoptionSite\n(shadowRoot id, position)]

    F --> O[CSSOM Walker: merge with\ndocument.styleSheets-derived rules\nand @import-derived rules]
    N --> O
    E --> O
    M --> O
    O --> P[Rule Tree: rules tagged with\nfull AdoptionSite set per sheet]
```

The next diagram shows a concrete Shadow DOM tree in which one constructed sheet (`baseSheet`) is shared across three component instances via `adoptedStyleSheets`, and a second sheet (`cardSheet`) is adopted by only one, illustrating both the dedup behavior and the scoped-matching consequence described in §9.4.

```mermaid
flowchart TD
    subgraph Document
        Doc[document\nadoptedStyleSheets: []]
        HostA[app-header\n(custom element)]
        HostB[app-card #1\n(custom element)]
        HostC[app-card #2\n(custom element)]
    end

    subgraph SR_A[Shadow Root: app-header]
        SRA_note[adoptedStyleSheets:\n[baseSheet]]
    end

    subgraph SR_B[Shadow Root: app-card #1]
        SRB_note[adoptedStyleSheets:\n[baseSheet, cardSheet]]
    end

    subgraph SR_C[Shadow Root: app-card #2]
        SRC_note[adoptedStyleSheets:\n[baseSheet, cardSheet]]
    end

    HostA -->|shadowRoot| SR_A
    HostB -->|shadowRoot| SR_B
    HostC -->|shadowRoot| SR_C

    SR_A -.adopts (pos 0).-> baseSheet[(baseSheet\nCSSStyleSheet object)]
    SR_B -.adopts (pos 0).-> baseSheet
    SR_C -.adopts (pos 0).-> baseSheet
    SR_B -.adopts (pos 1).-> cardSheet[(cardSheet\nCSSStyleSheet object)]
    SR_C -.adopts (pos 1).-> cardSheet

    baseSheet -.extracted once,\n3 AdoptionSites recorded.-> Walker[CSSOM Walker\ndiscoveredSheets set]
    cardSheet -.extracted once,\n2 AdoptionSites recorded.-> Walker
```

## Algorithms

### Algorithm: Adopted-Stylesheet Discovery with Reference-Identity Dedup

**Problem statement.** Given a document and every shadow root reachable via DOM traversal, discover every constructed `CSSStyleSheet` adopted anywhere, extract each such sheet's rules exactly once regardless of how many roots adopt it, and record a complete, order-preserving mapping from each sheet to every root/position pair that adopts it.

**Inputs.** `document: Document`; `shadowRoots: ShadowRoot[]` (supplied incrementally by the DOM Collector's traversal callback, per §9.2).

**Outputs.** `discoveredSheets: Map<CSSStyleSheet, AdoptionSite[]>`, where each `AdoptionSite` is `{ rootType, rootIdentity, position }`; plus the extracted `MatchedRule[]` for each sheet, extracted exactly once.

**Pseudocode.**
```
function discoverAdoptedStylesheets(document: Document,
                                     shadowRootStream: Iterable<ShadowRoot>): AdoptionResult

    discoveredSheets: Map<CSSStyleSheet, AdoptionSite[]> = new Map()
    extractedRules: Map<CSSStyleSheet, MatchedRule[]> = new Map()

    function visitRoot(root: Document | ShadowRoot, rootType, rootIdentity):
        sheets = root.adoptedStyleSheets   // ordered array, order is cascade-significant
        for position, sheet in enumerate(sheets):
            site = AdoptionSite(rootType, rootIdentity, position)
            if sheet in discoveredSheets:
                discoveredSheets.get(sheet).push(site)
                // do NOT re-extract; extractedRules already has this sheet's rules
            else:
                discoveredSheets.set(sheet, [site])
                extractedRules.set(sheet, extractRules(sheet.cssRules))
                // extractRules: same rule-dispatch core as 300/301/306, applied
                // to a sheet with no @import edges possible (spec-forbidden
                // inside constructed sheets in practice for this engine's
                // purposes -- see Edge Cases) and no media/layer wrapper
                // from the adoption mechanism itself

    visitRoot(document, 'document', documentIdentity(document))
    for root in shadowRootStream:      // fed incrementally by DOM Collector's DFS
        visitRoot(root, 'shadow-root', shadowRootIdentity(root))

    return AdoptionResult(discoveredSheets, extractedRules)
```

**Time complexity.** O(S_unique × R) + O(A) where S_unique is the number of *distinct* adopted sheets (by reference identity), R is the average rules per sheet (extraction happens exactly once per distinct sheet), and A is the total number of adoption edges (document/shadow-root → sheet pairs) across the whole tree, which dominates when sharing is heavy (many roots, few distinct sheets) since recording an `AdoptionSite` is O(1) per edge. This is a strict improvement over a naive approach that re-extracts per adoption site, which would be O(A × R) — potentially far larger when a handful of sheets are shared across thousands of component instances, exactly the Lit/Stencil scenario motivating this document.

**Memory complexity.** O(S_unique × R) for extracted rule storage plus O(A) for adoption-site records; the dedup set itself is O(S_unique) for the map keys.

**Failure cases.**
- If `rootIdentity` is derived incorrectly (e.g., from a serializable property that is not actually unique, rather than true object/browser-node identity), two distinct shadow roots could be conflated, silently merging their adoption records and corrupting per-scope matching in §9.4; `rootIdentity` must be derived the same way as any other DOM-node identity used elsewhere in the DOM Collector (see [106-DOM-Snapshot.md](./106-DOM-Snapshot.md)) so it is consistent across the two collaborating modules.
- If the DOM Collector's shadow-root stream misses a shadow root (e.g., one attached asynchronously after the DOM Collector's snapshot point but before the CSSOM Walker's pass, or vice versa), this discovery mechanism inherits that gap silently unless the DOM Collector's own timing/stabilization guarantees (Navigation Engine's rendering stabilization, Phase 3) are honored — this is a timing-consistency dependency, not a defect in the discovery algorithm itself, and should be flagged as a `PartialShadowTreeSnapshot`-class diagnostic if the two passes are ever observed to disagree on shadow-root count.
- A constructed sheet mutated via `replaceSync`/`replace` *after* this discovery pass has already extracted its rules produces stale extracted content; per Principle 5 (Determinism), extraction must be defined relative to a single, stable snapshot point (coordinated with the DOM Collector's snapshot timing), and any mutation after that point is out of scope for a given extraction run by design, not an unhandled failure.

**Optimization opportunities.** Because dedup is by reference identity and extraction happens once per distinct sheet regardless of adoption count, this algorithm already achieves the optimal extraction-work bound for the sharing case; the remaining optimization surface is in *shadow-root discovery* itself (minimizing DOM traversal cost, owned by [106-DOM-Snapshot.md](./106-DOM-Snapshot.md)), not in the stylesheet-side deduplication logic specified here.

## Implementation Notes

- The dedup `Map`/`Set` must use true object reference identity, which in a `page.evaluate()`-based automation model means the entire discovery pass should execute as a single in-page function (mirroring the recommendation in [306-At-Import.md](./306-At-Import.md)'s Implementation Notes) so that `CSSStyleSheet` object references remain live JavaScript references throughout the pass, rather than being serialized across an automation-protocol boundary and losing identity fidelity.
- `adoptedStyleSheets` is a *live* array reference in some engines and a snapshot-on-read in others depending on API maturity in the target browser version; the discovery pass should read it once per root at a single, well-defined snapshot point (coordinated with the DOM Collector's overall snapshot timing, per Principle 5) rather than re-reading it multiple times during a single extraction run, to avoid a TOCTOU-style inconsistency if a page mutates its adopted sheets mid-extraction.
- `AdoptionSite.position` must be preserved because array order within `adoptedStyleSheets` is cascade-significant (per the specification, later-positioned sheets take precedence over earlier ones in the array at equal specificity/origin/layer) — this position must flow into the Cascade Resolver's ordering computation alongside `sourceStylesheetIndex`/`sourceRuleIndex` used for `<link>`/`<style>`-sourced sheets in [006-Design-Principles.md](../architecture/006-Design-Principles.md)'s Canonical Ordering algorithm; adopted sheets need their own analogous, stable position key so the Serializer's total order (Principle 5) covers this sheet class too.
- The hook point into the DOM Collector's shadow-root visitation (§9.2) should be implemented as an explicit, typed callback/event (`onShadowRootDiscovered(root, identity)`) rather than the CSSOM Walker directly importing or re-implementing any part of the DOM Collector's traversal, keeping the module boundary intact per the general package-dependency discipline in [006-Design-Principles.md](../architecture/006-Design-Principles.md) (`packages/collector` internal cohesion, not a new cross-package dependency).

## Edge Cases

- **A constructed sheet adopted by zero roots.** A `CSSStyleSheet` created via `new CSSStyleSheet()` but never assigned into any `adoptedStyleSheets` array is inert — it contributes nothing to any render tree and must not be discovered or extracted at all, since this discovery mechanism is driven entirely by walking `adoptedStyleSheets` arrays, never by, say, scanning JavaScript heap state for `CSSStyleSheet` instances (which would be both infeasible via standard automation protocols and a Principle-1 violation in spirit — the browser's render tree, not JS memory inspection, is the source of truth for "does this affect the page").
- **`@import` inside a constructed stylesheet.** The Constructable Stylesheets specification restricts `replaceSync`/`replace` from accepting `@import` rules in most implementations (constructed sheets are commonly restricted to import-free CSS, precisely because the synchronous constraction model doesn't accommodate the asynchronous fetch `@import` requires) — the walker's `extractRules` call for adopted sheets should therefore not expect to encounter `CSSImportRule` instances in practice, but the shared rule-dispatch core (Implementation Notes) handles it defensively as a no-op/diagnostic-only case rather than assuming its absence, in case a future specification revision or non-standard engine behavior permits it.
- **Constructed sheet adopted by both a document and one or more shadow roots simultaneously.** Fully supported by the dedup design in §9.3 — the sheet is extracted once, with `AdoptionSite` entries for both the document-level and every shadow-root-level adoption, each contributing its own scoped matching context downstream.
- **Shadow root removed from the DOM mid-session (SPA navigation, component unmount) between DOM Collector snapshot and CSSOM Walker pass.** Covered by the general snapshot-timing coordination requirement in Algorithms' Failure Cases; the engine's extraction model is defined relative to one stable snapshot, and both passes must operate against that same snapshot for the coordination guarantee to hold.
- **Cross-origin constructed stylesheets.** Constructable Stylesheets have no cross-origin fetch step at all — the sheet is constructed in-page from a string via `replaceSync`/`replace`, so there is no analogous "CORS-blocked" failure mode as in [306-At-Import.md](./306-At-Import.md) §8.5; a constructed sheet is either same-JS-realm-constructed (always readable) or it does not exist from this engine's perspective. This is a meaningful simplification relative to `@import` and top-level `<link>` handling and should not be conflated with them in diagnostics taxonomy.
- **Future CSS specifications: declarative Shadow DOM and adopted stylesheets serialization.** Ongoing specification work on Declarative Shadow DOM (`<template shadowrootmode>`) and related serialization proposals may eventually introduce markup-level ways to declare adopted stylesheets for SSR'd shadow trees; should such a mechanism ship, this document's discovery pass (reading `adoptedStyleSheets` after the browser has processed any declarative form into the live array) requires no structural change, since it already treats `adoptedStyleSheets` as the single authoritative, browser-resolved source regardless of how entries arrived there — a direct benefit of the browser-as-source-of-truth design (Principle 1) generalizing cleanly to a specification change that hadn't shipped yet at write time.

## Tradeoffs

| Design Choice | Cost Accepted | Benefit Gained | Chosen Because |
|---|---|---|---|
| Independent discovery pass hooked into DOM Collector's shadow-root visitation, not a standalone walk | Tighter coupling between CSSOM Walker and DOM Collector traversal timing | No duplicated shadow-root discovery cost; guaranteed timing consistency between the two views of the DOM | Duplicated, independently-timed walks risk disagreeing about which shadow roots exist at extraction time |
| Dedup by object reference identity, never content hash | Cannot "merge" two distinct sheets that happen to be byte-identical, even though doing so would reduce output size | Correctness: no false merging of sheets that are provably distinct objects and could diverge later via mutation | Content-equality is not the same claim as object-identity equality; conflating them is a category error the spec does not support |
| Run-scoped (global) dedup set rather than path-scoped like `@import`'s cycle detection | Slightly less general in the abstract (can't model per-adoption-site conditional re-walk) | Correct and simpler: `adoptedStyleSheets` carries no conditional context to vary per adoption site, so a global set loses nothing | `@import`'s path-scoping exists specifically to handle conditional-context variance that adopted sheets structurally cannot have |
| Extract once per distinct sheet, annotate with an `AdoptionSite` list rather than emitting N full copies | Downstream consumers (Selector Matcher, Cascade Resolver) must handle a rule-to-many-scopes relationship instead of a simple one-to-one | Massive extraction-cost savings for the common heavy-sharing case (component libraries); matches actual browser memory model (one parsed sheet, many adopters) | Emitting N copies for N adopters would be both wasteful and semantically wrong — it would imply N independent sheets where there is one |

## Performance

- **CPU complexity.** O(S_unique × R + A) as derived in Algorithms — extraction cost scales with distinct sheets, not adoption count, which is the key performance property that makes this design viable for large component-library pages.
- **Memory complexity.** O(S_unique × R) for extracted rule storage, O(A) for adoption-site edges; both are favorable relative to a naive per-adoption-site extraction, especially as sharing ratio (A / S_unique) increases.
- **Caching strategy.** The same rule-property-extraction memoization opportunity noted in [306-At-Import.md](./306-At-Import.md)'s Algorithms section applies here for free, since this discovery mechanism already extracts each distinct sheet exactly once; there is no separate caching layer needed for the dedup itself, only for run-to-run incremental caching (Principle 8), which must include adopted-sheet content in its fingerprint (see Implementation Notes below on fingerprint scope).
- **Parallelization opportunities.** Extraction of distinct adopted sheets is independent per sheet (Principle 3's permitted-parallelism criterion) and can be parallelized across worker threads exactly like independent `<link>`-sourced sheets; the shadow-root *discovery* walk itself, however, is inherently sequential with the DOM Collector's DFS (per §9.2's coupling rationale) and is not a parallelization target in isolation.
- **Incremental execution.** The Cache Manager's fingerprint computation (Principle 8) must include the resolved content of every adopted `CSSStyleSheet` discovered by this mechanism, not just `<link>`/`<style>`-sourced content — a change to a Lit component's constructed base stylesheet must invalidate the cache exactly as a change to a `<link>` stylesheet would, which requires this discovery pass (or an equivalent lightweight pre-pass) to run before fingerprinting, not only during full extraction.
- **Profiling guidance.** For component-library-heavy fixtures, profile the ratio of `A` (adoption edges) to `S_unique` (distinct sheets) directly — a high ratio confirms the sharing-aware design is paying off relative to a hypothetical naive per-site extraction, and a surprisingly low ratio (many near-identical but distinct sheets, e.g., per-instance-parameterized constructed sheets from a poorly-optimized CSS-in-JS setup) is itself a useful diagnostic signal worth surfacing in the Reporter, since it indicates the target application is not benefiting from the sharing the API was designed to enable.
- **Scalability limits.** The dominant scalability factor is total shadow-root count during DOM traversal (owned by [106-DOM-Snapshot.md](./106-DOM-Snapshot.md)'s scalability profile), not this document's dedup logic, which is linear and cheap relative to traversal cost.

## Testing

- **Unit tests.** Dedup correctness for a sheet adopted by document + N shadow roots (extracted exactly once, N+1 `AdoptionSite` records); reference-identity dedup does not falsely merge two distinct, content-identical sheets; `AdoptionSite.position` correctly reflects array order including reordering between runs (if a page dynamically reorders its `adoptedStyleSheets`, treated as a genuinely different extraction input per Principle 5's fingerprinting).
- **Integration tests.** A fixture using a Lit-style Web Component library with a shared base stylesheet adopted by multiple component instances across a Shadow DOM tree must produce exactly one extracted copy of the base sheet's rules, with correct per-scope selector-matching results for each shadow root's own light-DOM-equivalent content (verifying the §9.4 scoping requirement end-to-end).
- **Visual tests.** A fixture where an adopted sheet's rules are load-bearing for above-the-fold rendering inside a shadow root must show those rules present in the critical CSS output, cross-verified against `getComputedStyle()` results for elements inside that shadow root.
- **Stress tests.** A synthetic page with a very high adoption ratio (e.g., 1 shared sheet adopted by 5,000 component instances) must demonstrate that extraction cost does not scale with adoption count, confirming the O(S_unique × R + A) bound empirically (A's O(1)-per-edge cost should dominate wall-clock time negligibly relative to R-bound extraction).
- **Regression tests.** Golden-snapshot fixtures explicitly covering Shadow DOM + Constructable Stylesheets (per [006-Design-Principles.md](../architecture/006-Design-Principles.md)'s Testing section, which lists "Shadow DOM" among the mandatory golden-fixture categories) must be maintained as permanent regression coverage, since this is precisely the category of gap predecessor tools are documented to have missed.
- **Benchmark tests.** Any future optimization to the discovery pass (e.g., avoiding a full DOM Collector coupling for cases known in advance to have no shadow roots) must be benchmarked against the naive-correct baseline on a component-library-heavy fixture with a documented equivalence proof, per Principle 3.

## Future Work

- Investigate whether Declarative Shadow DOM's eventual stylesheet-adoption serialization proposals (still evolving in the specification process at time of writing) require any change beyond "read `adoptedStyleSheets` after the browser processes the declarative form," per the Edge Cases discussion — likely no structural change needed, but worth revisiting once a concrete specification lands.
- Explore whether the Reporter (Phase 2/Phase 4 scope) should surface a dedicated "adoption ratio" metric (A / S_unique, per the Performance section's profiling guidance) as a first-class diagnostic for component-library-heavy sites, to help teams understand how much their build is benefiting from stylesheet sharing versus accidentally defeating it (e.g., via per-instance-parameterized CSS-in-JS output that constructs a nominally-shared-looking but actually-distinct sheet per instance).
- Research whether a future CDP/Playwright API could expose a direct "list all constructed stylesheets reachable from this frame" primitive that would make discovery independent of walking every shadow root individually — would reduce coupling to DOM Collector traversal timing (§9.2) if such a primitive existed, though none is known to exist at time of writing.
- Open question: should this engine's Coverage-mode strategy (Phase 3, per [ADR-0005](../architecture/ADR-0005-Hybrid-Extraction-Mode.md)) treat adopted-stylesheet rules identically to `<link>`-sourced rules for Coverage API attribution purposes, or does the Chrome DevTools Coverage domain have any documented difference in how it attributes paint-time rule usage to constructed versus traditionally-sourced sheets? This needs empirical verification against the Coverage API's actual behavior before Phase 3's Coverage Engine design is finalized, and is flagged here as a dependency for that future document.

## References

- [006-Design-Principles.md](../architecture/006-Design-Principles.md) — Principle 1 (Browser Is Source of Truth) and its explicit Constructable Stylesheets Edge Case callout
- [002-Problem-Statement.md](../architecture/002-Problem-Statement.md) — the general thesis on static-approximation divergence, applied here to a modern component-library-specific instance
- [300-CSSOM-Walker.md](./300-CSSOM-Walker.md) — base traversal algorithm this discovery pass augments
- [301-Stylesheet-Loader.md](./301-Stylesheet-Loader.md) — the structurally parallel, non-overlapping `document.styleSheets` discovery mechanism
- [302-Rule-Tree.md](./302-Rule-Tree.md) — IR that adopted-sheet-derived rules and their `AdoptionSite` metadata attach to
- [306-At-Import.md](./306-At-Import.md) — sibling CSSOM Walker extension for a structurally disjoint discovery gap
- [106-DOM-Snapshot.md](./106-DOM-Snapshot.md) — Shadow DOM handling during DOM traversal, whose shadow-root enumeration this document's discovery hooks into
- CSSOM specification (W3C) — `CSSStyleSheet` constructor, `replace`/`replaceSync`
- Constructable Stylesheets specification / CSSOM extension (WICG/W3C) — `adoptedStyleSheets` on `Document` and `ShadowRoot`
- Shadow DOM specification (WHATWG DOM) — shadow-root style encapsulation and scoping semantics
- Lit and Stencil project documentation — representative real-world usage patterns of Constructable Stylesheets for component style sharing, referenced conceptually in §9.5
