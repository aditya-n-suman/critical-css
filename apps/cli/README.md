# @critical-css/cli

CLI orchestration (AT-11, M1 MVP).

```
critical-css-engine extract --url <url>
  [--viewport desktop|tablet|mobile] [--viewports d,t,m]
  [--mode cssom|coverage|hybrid] [--minify]
  [--format raw-css|inline-style|json-envelope]
  [--output <path>] [--report <path>]
```

- CSS payload → stdout (or `--output` file); diagnostics + stats → stderr.
- Exit codes: `0` success, `1` extraction failure (attributed diagnostic on stderr), `2` usage error.
- Pipeline (per viewport): `acquire(profile)` → [`startCoverage` if coverage/hybrid] →
  navigate + stabilize → `collect` (DOM + CSSOM) → `classifyVisibility` →
  `matchRules` / coverage → hybrid reconcile → `FixedPointResolver` → per-viewport rules.
  Then `mergeViewports` across profiles → `serialize`. Six plugin hook seams dispatched in order.
- `--mode`: `cssom` (default), `coverage` (CDP-only, no matcher), `hybrid` (composes both;
  coverage upgrades/flags, never drops a CSSOM match). Coverage degrades to CSSOM on non-Chromium.
- `--viewports d,t,m`: run each viewport independently and merge (viewport-specific rules get a
  synthetic width-band `@media`; rules matched in all viewports stay unconditional).
- `--report <path>`: write the per-viewport report bundles (matched/unmatched/timing/contribution
  + dependency-graph) as JSON.
- Programmatic API: `extract({ url, viewports, mode, minify, format, plugins })` from `@critical-css/cli`.

Deferrals: route manifest / cache gate / `--compare-baseline` (M4); source maps (605);
`apps/visualizer` (M5).

## Golden baseline

```
node apps/cli/dist/main.js extract --url <fixture-url> --output fixtures/golden/<name>.css
```

Golden files are byte-exact; regenerate only with a reviewed justification
(docs/testing/003-Golden-Files.md §8.3).
