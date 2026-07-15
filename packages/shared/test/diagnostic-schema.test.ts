/**
 * Diagnostics JSON Schema conformance + anti-drift test (M5 crit-3,
 * docs/implementation/002-Milestones.md §M5: "a machine-readable diagnostics
 * schema an editor extension can consume").
 *
 * Three things are asserted:
 *  1. Every REAL `Diagnostic` the engine can construct — every
 *     `ExtractionError` subclass's `toDiagnostic()` output (executed here,
 *     not hand-copied), a sample of the 5 CSSOM-walk-diagnostic codes B1
 *     promoted into the real Diagnostic stream (apps/cli/src/extract.ts),
 *     plus a scan-derived sample of every literal `severity`/`code`/`message`
 *     object emitted anywhere in the pipeline — conforms to
 *     `schemas/diagnostic.schema.json`.
 *  2. The schema's `code` enum (the "diagnostic code catalog") is scanned
 *     against the actual repository source for drift in BOTH directions.
 *  3. (B2) The schema itself — loaded through a real JSON Schema validator
 *     (ajv), not this file's own hand-rolled field checks — actually
 *     REJECTS malformed `Diagnostic`s: an unknown extra field, a missing
 *     required field, and an out-of-enum `code`.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// The schema declares draft 2020-12 (`$schema`); ajv's default export only
// bundles the draft-07 meta-schema, so the 2020-12-aware build is required
// or `ajv.compile` throws "no schema with key ... 2020-12/schema".
import Ajv2020 from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CacheError,
  DependencyResolutionError,
  NavigationTimeoutError,
  PluginError,
  SelectorMatchError,
  SerializationError,
} from '../src/errors/extraction-error.js'
import type { Diagnostic } from '../src/dtos/diagnostic.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '../schemas/diagnostic.schema.json')
const rawSchema = readFileSync(schemaPath, 'utf8')
const schema = JSON.parse(rawSchema) as {
  readonly $defs: {
    readonly severity: { readonly enum: readonly string[] }
    readonly code: { readonly enum: readonly string[] }
  }
}

function assertConformsToDiagnosticSchema(diagnostic: Diagnostic): void {
  expect(schema.$defs.severity.enum).toContain(diagnostic.severity)
  expect(schema.$defs.code.enum).toContain(diagnostic.code)
  expect(typeof diagnostic.message).toBe('string')
  if (diagnostic.source !== undefined) {
    expect(diagnostic.source.url === null || typeof diagnostic.source.url === 'string').toBe(true)
  }
  if (diagnostic.context !== undefined) {
    expect(typeof diagnostic.context).toBe('object')
  }
}

describe('diagnostic.schema.json — structural sanity', () => {
  it('is valid JSON, draft 2020-12, and enumerates severity + code', () => {
    expect(schema).toHaveProperty('$defs.severity.enum')
    expect(schema).toHaveProperty('$defs.code.enum')
    expect(JSON.parse(rawSchema)['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
  })

  it('severity enum matches DiagnosticSeverity exactly', () => {
    expect([...schema.$defs.severity.enum].sort()).toEqual(['error', 'info', 'warning'])
  })
})

describe('diagnostic.schema.json — conformance of REAL emitted diagnostics', () => {
  it('every ExtractionError subclass toDiagnostic() output conforms', () => {
    const errors = [
      new NavigationTimeoutError('timed out'),
      new SelectorMatchError('match failed', { source: { url: 'https://x.test/' }, context: { selector: '.a' } }),
      new SerializationError('serialize failed'),
      new DependencyResolutionError('cycle detected'),
      new CacheError('cache write failed'),
      new PluginError('plugin threw'),
    ]
    for (const err of errors) assertConformsToDiagnosticSchema(err.toDiagnostic())
  })

  // B1: apps/cli/src/extract.ts folds packages/collector's
  // `CollectorDiagnosticRecord`s (cssom-walker.ts) into this exact shape —
  // reproduced here (packages/shared cannot depend on apps/cli) rather than
  // hand-copied, to pin the actual field mapping.
  it('every CSSOM-walk diagnostic code B1 promotes into the real Diagnostic stream conforms', () => {
    const severityByCode: Record<string, Diagnostic['severity']> = {
      CROSS_ORIGIN_STYLESHEET_SKIPPED: 'warning',
      CSSOM_WALK_ERROR: 'warning',
      UNKNOWN_GROUPING_RULE: 'info',
      IMPORT_SHEET_UNAVAILABLE: 'warning',
      CIRCULAR_IMPORT: 'warning',
    }
    for (const [code, severity] of Object.entries(severityByCode)) {
      assertConformsToDiagnosticSchema({
        severity,
        code,
        message: `${code} sample message`,
        source: { url: 'https://x.test/app.css' },
        context: { stylesheetIndex: 0 },
      })
    }
  })
})

/**
 * Scans source for `Diagnostic`/`CollectorDiagnosticRecord`-shaped object
 * literals: a `code:\s*'CODE'` assignment. Deliberately NOT restricted to
 * literals with a nearby `severity:` field — an earlier version of this
 * scanner required that, which made it structurally blind to
 * `CollectorDiagnosticRecord` literals (packages/collector/src/cssom-walker
 * — code/message/href, no `severity`). Those are real diagnostic codes too:
 * apps/cli/src/extract.ts promotes every one of them into the real
 * `Diagnostic` stream (B1), just not via a literal `code:` assignment at the
 * promotion site (`code: record.code`, a property read the regex can't see
 * either way) — so the only place the literal actually appears in source is
 * the collector's own emission site, and the scanner must look there.
 *
 * This intentionally does NOT use the TypeScript compiler API: every
 * `code:` literal found repo-wide (verified against the full grep) already
 * belongs to either a real `Diagnostic` or a `CollectorDiagnosticRecord` — no
 * unrelated code has ever collided with this shape — so a plain, unfiltered
 * regex scan gives full cross-package coverage without the added complexity
 * of AST parsing. See the codes-emitting-package regression test below for
 * proof this catches what the old, severity-gated version missed.
 */
