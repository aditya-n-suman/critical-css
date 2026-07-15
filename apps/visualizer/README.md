# @critical-css/visualizer

The interactive multi-run debug UI (`docs/design/1005-Debug-UI.md`), plus the
1004 fold-overlay generator it embeds (`docs/design/1004-Visualization.md`).
A **thin, read-only consumer** of `@critical-css/reporter` output: it never
imports `packages/browser`, `packages/collector`, `packages/matcher`,
`packages/dependency-graph`, or `packages/serializer`, and it never
re-implements any part of extraction (1005 §7.2). Its only dependency-graph
edges into this monorepo's `packages/` are `@critical-css/reporter` (DTOs)
and `@critical-css/shared`.

## Quick start

```bash
# from the repo root, with node v20 on PATH
pnpm install
pnpm --filter @critical-css/visualizer build

# generate real sample data (spins up a throwaway HTTP server over
# fixtures/ci-project and shells out to apps/cli as a subprocess — never an
# in-process import, see scripts/generate-sample-data.mjs's header comment)
pnpm --filter @critical-css/visualizer generate-sample-data

# serve the debug UI against that sample data
node apps/visualizer/dist/cli.js serve \
  --report-dir apps/visualizer/.sample-data/reports \
  --css-dir apps/visualizer/.sample-data/out
# → critical-css visualizer serving at http://127.0.0.1:4600
```

Open `http://127.0.0.1:4600` in a browser. Flags: `--report-dir <dir>`
(required), `--css-dir <dir>` (optional, powers the side-by-side view's
critical-CSS pane), `--port <n>` (default 4600), `--host <h>` (default
`127.0.0.1` — bound to loopback only, per 1005 §11, unless overridden).

To point the server at real extraction output instead of the fixture:
`apps/cli extract --routes <manifest> --base-url <origin> --report-dir <dir> --out-dir <dir>`,
then `serve --report-dir <dir> --css-dir <dir>`.

## What each view shows

