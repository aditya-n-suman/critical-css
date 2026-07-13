# @critical-css/cli

CLI orchestration (AT-11, M1 MVP + M4 CI pipeline).

```
critical-css-engine extract (--url <url> | --routes <manifest.json> --base-url <origin>)
  [--viewport desktop|tablet|mobile] [--viewports d,t,m]
  [--mode cssom|coverage|hybrid] [--minify]
  [--format raw-css|inline-style|json-envelope]
  [--output <path>] [--report <path>] [--out-dir <dir>]
  [--sandbox-policy full|ci-container|unsafe-no-sandbox]
  [--cache-dir <dir>] [--no-cache]
  [--compare-baseline <path>] [--write-baseline <path>] [--max-growth <percent>]
  [--config <path>]
```

- CSS payload → stdout (or `--output` file); diagnostics + stats → stderr.
- Exit codes: `0` success, `1` extraction failure (attributed diagnostic on stderr), `2` usage
  error, `3` CI baseline gate failed (`--compare-baseline`: CSS grew beyond `--max-growth`, or
  missing dependencies were detected). Extraction errors take precedence over gate failures.
- Pipeline (per viewport): `acquire(profile)` → [`startCoverage` if coverage/hybrid] →
  navigate + stabilize → `collect` (DOM + CSSOM) → `classifyVisibility` →
  `matchRules` / coverage → hybrid reconcile → `FixedPointResolver` → per-viewport rules.
  Then `mergeViewports` across profiles → `serialize`. Six plugin hook seams dispatched in order.
- `--mode`: `cssom` (default), `coverage` (CDP-only, no matcher), `hybrid` (composes both;
  coverage upgrades/flags, never drops a CSSOM match). Coverage degrades to CSSOM on non-Chromium.
- `--viewports d,t,m`: run each viewport independently and merge (viewport-specific rules get a
  synthetic width-band `@media`; rules matched in all viewports stay unconditional).
- `--report <path>`: write the per-viewport report bundles (matched/unmatched/timing/contribution
  + dependency-graph) as JSON. With `--cache-dir`, a run that requests `--report` also persists
  the bundles into the cache entry, so a later cache hit rewrites the report without a browser.
  A hit against an entry written *without* `--report` cannot reconstruct the bundles: the report
  is skipped with a loud `REPORT_UNAVAILABLE_ON_CACHE_HIT` warning on stderr (rerun with
  `--no-cache` to regenerate).
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
  The M4 CI keys are also accepted: `cacheDir`, `noCache`, `routes`, `baseUrl`, `outDir`,
  `compareBaseline`, `writeBaseline`, `maxGrowth`.

## Incremental cache (M4, 800/801/802)

- `--cache-dir <dir>` enables the persistent disk cache. Before any browser launches, the page's
  HTML plus every referenced stylesheet (`<link rel="stylesheet">` + recursive `@import`) is read
  over plain HTTP/file I/O and content-hashed into the canonical 801 fingerprint
  (`computeCacheFingerprint` from `@critical-css/cache`; the output-affecting config subset —
  viewport set, minify, format — rides `engineVersion` as a digest per 801 §8.1.5). A hit serves
  the cached CSS **without launching Chromium** (REQ-301); a miss/stale extracts fresh and stores.
  An unreadable fingerprint input fails closed: that work unit extracts fresh, uncached, with a
  `CACHE_FINGERPRINT_UNAVAILABLE` warning. Hit/miss counts are printed on stderr per run.
- `--no-cache` force-disables lookups and stores while keeping the cache observable (800 §12).
- Known approximation (704 §14 recorded): asset discovery is a link-tag + `@import` scan, so a
  page whose only CSS change is inside a JS-injected stylesheet fingerprints unchanged (false
  hit). Use `--no-cache` for such pages.

## Route manifest + CI baseline gate (M4, BRIEF §2.9/§2.11, 803)

- `--routes <manifest.json>` runs a batch: a JSON object mapping route pattern → output filename
  (compact form) or `{ outputName, sampleUrls?, shareGroup?, paramsInFingerprint? }` (rich form).
  Wildcard patterns (`/blog/*`, `/docs/:section`) need at least one `sampleUrls` entry — the first
  sample is the representative URL extracted for the whole route group (803 §8.1). Patterns
  resolve against `--base-url` (required); artifacts are written under `--out-dir` (default `.`).
  Output names must stay inside `--out-dir`: absolute paths and relative paths that escape it
  (e.g. `../../etc/x.css`) are rejected at manifest load as usage errors (exit `2`).
  Every work unit is attempted; failures are reported after the whole batch (REQ-453). One
  browser manager is shared across the batch — an all-hits batch never spawns Chromium.
  ```json
  { "/": "home.css", "/blog/*": { "outputName": "blog.css", "sampleUrls": ["/blog/first-post"] } }
  ```
- `--write-baseline <path>` records the produced byte size per route/URL (sorted JSON, meant to
  be committed). Not written if the batch had extraction failures, and not written if the
  `--compare-baseline` gate failed — a failing run never overwrites the baseline it failed
  against (a skip note is printed on stderr).
- `--compare-baseline <path>` gates the run against a committed baseline: any artifact growing
  strictly more than `--max-growth <percent>` (default `5`) fails the build with exit code `3`,
  as does any detected missing dependency (`MISSING_*` diagnostics). New/removed routes are
  warnings — refresh the baseline with an explicit, reviewed `--write-baseline`.

Deferrals: source maps (605); `apps/visualizer` (M5); visual-diff harness (G4).

## Golden baseline

```
node apps/cli/dist/main.js extract --url <fixture-url> --output fixtures/golden/<name>.css
```

Golden files are byte-exact; regenerate only with a reviewed justification
(docs/testing/003-Golden-Files.md §8.3).
