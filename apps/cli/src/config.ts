/**
 * Configuration Loader (011-Implement-CLI.md; 010-System-Overview.md §8.1):
 * an optional JSON config file supplies defaults for `extract`'s flags.
 * Precedence (most to least specific): CLI flag > config file > built-in
 * default. (`CRITICAL_CSS_SANDBOX_POLICY` is the one existing exception —
 * see `defaultSandboxPolicy` in main.ts — and sits between config file and
 * built-in default for that single field.)
 *
 * Scope is deliberately narrow: one JSON object, same fields as the CLI
 * flags, no auto-discovery (no `.critical-css-enginerc` search) — 011 notes
 * no design doc covers the CLI holistically, so this stays close to what's
 * actually specified rather than inventing convention-loading behavior.
 */

import { readFile } from 'node:fs/promises'
import type { SandboxPolicy } from '@critical-css/shared'

export type ViewportName = 'desktop' | 'tablet' | 'mobile'
export type Mode = 'cssom' | 'coverage' | 'hybrid'
export type Format = 'raw-css' | 'inline-style' | 'json-envelope'

export const isViewport = (v: unknown): v is ViewportName =>
  v === 'desktop' || v === 'tablet' || v === 'mobile'

export const isMode = (v: unknown): v is Mode => v === 'cssom' || v === 'coverage' || v === 'hybrid'

export const isFormat = (v: unknown): v is Format =>
  v === 'raw-css' || v === 'inline-style' || v === 'json-envelope'

export const isSandboxPolicy = (v: unknown): v is SandboxPolicy =>
  v === 'full' || v === 'ci-container' || v === 'unsafe-no-sandbox'

/** Every field optional and independently overridable by a CLI flag. */
export interface CliConfig {
  readonly url?: string
  readonly viewports?: readonly ViewportName[]
  readonly mode?: Mode
  readonly output?: string
  readonly report?: string
  /** Directory for per-route report bundles in `--routes` mode (`--report-dir`). */
  readonly reportDir?: string
  readonly minify?: boolean
  readonly format?: Format
  readonly sandboxPolicy?: SandboxPolicy
  /** Path to the incremental disk cache (`--cache-dir`). */
  readonly cacheDir?: string
  /** Force-disable caching (`--no-cache`). */
  readonly noCache?: boolean
  /** Path to a BRIEF §2.9 route-manifest JSON file (`--routes`). */
  readonly routes?: string
  /** Origin the manifest's route patterns resolve against (`--base-url`). */
  readonly baseUrl?: string
  /** Directory route artifacts are written into (`--out-dir`). */
  readonly outDir?: string
  /** Committed baseline JSON to gate against (`--compare-baseline`). */
  readonly compareBaseline?: string
  /** Baseline JSON to (re)generate (`--write-baseline`). */
  readonly writeBaseline?: string
  /** Max allowed CSS growth percent for the baseline gate (`--max-growth`). */
  readonly maxGrowth?: number
  /** Distributed crawl shard spec, `"<i>/<n>"` (`--shard`, M5 exit criterion 4). */
  readonly shard?: string
}

export class ConfigError extends Error {}

function assertType(condition: boolean, field: string, expected: string): void {
  if (!condition) throw new ConfigError(`config: "${field}" must be ${expected}`)
}

