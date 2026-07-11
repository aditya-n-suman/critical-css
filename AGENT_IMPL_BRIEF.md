# Critical CSS Engine — Implementation Agent Brief

> Feed this document to a Claude agent at the start of every **implementation** session.
> This is the authoritative instruction set for the entire implementation lifecycle.
> For documentation generation, see [BRIEF.md](./BRIEF.md) instead.

---

## 1. Project Summary

**Project Name:** Critical CSS Extraction Engine
**Repository root:** the directory containing this file
**Phase:** Implementation (all 17 documentation phases are complete; see `docs/STATUS.md`)
**Documentation corpus:** 111 design documents under `docs/` — the implementation authority for all code

**Core principle (ADR-0001):** The live browser (Playwright) is the source of truth. The engine uses the browser's CSSOM, not static CSS parsing, to determine which rules apply to above-fold content.

**Hard constraint (ADR-0002):** Never implement a custom CSS selector parser. All selector matching delegates to `Element.matches()`.

---

## 2. Session Start Protocol

Run these steps at the start of every implementation session, in order. Do not skip.

### Step 1 — Read current state

```
Read IMPL_STATUS.md                          # find active milestone, active task, next action
Read IMPLEMENTATION_PLAN.md                  # understand full milestone map and tech stack
```

### Step 2 — Identify the active task

From `IMPL_STATUS.md §What to Do Next`, extract:
- Which milestone is active (M0–M5)
- Which package is active (`packages/shared`, `packages/browser`, etc.)
- Which specific items are `Not started` or `In progress`

### Step 3 — Load the task's design authority

For the active task, read **every design document listed in the task card** and in `IMPLEMENTATION_PLAN.md` for that package before writing any code. Design documents are the single source of truth — do not infer behavior from other sources.

```
# Example for packages/browser (AT-02):
Read docs/tasks/001-Implement-Browser-Pool.md
Read docs/design/100-Browser-Abstraction.md
Read docs/design/101-Playwright-Adapter.md
Read docs/design/102-Browser-Pool.md
Read docs/design/103-Navigation-Engine.md
Read docs/design/104-Rendering-Stabilization.md
Read docs/design/105-Viewport-Manager.md
Read docs/design/106-DOM-Snapshot.md
Read docs/adr/ADR-0001-Browser-Is-Source-of-Truth.md
Read docs/adr/ADR-0003-Playwright-As-Browser-Abstraction.md
```

### Step 4 — Read the Definition of Done

Always read before starting any task:
```
Read docs/implementation/004-Definition-of-Done.md   # 7-gate completion checklist
```

---

## 3. Canonical Tech Stack

Do not deviate from these choices without a new ADR.

| Concern | Choice | Version |
|---|---|---|
| Language | TypeScript | 5.x, `strict: true`, `noUncheckedIndexedAccess: true` |
| Package manager | pnpm | 9.x |
| Monorepo orchestration | Turbo | 2.x |
| Browser automation | Playwright | latest |
| Test runner | Vitest | 2.x |
| Linter | ESLint 9 + `@typescript-eslint` | latest |
| Formatter | Prettier | latest |
| Node | ≥ 18.0.0 | per `.nvmrc` |

---

## 4. Repository Structure (Target)

```
critical-css/
├── BRIEF.md                         # documentation brief (do not modify)
├── AGENT_IMPL_BRIEF.md              # this file
├── IMPLEMENTATION_PLAN.md           # human-readable plan
├── IMPL_STATUS.md                   # session state tracker — update each session
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml              # packages/*, apps/*
├── tsconfig.base.json               # shared compiler options
├── turbo.json                       # task pipeline
├── vitest.workspace.ts              # workspace test config
├── .nvmrc                           # 18
├── .gitignore
├── docs/                            # existing (do not modify docs files)
├── packages/
│   ├── shared/          # AT-01 — zero dependencies
│   ├── browser/         # AT-02 — depends: shared
│   ├── collector/       # AT-03 — depends: browser, shared
│   ├── matcher/         # AT-04 — depends: collector, browser, shared
│   ├── coverage/        # AT-05 — depends: browser, shared (NOT matcher)
│   ├── dependency-graph/ # AT-06 — depends: matcher, coverage, shared
│   ├── serializer/      # AT-07 — depends: dependency-graph, shared
│   ├── cache/           # AT-08 — depends: shared (parallel-eligible from M0)
│   ├── plugins/         # AT-09 — depends: shared (parallel-eligible from M0)
│   └── reporter/        # AT-10 — depends: serializer, shared
├── apps/
│   ├── cli/             # AT-11 — depends: all packages
│   ├── visualizer/      # M5
│   └── playground/      # M3+
├── fixtures/            # HTML test fixtures
│   ├── static/          # minimal static HTML
│   ├── async/           # page with async-loaded content
│   ├── mobile/          # mobile-layout fixture
│   └── golden/          # golden CSS snapshots (generated, committed)
└── benchmarks/          # M2+
```

