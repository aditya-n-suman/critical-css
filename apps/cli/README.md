# @critical-css/cli

CLI orchestration (AT-11, M1 MVP).

```
critical-css-engine extract --url <url>
  [--viewport desktop|tablet|mobile] [--viewports d,t,m]
  [--mode cssom|coverage|hybrid] [--minify]
  [--format raw-css|inline-style|json-envelope]
  [--output <path>] [--report <path>]
  [--sandbox-policy full|ci-container|unsafe-no-sandbox]
  [--config <path>]
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
- `--sandbox-policy` (101 §8.8): Chromium launch sandboxing. `full` (default) — no launch args,
  requires user namespaces (fails with `BROWSER_ACQUISITION_FAILED` in some restrictive
  containers). `ci-container` — adds `--disable-dev-shm-usage`, sandbox retained. `unsafe-no-sandbox`
  — adds `--no-sandbox --disable-dev-shm-usage`; disables a security boundary, so it is never
  auto-detected and must be requested explicitly (flag or `CRITICAL_CSS_SANDBOX_POLICY` env var,
  flag wins). No effect on firefox/webkit engines.
- Programmatic API: `extract({ url, viewports, mode, minify, format, plugins, sandboxPolicy })`
  from `@critical-css/cli`.
- `--config <path>` (010 §8.1, 011): a JSON file supplying defaults for any of `url`, `viewport`
  (single, alias of `viewports`), `viewports`, `mode`, `output`, `report`, `minify`, `format`,
  `sandboxPolicy`. Unknown keys or invalid values are a usage error (exit `2`), validated before
  any browser launches. Precedence, most to least specific: **CLI flag > config file >
  `CRITICAL_CSS_SANDBOX_POLICY` env var (sandboxPolicy only) > built-in default.** Example:
  ```json
  {
    "url": "https://example.com/page",
    "viewport": "mobile",
    "mode": "cssom",
    "minify": true
  }
  ```
  ```
  critical-css-engine extract --config critical-css.json --viewport desktop
  ```
  overrides the config's `mobile` with `desktop` for this one run; everything else comes from the file.

Deferrals: route manifest / cache gate / `--compare-baseline` (M4); source maps (605);
`apps/visualizer` (M5).

## Golden baseline

```
node apps/cli/dist/main.js extract --url <fixture-url> --output fixtures/golden/<name>.css
```

Golden files are byte-exact; regenerate only with a reviewed justification
(docs/testing/003-Golden-Files.md §8.3).