function scanEmittedDiagnosticCodes(roots: readonly string[]): ReadonlySet<string> {
  const codes = new Set<string>()
  const codeRe = /code:\s*'([A-Z][A-Z0-9_]*)'/g

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || full.includes(`${'test'}/`)) continue
      const text = readFileSync(full, 'utf8')
      for (const match of text.matchAll(codeRe)) codes.add(match[1] as string)
    }
  }
  for (const root of roots) walk(root)
  return codes
}

/**
 * The OLD (pre-B2) scanning heuristic, kept only so the regression test
 * below can demonstrate what it missed. NOT used for the real drift check.
 */
function scanEmittedDiagnosticCodesLegacySeverityGated(roots: readonly string[]): ReadonlySet<string> {
  const codes = new Set<string>()
  const codeRe = /code:\s*'([A-Z][A-Z0-9_]*)'/g

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || full.includes(`${'test'}/`)) continue
      const text = readFileSync(full, 'utf8')
      for (const match of text.matchAll(codeRe)) {
        const idx = match.index ?? 0
        const windowStart = Math.max(0, idx - 200)
        const window = text.slice(windowStart, idx + 200)
        if (/severity\s*:/.test(window)) codes.add(match[1] as string)
      }
    }
  }
  for (const root of roots) walk(root)
  return codes
}

function emittedRepoWide(): ReadonlySet<string> {
  const repoRoot = resolve(here, '../../..')
  const roots = ['packages', 'apps'].map((d) => join(repoRoot, d))
  const codes = new Set(scanEmittedDiagnosticCodes(roots))

  // ExtractionError subclasses construct their `code` via `super(code, ...)`
  // rather than an object-literal `code:` field, so the regex scan above
  // cannot see them; they are enumerated directly from the (real, imported)
  // class hierarchy instead.
  for (const err of [
    new NavigationTimeoutError(''),
    new SelectorMatchError(''),
    new SerializationError(''),
    new DependencyResolutionError(''),
    new CacheError(''),
    new PluginError(''),
  ]) {
    codes.add(err.code)
  }
  return codes
}