---

## 5. Package Conventions (All Packages Must Follow)

### 5.1 Directory structure per package

```
packages/<name>/
├── src/
│   ├── index.ts            # barrel export — public API only
│   └── <module>/
│       ├── index.ts
│       └── <module>.ts
├── test/
│   └── <module>.test.ts    # colocated per-module tests
├── package.json
├── tsconfig.json
└── README.md
```

### 5.2 `package.json` per package

```json
{
  "name": "@critical-css/<name>",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { /* workspace internal: "workspace:*" */ },
  "devDependencies": { "vitest": "..." }
}
```

### 5.3 `tsconfig.json` per package

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declarationDir": "dist"
  },
  "references": [ /* { "path": "../shared" } etc. */ ],
  "include": ["src"]
}
```

### 5.4 Barrel export rule

`src/index.ts` exports **only** the public API surface documented in the package's design documents. Internal helpers are not re-exported through the barrel. Other packages import **only** from the barrel (`@critical-css/<name>`), never from internal paths.

### 5.5 No cross-package constraint (critical)

`packages/matcher` and `packages/coverage` must **never** import from each other. This invariant is enforced by design (see `docs/architecture/006-Design-Principles.md` Principle 4). Violating it requires a new ADR.

---

## 6. Phase Execution Guide

### Phase M0 — Foundation

**Goal:** Working monorepo + browser pool that can navigate a page.

#### Step 1 — Root scaffold

Create these files at the repo root:

**`package.json`**
```json
{
  "name": "critical-css-engine",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "typecheck": "turbo typecheck",
    "lint": "turbo lint",
    "format": "prettier --write ."
  }
}
```

**`pnpm-workspace.yaml`**
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**`tsconfig.base.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**`turbo.json`**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["build"], "outputs": [] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "lint": { "outputs": [] }
  }
}
```

**`vitest.workspace.ts`**
```typescript
import { defineWorkspace } from 'vitest/config'
export default defineWorkspace(['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'])
```

**`.nvmrc`**: `18`

After creating these, run `pnpm install`. It must succeed before any package work begins.

---

#### Step 2 — `packages/shared` (AT-01)

**Design authority:** Read these before writing code:
- `docs/architecture/003-Requirements.md` (module responsibility table, §2.4 of BRIEF)
- `docs/architecture/004-Terminology.md`
- `docs/architecture/005-Glossary.md`
- `docs/architecture/006-Design-Principles.md`
- `docs/design/1000-Diagnostics-Overview.md` (error/diagnostic taxonomy)
- `docs/implementation/001-Task-Breakdown.md §8.2` (BI-01.1 through BI-01.5)

**What to implement:**

DTOs (`src/dtos/`):
- `ExtractionResult` — the final output shape: CSS string + diagnostics + matched rule set + timing
- `Diagnostic` — structured log/error entry: severity, code, message, source location, context
- `ViewportProfile` — width, height, deviceScaleFactor, isMobile, userAgent, name
- `MatchedRule` — the CSS rule text + selector + specificity + source stylesheet + origin
- `DependencyNode` — a CSS dependency (variable/keyframe/font/layer/etc.) with type + value + dependents
- `CacheFingerprint` — hash of: HTML content, CSS asset URLs+ETags, viewport profile, extraction mode
- `PluginHookContext` — current hook name + mutable state payload + diagnostic emitter
- `RouteManifestEntry` — route pattern + output CSS file path + extraction options override
- `ExtractionOptions` — full configuration schema (viewport profiles, fold, mode, cache, plugins, output)

Error hierarchy (`src/errors/`):
- `ExtractionError extends Error` — base, has `code: string`, `toDiagnostic(): Diagnostic`
- `NavigationTimeoutError extends ExtractionError`
- `SelectorMatchError extends ExtractionError`
- `SerializationError extends ExtractionError`
- `DependencyResolutionError extends ExtractionError`
- `CacheError extends ExtractionError`
- `PluginError extends ExtractionError`

**Hard constraint:** Zero imports of `fs`, `path`, `process`, `Buffer`, or any Node.js built-in. This package must be safe to reference inside a browser-injected `evaluate()` call.

**Tests (`test/`):**
- Type-level tests verifying DTO fields match design doc specs
- Unit tests for every `toDiagnostic()` implementation
- Unit test: `CacheFingerprint` hash is stable across two identical inputs

---

#### Step 3 — `packages/browser` (AT-02)

**Design authority:** Read these before writing code:
- `docs/tasks/001-Implement-Browser-Pool.md` (primary task card)
- `docs/design/100-Browser-Abstraction.md`
- `docs/design/101-Playwright-Adapter.md`
- `docs/design/102-Browser-Pool.md`
- `docs/design/103-Navigation-Engine.md`
- `docs/design/104-Rendering-Stabilization.md`
- `docs/design/105-Viewport-Manager.md`
- `docs/design/106-DOM-Snapshot.md`
- `docs/adr/ADR-0001-Browser-Is-Source-of-Truth.md`
- `docs/adr/ADR-0003-Playwright-As-Browser-Abstraction.md`
- `docs/implementation/001-Task-Breakdown.md §8.3` (BI-02.1 through BI-02.6)

**What to implement:**

`BrowserManager` (`src/browser-manager/`):
- Manages a pool of Playwright browser contexts
- Pool size configurable (default 2)
- `acquire(): Promise<PageHandle>` — leases a context from the pool or creates one
- `release(handle: PageHandle): Promise<void>` — returns context to pool
- `teardown(): Promise<void>` — closes all contexts, exits Playwright
- No context leaks: if `acquire` throws, no dangling browser processes

`NavigationEngine` (`src/navigation/`):
- `navigate(handle, url, options): Promise<void>`
- Waits for: `networkidle` or `domcontentloaded` (configurable), then applies stabilization heuristic
- Rendering stabilization heuristic (per `104`): polls `document.readyState` + layout shift score until stable or timeout
- Configurable timeout (default 30s)
- Throws `NavigationTimeoutError` (from `@critical-css/shared`) on timeout

`ViewportManager` (`src/viewport/`):
- `DeviceProfile` type re-exported from `@critical-css/shared`
- Built-in profiles: `desktop` (1280×800), `tablet` (768×1024), `mobile` (375×812, isMobile: true)
- `applyProfile(handle, profile): Promise<void>` — applies viewport + user agent to page context
- `defaultProfile(): DeviceProfile` — returns desktop

`DOMSnapshot` (`src/snapshot/`):
- `capture(handle): Promise<DOMSnapshotResult>`
- `DOMSnapshotResult`: serializable record of above-fold DOM nodes — each node has: tagName, attributes, boundingRect, visible (bool), computedStyles (partial), classList
- Executes in-page via Playwright `evaluate()` — no DOM parsing on the Node side
- Respects `ViewportProfile.foldOffset` for above-fold cutoff (default: `window.innerHeight`)

`PageHandle` (`src/types/`):
- Opaque handle wrapping a Playwright `Page`
- Exposes only: `navigate()`, `evaluate()`, `applyViewport()`, `captureSnapshot()`, `url()`
- Hides raw Playwright API from downstream packages

**Fixtures (`fixtures/`):**
Create before writing integration tests:
- `fixtures/static/index.html` — simple static page with above-fold and below-fold elements
- `fixtures/async/index.html` — page that appends a div via `setTimeout(100ms)` (tests stabilization)
- `fixtures/mobile/index.html` — page with a media query that hides desktop nav on mobile

**Integration tests (`test/browser.integration.test.ts`):**
- `BrowserManager` navigates all 3 fixtures without crash
- `release()` after each navigate — repeated 5 times — no resource leak (check process count or Playwright's own leak detection)
- `ViewportManager` applies mobile profile → `window.innerWidth === 375` in-page
- `NavigationEngine` on `fixtures/async/` — stabilization reports stable only after the async element appears
- `NavigationTimeoutError` thrown when navigation target is unreachable

---

#### M0 Exit Checklist

Before marking M0 complete:

- [ ] `pnpm install` exits 0
- [ ] `pnpm build` exits 0, zero TypeScript errors
- [ ] `pnpm --filter @critical-css/shared typecheck` exits 0
- [ ] `pnpm --filter @critical-css/browser test` exits 0, all integration tests pass
- [ ] No import of `fs`/`path`/`process` in `packages/shared/src/`
- [ ] `BrowserManager` navigates all 3 fixtures with no resource leak
- [ ] Mobile `DeviceProfile` applied correctly (confirmed in-page)
- [ ] Stabilization heuristic reports stable on async fixture (not just static)
- [ ] `IMPL_STATUS.md` updated: all M0 rows marked Complete, session log updated

---

### Phase M1 — CSSOM Extraction MVP

**Goal:** `critical-css-engine extract --url <url>` emits valid critical CSS to stdout.

Blocked on M0 completing. Once M0 exits:

1. **`packages/collector`** — CSSOM Walker + DOM Collector sub-modules
   - Read: `docs/tasks/002-Implement-CSSOM-Walker.md`, `docs/design/300–307`, `docs/design/106`
   - Read: `docs/implementation/001-Task-Breakdown.md §8.4` (BI-03.*)
   - Key: CSSOM Walker traverses `document.styleSheets` in-page; produces rule tree DTO

2. **`packages/matcher`** — selector matching
   - Read: `docs/tasks/003-Implement-Selector-Matcher.md`, `docs/design/400–405`, `docs/adr/ADR-0002`
   - Read: `docs/implementation/001-Task-Breakdown.md §8.5`
   - Key: `element.matches(selectorText)` is the only selector evaluator; never parse selectors manually

3. **`packages/serializer`** (basic slice only — full in M2)
   - Read: `docs/tasks/006-Implement-Serializer.md`, `docs/design/600–601`
   - Implement only: rule ordering + basic string output (no compression, no source maps yet)

4. **`apps/cli`** (MVP)
   - Read: `docs/tasks/011-Implement-CLI.md`
   - MVP scope: `extract --url <url> [--viewport desktop|tablet|mobile] [--output <path>]`
   - Wires: BrowserManager → collector → matcher → serializer → stdout/file

**M1 golden baseline:**
After M1 passes, generate golden CSS files for all fixtures:
```
pnpm --filter @critical-css/cli extract --url fixtures/static/ > fixtures/golden/static.css
pnpm --filter @critical-css/cli extract --url fixtures/async/ > fixtures/golden/async.css
pnpm --filter @critical-css/cli extract --url fixtures/mobile/ --viewport mobile > fixtures/golden/mobile.css
```
Commit these. Future runs must produce byte-identical output.

---

### Phase M2 — Dependency Graph, Media/Layer, Plugins

Read `docs/implementation/001-Task-Breakdown.md §8.6–8.8, 8.10` for breakdown items.

**Packages:** `packages/dependency-graph` (AT-06), `packages/serializer` full (AT-07), `packages/plugins` (AT-09), `packages/collector` Visibility Engine sub-module (AT-03 partial)

**Task cards:** `docs/tasks/004-Implement-Dependency-Resolver.md`, `docs/tasks/005-Implement-Visibility-Engine.md`, `docs/tasks/008-Implement-Plugin-System.md`

Detailed execution per task card — each card contains: scope, acceptance criteria, DoD reference.

---

### Phase M3 — Multi-Device, Coverage, Hybrid

Read `docs/implementation/001-Task-Breakdown.md §8.7, 8.9` for breakdown items.

**Packages:** `packages/coverage` (AT-05), `packages/reporter` (AT-10), hybrid mode inside `packages/dependency-graph`

**Task cards:** `docs/tasks/009-Implement-Reporter.md`, `docs/tasks/010-Implement-SSR-Adapters.md`

**Critical constraint:** `packages/coverage` must not import from `packages/matcher` at any point.

---

### Phase M4 — CI, Route Manifest, Cache

Read `docs/implementation/001-Task-Breakdown.md §8.11` for breakdown items.

**Packages:** `packages/cache` (AT-08 full), `apps/cli` full

**Task card:** `docs/tasks/007-Implement-Cache-Manager.md`

---

### Phase M5 — Visual Debugger, Benchmarks

**Apps:** `apps/visualizer`, benchmarks under `benchmarks/`

Detailed design: `docs/design/1004–1005`, `docs/performance/000–005`

---

## 7. Definition of Done (7 Gates)

Every task card must pass all applicable gates. Source: `docs/implementation/004-Definition-of-Done.md`.

| Gate | Check |
|---|---|
| G1 — Type-check | `pnpm typecheck` exits 0, strict mode, no `@ts-ignore` without justifying comment |
| G2 — Unit tests | Public API has unit tests; new-line coverage ≥ 90% |
| G3 — Golden files | Serialized CSS output matches committed golden snapshots in `fixtures/golden/` (byte-exact) |
| G4 — Visual tests | Visual regression suite passes for all applicable fixtures |
| G5 — Performance | No regression > ±5% against benchmark baseline for the affected package |
| G6 — Docs updated | Package `README.md` reflects public API; `docs/` cross-references updated if signatures changed |
| G7 — Code review | At least one adversarial review pass before marking complete |

**Applicability:**
- New module: all 7 gates
- Bug fix: G1, G2, G3, G7
- Performance optimization: G1, G5, G7
- Docs-only change: G6, G7

---

## 8. Session End Protocol

Run these steps at the end of every session, in order.

### Step 1 — Verify current task DoD

For every task completed this session, verify all applicable gates from Section 7.

### Step 2 — Update `IMPL_STATUS.md`

1. Update **Current State** table: `Active milestone`, `Active package`, `Active task`, `Last session`, `Next action`
2. Mark completed Milestone Progress rows as `Complete`
3. Add a row to **Session Log**: date, what was done, status after
4. Add any new blockers

### Step 3 — Commit

```bash
git add packages/ apps/ fixtures/ IMPL_STATUS.md
git commit -m "feat(M0): implement packages/browser — BrowserManager, NavigationEngine, ViewportManager"
```

Commit message format: `feat|fix|test|chore(M<n>): <package or area> — <what>`

---

## 9. Hard Rules (Never Violate)

1. **Read design docs before writing code.** Every behavior is specified in `docs/`. Do not invent behavior not in the design documents.
2. **Never implement a custom CSS selector parser.** All selector evaluation goes through `element.matches()`. This is ADR-0002 — permanent.
3. **Never introduce a `packages/matcher` ↔ `packages/coverage` import edge.** This violates Design Principle 4 and requires a new ADR, not a quiet workaround.
4. **`packages/shared` must not import Node.js built-ins.** It must be safe inside a browser-injected function.
5. **Never skip the DoD gates.** A task is not done if any applicable gate fails.
6. **Never modify `docs/` files.** Documentation is complete. If a design document is wrong or incomplete, note it in `IMPL_STATUS.md §Known Blockers / Issues` and raise it with the project owner.
7. **Update `IMPL_STATUS.md` at the end of every session, no exceptions.** This is how the next session knows where to start.
8. **Golden files are generated after first-pass extraction and committed.** Do not hand-write golden CSS.
9. **Commit after each completed package, not after each file.** One commit per milestone item row in `IMPL_STATUS.md`.
10. **`pnpm install` and `pnpm build` must remain green at all times.** Never leave the repo in a broken build state between sessions.

---

## 10. Reference Index

| What you need | Where to find it |
|---|---|
| Current session state | `IMPL_STATUS.md` |
| Full milestone plan | `IMPLEMENTATION_PLAN.md` |
| Package build order + design doc citations | `docs/implementation/000-Architecture-Tasks.md` |
| Breakdown items per package | `docs/implementation/001-Task-Breakdown.md` |
| Milestone exit criteria | `docs/implementation/002-Milestones.md` |
| Per-requirement acceptance tests | `docs/implementation/003-Acceptance-Tests.md` |
| 7-gate Definition of Done | `docs/implementation/004-Definition-of-Done.md` |
| Atomic task cards | `docs/tasks/001–011*.md` |
| Browser layer design | `docs/design/100–106` |
| Visibility engine design | `docs/design/200–207` |
| CSSOM walker design | `docs/design/300–307` |
| Selector engine design | `docs/design/400–405` |
| Dependency resolution algorithms | `docs/algorithms/501–508` |
| Serialization design | `docs/design/600–606` |
| Cache design | `docs/design/800–806` |
| Plugin SDK design | `docs/plugins/000–004` |
| Diagnostics design | `docs/design/1000–1005` |
| Architecture ADRs | `docs/adr/ADR-0001–0005` |
| Design principles | `docs/architecture/006-Design-Principles.md` |
| Repository structure | `docs/architecture/007-Repository-Structure.md` |
| Testing strategy | `docs/testing/000-Testing-Strategy.md` |
| Fixture catalog | `docs/testing/001-Fixtures.md` |
| Golden file strategy | `docs/testing/003-Golden-Files.md` |
| Performance benchmarks | `docs/performance/000-Performance-Overview.md` |
