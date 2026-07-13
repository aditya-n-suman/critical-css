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
  readonly minify?: boolean
  readonly format?: Format
  readonly sandboxPolicy?: SandboxPolicy
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
  const known = new Set(['url', 'viewport', 'viewports', 'mode', 'output', 'report', 'minify', 'format', 'sandboxPolicy'])
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) throw new ConfigError(`config: unknown field "${key}"`)
  }

  const config: {
    url?: string
    viewports?: readonly ViewportName[]
    mode?: Mode
    output?: string
    report?: string
    minify?: boolean
    format?: Format
    sandboxPolicy?: SandboxPolicy
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
