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

## Diagnostics JSON Schema (M5 crit-3)

`schemas/diagnostic.schema.json` is the machine-readable contract for the
`Diagnostic` DTO above — JSON Schema draft 2020-12, describing severity, code,
message, source location, and context exactly as `src/dtos/diagnostic.ts`
defines them. This is the artifact an editor extension / language server
consumes to render inline diagnostics (`docs/implementation/002-Milestones.md`
§M5 crit-3: "a machine-readable diagnostics schema an editor extension can
consume ... even if a full first-party IDE extension is deferred to post-M5
work"). **No first-party IDE extension ships in M5** — this schema plus the
consumption note below is the complete crit-3 deliverable for this milestone.

**Why `packages/shared` and not `packages/reporter`.** The `Diagnostic` DTO
this schema describes is defined and owned here, not in `packages/reporter`
— every package that can fail (`browser`, `collector`, `matcher`,
`dependency-graph`, `plugins`, `apps/cli`) constructs `Diagnostic` objects
directly and pushes them onto its own `diagnostics: readonly Diagnostic[]`
result field; the Reporter only aggregates and *renders* diagnostics that
already flowed through `ExtractionResult`/`ReportBundle`, it does not define
their shape. Per `docs/architecture/007-Repository-Structure.md`'s package
ownership convention (a type's schema lives with the type, not with a
downstream consumer of it), the schema belongs next to `diagnostic.ts`, one
directory over, not in the Reporter.

**How the schema is kept from drifting.** `test/diagnostic-schema.test.ts`:
(1) runs every real `ExtractionError` subclass's `toDiagnostic()` and asserts
the output conforms to the schema; (2) scans the actual engine source tree
for every `Diagnostic`-shaped `code: '...'` literal actually emitted anywhere
in the pipeline, and fails if the schema's `code` enum (the diagnostic code
catalog) is missing an emitted code OR still lists a code nothing emits
anymore. There is no hand-maintained parallel list to fall out of sync — the
enum is checked directly against the emission sites.

**How an editor extension consumes it.** Read
`schemas/diagnostic.schema.json` to validate/typecheck the `diagnostics`
array of an `ExtractionResult` (or a `Diagnostic[]` from any package's
result type) before rendering; `severity` maps directly onto LSP
`DiagnosticSeverity` (error/warning/info); `source.url`/`line`/`column` maps
onto an LSP `Location`; `code` is the stable string an extension can key
quick-fixes or documentation links off of. `context` is intentionally left
as an open `object` in the schema — its shape varies per `code` and is meant
to be displayed, not structurally parsed.

## Scripts

- `pnpm build` — `tsc --build`
- `pnpm test` — vitest
- `pnpm typecheck` — `tsc --noEmit`
