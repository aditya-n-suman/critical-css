# @critical-css/reporter

Diagnostics reporter (AT-10). A **pure sink**: reads terminal pipeline outputs
by reference and never mutates them.

## Public API

`Reporter.build(input): ReportBundle` produces the five M3 reports plus (M5)
the extraction trace — the full §2.12 diagnostics set:

| Report | Source | Notes |
|---|---|---|
| `matchedSelectors` | matcher `CssomRuleMatch[]` | selector + stylesheet href + matched node count |
| `unmatchedSelectors` | all source style rules − matched | identity `(stylesheetIndex, ruleIndexPath)` (1000 §10.2) |
| `timing` | per-stage `StageTiming[]` | sums to `totalMs` |
| `stylesheetContribution` | matched rules grouped by stylesheet | retained/total rule counts + byte contribution |
| `dependencyGraph` | resolved `DependencyGraph` (or manifest) | nodes + edges, deterministic JSON |
| `extractionTrace` | the above, restructured as an OTel-compatible span tree | see below; docs/design/1003-Tracing.md |

`Reporter.toJson(bundle)` renders a bundle to deterministic JSON.

**Scope:** the four M3 reports + dep-graph JSON, plus (M5) the extraction
trace — all six §2.12 diagnostics. HTML visualization overlay (1004) and the
`apps/visualizer` Debug UI (1005) remain out of this package's scope.

## Extraction trace (`extractionTrace`, M5 crit-1)

`buildExtractionTrace` (in `src/trace.ts`, re-exported from the barrel) turns
the same data the other five reports are built from into a flat, OTLP-shaped
`Span[]` list (docs/design/1003-Tracing.md §8.1/§10.2 — OTLP is a flat list of
spans with parent pointers, not a nested tree): one `run` span → one `route`
span → one `viewport` span → one `stage` span per real `StageTiming` entry
(in emission order, cumulative offsets = the real measured `elapsedMs`
durations) → `decision` spans (zero-duration, per 1003 §8.4's "the decision is
the instantaneous fact") carrying `rule.matched`/`rule.excluded` events for
every matched/unmatched selector row, and `dependency.included` events for
every dependency-graph edge.

**`runId`/`traceId`/`spanId` derivation.** `ReportInput.runId` is optional
(falls back to a deterministic `run-${route}-${viewportProfileId}` when the
caller doesn't supply one, for backward compatibility; `apps/cli/src/extract.ts`
always supplies one, derived the same way — `run-${route}-${viewportName}` —
so that two different routes processed at the same viewport in one batch
never collide, A1). `traceId` is a deterministic hash of `runId` (not the
identity-transform-of-a-UUID 1003 §8.1 describes — see "Doc tensions" below).
`spanId`s are also deterministic hashes of a canonical descriptor, not
random — this makes *rebuilding the same work-unit's trace from the same
inputs* reproduce byte-identical span IDs (what golden/snapshot tests rely
on). It does **not** make two independently-built traces collapse onto
shared ancestor spans: since `runId` folds in both `route` and
`viewportProfileId`, every work-unit (one route × one viewport) gets its own
distinct `run`/`route`/`viewport` spans — even two viewports of the *same*
route do not share a `route` span. Each `ExtractionTraceReport` stays scoped
to one work-unit (1000 §11); composing several work-units' traces into one
batch-level tree is a consumer concern, not something this package's ID
scheme does for you.

**Serialization is attached after the fact.** `withSerializationStage(bundle,
elapsedMs, assembledAt)` adds the one pipeline stage that is genuinely
cross-viewport in this engine (`serialize()` runs once, after
`mergeViewports` combines every viewport — apps/cli/src/extract.ts) as a
`stage` span parented at each bundle's own `route` span. This is called once
per viewport bundle, right after the real `serialize()` timing is measured,
in `apps/cli/src/extract.ts`.

**Truthfully-unavailable data (Hard Rule 1 — never fabricate a diagnostic).**
As of M5:
- No `visibilityReason` on `rule.excluded` events — the Visibility Engine's
  per-node reason codes never reach this package.
- No `cacheHit` on selector decision events — selector memoization
  (401-Selector-Memoization.md) does not yet expose a per-selector flag on
  `CssomRuleMatch`.
- No cache decision events (`cache.hit`/`cache.miss`, 1003 §8.4.3) at all —
  the route cache lookup happens in `apps/cli`, entirely outside the
  pipeline stages a `ReportBundle` observes; a cache HIT skips the pipeline
  (and this trace's construction) altogether, exactly as it already does for
  the other five reports (a hit replays the *persisted* report JSON, trace
  included, rather than rebuilding it — see apps/cli/src/run.ts).
- Decision spans are zero-duration by construction (no per-selector /
  per-edge timing exists upstream to measure) — a documented simplification,
  not a fabricated measurement.

**Doc tensions for the orchestrator (docs/design/1003-Tracing.md vs. this
implementation):**
1. §8.1 assumes `runId` is a UUIDv4 and derives `traceId` as the identity
   transform of its raw bytes. This engine's `runId`
   (`run-${route}-${viewportName}`, from `apps/cli/src/extract.ts`) is not a
   UUID and is generated per work-unit (route × viewport), not once per CLI
   invocation ("one CI invocation, potentially spanning many routes and
   viewports" — §3). `traceId` is therefore a
   deterministic hash instead, and each work-unit currently gets its own
   `run` span rather than one shared run span spanning a full multi-route
   batch. Composing multiple work-units' traces under one true batch-level
   run span is future work, consistent with how 1000 §11 already scopes
   `ReportBundle` itself to one work-unit and defers cross-work-unit
   aggregation to the caller.
2. §7's mermaid diagram nests all five pipeline-stage spans (including
   serialization) under each viewport span. In this engine's real
   architecture, serialization runs once across all viewports post-merge, so
   it is instead nested as a sibling of the viewport spans, under the route
   span (see `withSerializationStage` above) — disclosed here rather than
   silently deviating from the diagram.
3. §10.1's `generateSpanId()` is specified as random; this implementation
   uses deterministic hashing instead (see above), which is a strict
   superset of the design's requirements (still a valid, unique-enough OTel
   span ID) chosen deliberately for cross-bundle mergeability and
   reproducible tests.
