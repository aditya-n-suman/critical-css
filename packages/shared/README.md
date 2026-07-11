# @critical-css/shared

Shared DTOs, configuration schema types, and the fail-fast error hierarchy for the
Critical CSS Extraction Engine (AT-01). Zero dependencies.

**Hard constraint:** no Node.js built-ins (`fs`, `path`, `process`, `Buffer`, …) anywhere
in `src/` — this package must be safe to reference inside a browser-injected
`evaluate()` call (Design Principle 1's page-context bridge).

## Public API

### DTOs (`src/dtos/`)

| Export | Purpose | Design authority |
|---|---|---|
| `ExtractionResult`, `StageTiming` | Final output of one route×viewport×mode run: CSS + diagnostics + matched rules + timing | 004-Terminology |
| `Diagnostic`, `DiagnosticSeverity`, `DiagnosticSourceLocation` | Structured log/error entry (severity, code, message, source, context) | 1000-Diagnostics-Overview |
| `ViewportProfile`, `computeFold` | Device/viewport emulation contract + singular fold computation | 105-Viewport-Manager |
| `MatchedRule`, `Specificity`, `CascadeOrigin` | Browser-reported rule + `(stylesheetUrl, rule index path)` identity | 003-Requirements, 1000 §10.2 |
| `DependencyNode`, `DependencyNodeType` | CSS dependency graph node (variables, keyframes, fonts, layers, …) | 004-Terminology, REQ-200 |
| `CacheFingerprint`, `computeCacheFingerprint`, `fnv1a64`, `canonicalJsonStringify` | Deterministic composite fingerprint over all output-affecting inputs | 006-Design-Principles P8 |
| `PluginHookContext`, `PluginHookName` | Six lifecycle hooks + attributable diagnostic emitter | 005-Glossary, REQ-470 |
| `RouteManifestEntry` | Route pattern → output bundle mapping | REQ-350 |
| `ExtractionOptions` (+ `StabilizationPolicy`, `NavigationOptions`, `BrowserOptions`, `CacheOptions`, `OutputOptions`) | Full configuration schema | BI-01.2 |

### Errors (`src/errors/`)

`ExtractionError` (base; `code: string`, `toDiagnostic(): Diagnostic`) and subclasses:
`NavigationTimeoutError`, `SelectorMatchError`, `SerializationError`,
`DependencyResolutionError`, `CacheError`, `PluginError`.

## Scripts

- `pnpm build` — `tsc --build`
- `pnpm test` — vitest
- `pnpm typecheck` — `tsc --noEmit`