| View | Route | Source data | Notes |
|---|---|---|---|
| Route/viewport picker | `/` | `ReportBundle[]` scanned from `--report-dir` | Free-text route search + exact viewport/mode filter (form submit, not live client JS) |
| Run detail | `/run/:id` | one `RunRecord` | Links to every sub-view below |
| Matched/unmatched selectors | `/run/:id/matched` | `matchedSelectors`/`unmatchedSelectors` | Grouped by source stylesheet; unmatched rows carry the one genuinely-derivable "why" hint |
| Dependency graph explorer | `/run/:id/graph` | `dependencyGraph` | Layered-DAG (Kahn's algorithm) layout, rendered as SVG; surfaces a cycle via a banner rather than crashing |
| Timing waterfall | `/run/:id/waterfall` | `extractionTrace.spans` | One bar per `stage` span; `decision` spans roll up into a per-stage count, since they're zero-duration |
| Side-by-side render | `/run/:id/side-by-side` | live fetch of `bundle.route` + (if `--css-dir` given) the CLI's serialized critical CSS | Never a re-extraction — degrades to a clear "could not fetch" state if the route is unreachable |
| Fold overlay (embedded) | `/run/:id/overlay` | `overlay.ts` (below), fed the same live-fetched page HTML | Embeds the 1004 artifact this package also generates as a library function |

## Data model and its gap vs 1004/1005

`docs/design/1004-Visualization.md` and `docs/design/1005-Debug-UI.md` are
both written against a richer upstream contract than this milestone's
`@critical-css/reporter` actually produces:

- **1004/1005 assume a `DiagnosticsBundle`** carrying a `DomSnapshot`
  (per-node bounding boxes), a `foldY` scalar (105 §8.3), and per-node
  `VisibilityAnnotation`s (`reasonPrimary`/`reasonChain`, the 200-series
  taxonomy). **`packages/reporter`'s actual `ReportBundle`
  (`src/reports.ts`) has none of these.** No DOM snapshot, no fold
  coordinate, no visibility classification survives past the pipeline's
  internal Visibility Engine into any artifact this app can read. This is
  also disclosed in `packages/reporter/src/trace.ts`'s own header comment
  for the identical gap on trace events.
- **Consequence for the 1004 overlay (`src/overlay.ts`):** it cannot draw a
  fold line, cannot render a DOM-mirror overlay of positioned boxes, and
  cannot color-code nodes by `reasonPrimary`. What it *can* do, genuinely: if
  the caller supplies the original page HTML, it injects the real matched
  selectors (verbatim `selectorText` from the Matcher's own matched-rule
  records) as CSS outline rules, so highlighting is a **real browser
  evaluating a real selector**, not a fabricated position. Every artifact
  states this gap in a visible banner, not just in this README.
- **Consequence for 1005 §8.3.2 (side-by-side):** the spec's two iframes both
  come from a cached `CacheEntry`, but `packages/cache`'s `CacheEntry`
  persists only the critical-CSS text, never the original page HTML, and
  `ReportBundle` carries neither. `viewmodel/side-by-side.ts`'s
  `buildCriticalHtml` therefore takes both `pageHtml` and `criticalCss` as
  explicit inputs; `server.ts` supplies `pageHtml` via a live fetch of
  `bundle.route` and `criticalCss` via an optional `--css-dir` (the CLI's
  `--out-dir` output) — export mode (see "Scope cuts" below) cannot do
  either, since there is no live origin or bundled output to read from a
  static snapshot.
- **Consequence for 1005 §8.3.4 (unmatched-selector browser):** the spec
  wants a "why unmatched" hint drawn from a reason taxonomy ("excluded by
  visibility", "excluded by plugin rule"). `UnmatchedSelectorRow` carries
  none of that provenance — it is exactly "every source style rule minus
  matched" (1000 §10.2). The hint this app shows is the one fact genuinely
  derivable: no element matched the selector.
- **Consequence for 1005 §10.1 (run-index staleness/regression flags):**
  those require 801 fingerprint recomputation against current source and a
  baseline snapshot, neither of which this milestone's adapter reads (see
  "Scope cuts"). `RunSummary` omits both fields rather than fabricating them.

## Scope cuts vs 1005 (this session)

- **No `CacheStore`/`CacheAdapter`.** Every fact rendered comes from
  `--report-dir` JSON (`adapters/report-store.ts`), never from
  `packages/cache` directly — a deliberate, disclosed narrowing of 1005
  §8.4's five-adapter design to the one adapter this milestone's CLI output
  actually supports.
- **No live filesystem polling / push updates (1005 §7.3, §12).** The dev
  server re-scans `--report-dir` on every request instead of polling on an
  interval; simpler, and still shows new runs on the next request.
- **No `RerunTrigger` (1005 §8.2).** The "trigger re-run from the UI"
  subprocess affordance is not implemented. `sample-data` generation and any
  real extraction both remain a separate, explicit `apps/cli` invocation.
- **No export/static-bundle mode (1005 §7.3/§8.6).** Only dev mode (`serve`)
  is implemented this session.
- **No dependency-graph clustering/collapsing (1005 §10.2/§8.5).** Large
  graphs are flagged via `LayoutResult.collapsed` but always rendered
  uncollapsed; the clustering strategy itself is future work.
- **No client-side JS.** Every view is server-rendered per request
  (including picker filtering, via a plain HTML form). This keeps the
  package dependency-free (no bundler, no framework) at the cost of a full
  page reload per interaction — acceptable for a local debug tool at this
  milestone's scale.

## Testing

`pnpm --filter @critical-css/visualizer test` runs the unit suite under
`test/`, including the dev server, against real `ReportBundle` JSON captured
under `test/fixtures/reports/` (generated once via `generate-sample-data.mjs`
against `fixtures/ci-project` and committed, so tests don't need a browser
binary at test time) plus small hand-built fixtures for edge cases (cycles,
dangling edges, malformed report files).

## Public API

The barrel (`src/index.ts`) exports:

- `loadReportDir(reportDir)` — the report-store adapter.
- `buildRunIndex` / `filterRunIndex` — picker view-model.
- `buildMatchedRuleGroups` — matched-selector grouping (feeds the 1004 overlay).
- `buildUnmatchedRuleGroups` / `filterUnmatchedRows` — unmatched-selector browser view-model.
- `layoutDependencyGraph` — dependency-graph explorer layout.
- `buildCriticalHtml` — side-by-side critical-CSS render.
- `buildWaterfall` / `compareWaterfalls` — timing waterfall view-model.
- `buildOverlayHtml` — the 1004 fold-overlay HTML generator.

`serve()`/`createVisualizerServer()` (`src/server.ts`) and the `cli.ts` entry
point are not re-exported through the barrel (they are the app's own
executable surface, not a library API another package would import).