/** Validates the parsed JSON shape field-by-field; unknown keys are rejected loudly (Principle 6). */
function validateConfig(raw: unknown): CliConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('config: root must be a JSON object')
  }
  const obj = raw as Record<string, unknown>
  const known = new Set(['url', 'viewport', 'viewports', 'mode', 'output', 'report', 'reportDir', 'minify', 'format', 'sandboxPolicy', 'cacheDir', 'noCache', 'routes', 'baseUrl', 'outDir', 'compareBaseline', 'writeBaseline', 'maxGrowth', 'shard'])
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) throw new ConfigError(`config: unknown field "${key}"`)
  }

  const config: {
    url?: string
    viewports?: readonly ViewportName[]
    mode?: Mode
    output?: string
    report?: string
    reportDir?: string
    minify?: boolean
    format?: Format
    sandboxPolicy?: SandboxPolicy
    cacheDir?: string
    noCache?: boolean
    routes?: string
    baseUrl?: string
    outDir?: string
    compareBaseline?: string
    writeBaseline?: string
    maxGrowth?: number
    shard?: string
  } = {}

  if (obj.url !== undefined) {
    assertType(typeof obj.url === 'string', 'url', 'a string')
    config.url = obj.url as string
  }
  // `viewport` (singular) is accepted as a one-element alias of `viewports`,
  // matching the CLI's own `--viewport`/`--viewports` pair.
  if (obj.viewport !== undefined) {
    assertType(isViewport(obj.viewport), 'viewport', "'desktop' | 'tablet' | 'mobile'")
    config.viewports = [obj.viewport as ViewportName]
  }
  if (obj.viewports !== undefined) {
    assertType(Array.isArray(obj.viewports) && obj.viewports.every(isViewport), 'viewports', "an array of 'desktop' | 'tablet' | 'mobile'")
    config.viewports = obj.viewports as readonly ViewportName[]
  }
  if (obj.mode !== undefined) {
    assertType(isMode(obj.mode), 'mode', "'cssom' | 'coverage' | 'hybrid'")
    config.mode = obj.mode as Mode
  }
  if (obj.output !== undefined) {
    assertType(typeof obj.output === 'string', 'output', 'a string')
    config.output = obj.output as string
  }
  if (obj.report !== undefined) {
    assertType(typeof obj.report === 'string', 'report', 'a string')
    config.report = obj.report as string
  }
  if (obj.reportDir !== undefined) {
    assertType(typeof obj.reportDir === 'string', 'reportDir', 'a string')
    config.reportDir = obj.reportDir as string
  }
  if (obj.minify !== undefined) {
    assertType(typeof obj.minify === 'boolean', 'minify', 'a boolean')
    config.minify = obj.minify as boolean
  }
  if (obj.format !== undefined) {
    assertType(isFormat(obj.format), 'format', "'raw-css' | 'inline-style' | 'json-envelope'")
    config.format = obj.format as Format
  }
  if (obj.sandboxPolicy !== undefined) {
    assertType(isSandboxPolicy(obj.sandboxPolicy), 'sandboxPolicy', "'full' | 'ci-container' | 'unsafe-no-sandbox'")
    config.sandboxPolicy = obj.sandboxPolicy as SandboxPolicy
  }
  if (obj.cacheDir !== undefined) {
    assertType(typeof obj.cacheDir === 'string', 'cacheDir', 'a string')
    config.cacheDir = obj.cacheDir as string
  }
  if (obj.noCache !== undefined) {
    assertType(typeof obj.noCache === 'boolean', 'noCache', 'a boolean')
    config.noCache = obj.noCache as boolean
  }
  if (obj.routes !== undefined) {
    assertType(typeof obj.routes === 'string', 'routes', 'a string')
    config.routes = obj.routes as string
  }
  if (obj.baseUrl !== undefined) {
    assertType(typeof obj.baseUrl === 'string', 'baseUrl', 'a string')
    config.baseUrl = obj.baseUrl as string
  }
  if (obj.outDir !== undefined) {
    assertType(typeof obj.outDir === 'string', 'outDir', 'a string')
    config.outDir = obj.outDir as string
  }
  if (obj.compareBaseline !== undefined) {
    assertType(typeof obj.compareBaseline === 'string', 'compareBaseline', 'a string')
    config.compareBaseline = obj.compareBaseline as string
  }
  if (obj.writeBaseline !== undefined) {
    assertType(typeof obj.writeBaseline === 'string', 'writeBaseline', 'a string')
    config.writeBaseline = obj.writeBaseline as string
  }
  if (obj.maxGrowth !== undefined) {
    assertType(
      typeof obj.maxGrowth === 'number' && Number.isFinite(obj.maxGrowth) && obj.maxGrowth >= 0,
      'maxGrowth',
      'a non-negative finite number (percent)',
    )
    config.maxGrowth = obj.maxGrowth as number
  }
  if (obj.shard !== undefined) {
    assertType(typeof obj.shard === 'string', 'shard', 'a string of the form "<i>/<n>"')
    config.shard = obj.shard as string
  }

  return config
}

/** Validated against the schema before any browser launches (010 §8.1). */
export async function loadConfigFile(path: string): Promise<CliConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new ConfigError(`config: could not read "${path}" (${err instanceof Error ? err.message : String(err)})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(`config: "${path}" is not valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
  return validateConfig(parsed)
}
