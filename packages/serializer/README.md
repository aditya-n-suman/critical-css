# @critical-css/serializer

Serialization (AT-07, M1 basic slice: canonical rule ordering + deterministic
pretty output). Compression, dedup, source maps, and output formats land in M2.

## Public API

| Export | Purpose |
|---|---|
| `serialize(input, config?)` | `MergedMultiViewportRuleSet` → `SerializedArtifact`. Stable sort by canonical order, wrapper-chain grouping, pretty render, brace-balance validation (`SerializationError` on failure) |
| `compareMergedRules` | Canonical total order (601): layer rank (unlayered LAST), then document source order `(stylesheetIndex, ruleIndexPath)`. Never specificity/origin — those are intrinsic |
| `DEFAULT_SERIALIZER_CONFIG` | Pinned structural choices (600 §8.2): 2-space indent, LF line endings, single trailing newline, `format: 'raw'`, `minify: false` |

Determinism: pure function of input identity keys; tokens emitted verbatim;
double-serialize yields byte-identical output; zero environment dependence.
Golden files lock the pinned formatting (`fixtures/golden/`, `-text` in
`.gitattributes` so Git never rewrites line endings).
