# @critical-css/reporter

Diagnostics reporter (AT-10). A **pure sink**: reads terminal pipeline outputs
by reference and never mutates them.

## Public API

`Reporter.build(input): ReportBundle` produces the four M3 reports plus the
dependency-graph JSON (REQ-460):

| Report | Source | Notes |
|---|---|---|
| `matchedSelectors` | matcher `CssomRuleMatch[]` | selector + stylesheet href + matched node count |
| `unmatchedSelectors` | all source style rules − matched | identity `(stylesheetIndex, ruleIndexPath)` (1000 §10.2) |
| `timing` | per-stage `StageTiming[]` | sums to `totalMs` |
| `stylesheetContribution` | matched rules grouped by stylesheet | retained/total rule counts + byte contribution |
| `dependencyGraph` | resolved `DependencyGraph` (or manifest) | nodes + edges, deterministic JSON |

`Reporter.toJson(bundle)` renders a bundle to deterministic JSON.

**M3 scope:** the four required reports + dep-graph JSON only. Extraction trace
(1003), HTML visualization overlay (1004), and the `apps/visualizer` Debug UI
(1005) are M5.
