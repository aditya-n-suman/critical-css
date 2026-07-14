# @critical-css/visual-diff

The **G4 visual-diff capability and CI gate** (M4 exit criterion 3). Implements
the dual-render pixel-diff mechanism of [`docs/design/703-Visual-Diff.md`](../../docs/design/703-Visual-Diff.md)
and its test-suite application in [`docs/testing/002-Visual-Tests.md`](../../docs/testing/002-Visual-Tests.md).

Depends on `@critical-css/browser` + `@critical-css/shared`. Never imports
`@critical-css/matcher` ↔ `coverage` (irrelevant here). Raw Playwright never
crosses the boundary — all rendering goes through `PageHandle`.

## What it does

For each `(fixture, viewport)`, it renders the page twice under conditions that
differ **only** in CSS (703 §8.2 controlled-variable discipline):

- **R_full** — the page with its original CSS intact (ground truth).
- **R_crit** — the same page with the original stylesheets stripped and the
  extracted critical CSS inlined in a `<head>` `<style>`, exactly as the SSR
  adapter would ship it (703 §8.1 / §11).

Both are frozen identically (`animation/transition: none`, caret hidden,
`scrollbar-gutter: stable`, dynamic regions stubbed), screenshot only after
stabilization + `fonts.ready` (via the existing `PageHandle.navigate`
stabilization monitor), and cropped to the fold region (`[0,0,width,fold]`,
703 §8.3). The two crops are pixel-diffed.

## Two questions, one algorithm

| | 703 parity (`runParityTest`) | 002 baseline (`runBaselineTest`) |
|---|---|---|
| Compares | R_full vs R_crit, both rendered now | current R_full vs a committed baseline PNG |
| Answers | "is this extraction's critical CSS sufficient?" | "has this fixture's rendering drifted?" |
| Verdict | PASS / FAIL | PASS / FAIL / NEW_BASELINE_REQUIRED |

Both reuse the same noise-tolerant `visualDiff()` (703 §10.1) — a perceptual,
**anti-aliasing-aware** comparison via `pixelmatch` over `pngjs`-decoded
rasters, thresholded on the *count* of non-AA differing pixels (`maxDiffRatio`,
default `0.001`; `perceptualThreshold` `0.1`; `includeAA` `false`). Dimension
mismatch and failed-to-paint (all-background) renders are distinct verdicts,
never a silent PASS (703 §10.1 failure cases).

> **Dependency note.** `pixelmatch` + `pngjs` are a **test/CI-scope image-diff
> dependency**, not part of the ADR-0001 core stack. 703 §8.4/§10.1/§17 name
> the `pixelmatch`/Blink-diff family and the Yang et al. AA heuristic as the
> intended prior art, so this is the standard lightweight choice the design
> deliberately left open — not a core-stack deviation requiring an ADR.

## CI gate

The gate is wired as a **required test-suite gate** (002 §8.4 is the authority
on hard-vs-soft gating; default is hard-fail). `test/visual-gate.test.ts` runs
the committed case matrix and asserts every parity + baseline verdict is PASS;
a FAIL fails `pnpm test` with a non-zero exit. The gate logic is also exposed
programmatically for CI scripts that want the numeric contract:

| `VISUAL_GATE_EXIT` | Meaning |
|---|---|
| `0` PASS | all parity + baseline diffs within threshold |
| `4` DIFF_FAILED | a parity or baseline diff exceeded threshold (dropped/wrong rule, or drift) |
| `5` BASELINE_REQUIRED | a case has no committed baseline (hard gate: needs review) |
| `6` RENDER_ERROR | a render failed to paint / dimension mismatch (setup) |

These are disjoint from the extraction CLI's `0–3` so a CI script aggregating
both never conflates them.

## Baselines

Committed under `fixtures/visual-baselines/<fixtureId>/<viewport>.png` with a
`<viewport>.meta.json` sidecar (browser version, thresholds, mandatory reason).
Regenerate deliberately from a KNOWN-GOOD render — never to make a red gate
green (002 §8.2):

```
pnpm --filter @critical-css/visual-diff build
node packages/visual-diff/scripts/generate-baselines.mjs "why the baseline changed"
```

## Case matrix

`src/cases.ts` — one case per `(fixture, viewport)` drawn from the small
committed fixtures whose golden critical CSS already exists: `static@desktop`,
`async@desktop`, `mobile@mobile`. Each case's critical CSS **is** the committed
`fixtures/golden/*.css`, so the parity check proves the *actually shipped*
extraction reproduces the full render — not a throwaway string.
