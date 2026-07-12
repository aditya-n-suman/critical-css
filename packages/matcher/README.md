# @critical-css/matcher

Selector matching (AT-04, M1 slice). `element.matches()` inside one batched
in-page `evaluate()` is the ONLY matching primitive (ADR-0002) — no selector
parsing library may ever enter this dependency tree.

## Public API

| Export | Purpose |
|---|---|
| `SelectorMatcher.matchRules(handle, dom, cssom, viewportProfileId)` | Matches every style rule against the above-fold node set (resolved via the injected `data-ccss-id` attributes). Returns `MatchedRuleSet` with join keys carried unchanged (016 §11) and a `STABILITY_VIOLATION` warning on snapshotId mismatch |
| `splitSelectorList` | Top-level comma split — sanctioned delimiter bookkeeping; never splits inside `:is()/:where()/:has()`, brackets, or quotes |
| `extractBaseSelector` | Strips a trailing pseudo-element to its host base selector (402); the verbatim selector is what gets serialized |

Behavior notes: dynamic pseudo-classes (`:hover` …) correctly report false at
snapshot time — excluded by design with a `DYNAMIC_PSEUDO_CLASS_EXCLUDED_BY_DESIGN`
diagnostic (403). A `matches()` throw becomes an `UNSUPPORTED_SELECTOR` diagnostic,
never a silent false. M1 ships the naive O(nodes×rules) baseline; memoization is 401/M2.
