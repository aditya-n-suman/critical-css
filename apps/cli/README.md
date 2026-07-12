# @critical-css/cli

CLI orchestration (AT-11, M1 MVP).

```
critical-css-engine extract --url <url> [--viewport desktop|tablet|mobile] [--output <path>]
```

- CSS payload → stdout (or `--output` file); diagnostics + stats → stderr.
- Exit codes: `0` success, `1` extraction failure (attributed diagnostic on stderr), `2` usage error.
- Pipeline: `BrowserManager.acquire(profile)` → navigate + stabilize → `collect` (DOM + CSSOM)
  → `SelectorMatcher.matchRules` → `serialize` → emit. Single-viewport runs the identical
  merge/serialize path as multi-viewport (016 §12).
- Programmatic API: `extract({ url, viewport })` from `@critical-css/cli` (REQ-400).

M1 deferrals: route manifest, cache gate, plugin hook dispatch (no-op),
`--compare-baseline`, minification (pass-through).

## Golden baseline

```
node apps/cli/dist/main.js extract --url <fixture-url> --output fixtures/golden/<name>.css
```

Golden files are byte-exact; regenerate only with a reviewed justification
(docs/testing/003-Golden-Files.md §8.3).
