# @critical-css/coverage

Coverage-mode extraction (AT-05). Uses the browser's Chromium CSS-coverage
(CDP `CSS.startRuleUsageTracking`, exposed through `PageHandle.startCoverage()`).

**Hard invariant (ADR-0005 / design principle 4):** depends ONLY on
`@critical-css/browser` + `@critical-css/shared` — **never** `matcher` or
`collector`. The Hybrid composer in `@critical-css/dependency-graph` is the
single sanctioned point that composes coverage + matcher output.

## Public API

| Export | Purpose |
|---|---|
| `CoverageCollector.collect(handle, raw)` | Maps a stopped session's `RawCssCoverage` to `{ usedRuleKeys, unusedRuleKeys, diagnostics }`. Re-enumerates style rules in-page (browser-truth, no collector import) and tests each rule's `selectorText` offset against the used byte ranges |
| `sheetKeyFor(href, docIndex)` | Rule-key stylesheet component: `href` or `inline#<docIndex>` |

Rule key = `${sheetKey}:${styleRuleOrdinal}`, ordinal = document-order index
among style rules — the same scheme the CSSOM walker uses, so keys
set-intersect with matcher output downstream.

**M3 mapping-precision limit:** used ranges are matched to rules by locating
each rule's verbatim `selectorText` in the source text (string search, not a
parser — ADR-0002-safe) and testing range membership. Approximate for
whitespace-divergent/minified/duplicated selectors; unlocatable selectors are
conservatively marked used. Safe in hybrid mode where coverage only
upgrades/flags, never drops a CSSOM match (701 fidelity bias). Chromium-only;
non-Chromium engines throw `CAPABILITY_UNAVAILABLE`.