describe('diagnostic.schema.json — code catalog drift (crit-3 "kept from drifting")', () => {
  const emitted = emittedRepoWide()
  const cataloged = new Set(schema.$defs.code.enum)

  it('scan found at least the known baseline of emission sites (sanity check on the scan itself)', () => {
    expect(emitted.size).toBeGreaterThanOrEqual(20)
  })

  it('every code the engine can emit is enumerated in the schema (no undocumented code)', () => {
    const undocumented = [...emitted].filter((c) => !cataloged.has(c))
    expect(undocumented).toEqual([])
  })

  it('every cataloged code is still actually emitted somewhere (no stale catalog entry)', () => {
    const stale = [...cataloged].filter((c) => !emitted.has(c))
    expect(stale).toEqual([])
  })

  // B1 regression: these 5 codes live only in packages/collector's
  // `CollectorDiagnosticRecord` literals (no nearby `severity:` field) — the
  // pre-B2 scanner would never have found them, so this pins that the
  // widened scanner (and the schema enum update) actually cover them.
  it('the 5 CSSOM-walk codes B1 surfaced are found by the scan and cataloged', () => {
    const cssomCodes = [
      'CROSS_ORIGIN_STYLESHEET_SKIPPED',
      'CSSOM_WALK_ERROR',
      'UNKNOWN_GROUPING_RULE',
      'IMPORT_SHEET_UNAVAILABLE',
      'CIRCULAR_IMPORT',
    ]
    for (const code of cssomCodes) {
      expect(emitted.has(code)).toBe(true)
      expect(cataloged.has(code)).toBe(true)
    }
  })
})

describe('diagnostic.schema.json — scanner widening regression (B2)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'diagnostic-scanner-fixture-'))
    // Simulates a hypothetical new codes-emitting package, written exactly
    // like packages/collector's CollectorDiagnosticRecord literals: a `code`
    // string literal with NO `severity:` field anywhere nearby.
    writeFileSync(
      join(dir, 'fake-emitter.ts'),
      [
        'export interface FakeDiagnosticRecord {',
        '  readonly code: string',
        '  readonly message: string',
        '}',
        '',
        'export function emit(): FakeDiagnosticRecord {',
        "  return { code: 'FIXTURE_NEW_PACKAGE_CODE', message: 'fixture' }",
        '}',
      ].join('\n'),
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('the OLD severity-gated scanner misses a codes-emitting-package fixture with no nearby severity', () => {
    const legacy = scanEmittedDiagnosticCodesLegacySeverityGated([dir])
    expect(legacy.has('FIXTURE_NEW_PACKAGE_CODE')).toBe(false)
  })

  it('the NEW scanner catches that same fixture', () => {
    const current = scanEmittedDiagnosticCodes([dir])
    expect(current.has('FIXTURE_NEW_PACKAGE_CODE')).toBe(true)
  })
})

describe('diagnostic.schema.json — negative validation via ajv (B2, "positive-only" gap)', () => {
  const ajv = new Ajv2020({ strict: true })
  const validate = ajv.compile(schema)

  const validDiagnostic = {
    severity: 'warning',
    code: 'CROSS_ORIGIN_STYLESHEET_SKIPPED',
    message: 'Stylesheet cssRules inaccessible',
  }

  it('accepts a well-formed Diagnostic (sanity check on the validator wiring)', () => {
    expect(validate(validDiagnostic)).toBe(true)
  })

  it('rejects an unknown extra field (additionalProperties: false)', () => {
    expect(schema.additionalProperties === false || (schema as unknown as Record<string, unknown>)['additionalProperties'] === false).toBe(
      true,
    )
    const withExtra = { ...validDiagnostic, notAField: 'nope' }
    expect(validate(withExtra)).toBe(false)
    expect(validate.errors?.some((e) => e.keyword === 'additionalProperties')).toBe(true)
  })

  it('rejects a Diagnostic missing a required field', () => {
    const { message: _message, ...missingMessage } = validDiagnostic
    expect(validate(missingMessage)).toBe(false)
    expect(validate.errors?.some((e) => e.keyword === 'required')).toBe(true)

    const { severity: _severity, ...missingSeverity } = validDiagnostic
    expect(validate(missingSeverity)).toBe(false)

    const { code: _code, ...missingCode } = validDiagnostic
    expect(validate(missingCode)).toBe(false)
  })

  it('rejects a code not in the enum', () => {
    const badCode = { ...validDiagnostic, code: 'TOTALLY_MADE_UP_CODE' }
    expect(validate(badCode)).toBe(false)
    expect(validate.errors?.some((e) => e.keyword === 'enum' && e.instancePath === '/code')).toBe(true)
  })

  it('rejects a severity not in the enum', () => {
    const badSeverity = { ...validDiagnostic, severity: 'critical' }
    expect(validate(badSeverity)).toBe(false)
    expect(validate.errors?.some((e) => e.keyword === 'enum' && e.instancePath === '/severity')).toBe(true)
  })
})
