# @critical-css/collector

Collection layer (AT-03, M1 slice: DOM Collector + CSSOM Walker; the Visibility
Engine sub-module lands in M2).

## Public API

| Export | Purpose |
|---|---|
| `collect(handle)` | Combined single-pass collection: DOM snapshot + CSSOM walk against the same stabilized page, correlated by one shared `snapshotId` (016 §8.4) |
| `CssomWalker.walk(handle, snapshotId)` | In-page traversal of `document.styleSheets` and every nested CSSRuleList — one `evaluate()` round trip, zero CSS text parsing (ADR-0001/0002). Cross-origin sheets → `accessible: false` + `CROSS_ORIGIN_STYLESHEET_SKIPPED` diagnostic |
| `DomCollector.collect(handle, snapshotId)` | Above-fold DOM capture (delegates to `@critical-css/browser`'s DOMSnapshot); injects the `data-ccss-id` correlation attribute consumed by the matcher |
| `CssomRuleList` / `StylesheetRecord` / `RuleNode` | Rule-tree DTOs per docs/design/300/302: rule identity is `(sourceStylesheetIndex, ruleIndexPath)`; at-rule conditions are captured verbatim (not evaluated — M2) |

M1 deferrals: `@import` recursion (306), `adoptedStyleSheets`/shadow roots (307),
media/supports evaluation (303/304), layer rank registry (305).
