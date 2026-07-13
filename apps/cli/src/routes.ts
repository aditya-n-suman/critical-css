/**
 * Route-manifest loading and expansion into concrete work units
 * (BRIEF.md §2.9, docs/design/803-Route-Cache.md §8.1, BI-11.3).
 *
 * Accepts the authored compact form `{ "/": "home.css", "/blog/*":
 * "blog.css" }` (values may also be the rich `RouteDescriptorInit` object —
 * `outputName`, `sampleUrls`, `shareGroup`, `paramsInFingerprint`) and
 * expands it via `expandRouteManifest` from `@critical-css/cache`. Each
 * descriptor becomes one work unit with a concrete URL:
 *
 *  - literal patterns resolve directly against `--base-url`;
 *  - glob/param patterns (`/blog/*`, `/docs/:section`) need a representative
 *    concrete URL, which 803 §8.1 provides as `sampleUrls` — the first sample
 *    is used (trusting mode: one extraction per template). A glob pattern
 *    without samples is a manifest authoring error, rejected before any
 *    browser launches (010 §8.1 "validate before launch").
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import {
  RouteCache,
  expandRouteManifest,
  toRouteManifestEntries,
  type RouteDescriptor,
  type RouteDescriptorInit,
  type RouteManifest,
} from '@critical-css/cache'
import { ConfigError } from './config.js'

export interface RouteWorkUnit {
  readonly pattern: string
  /** Artifact path relative to `--out-dir` (BRIEF §2.9 manifest value). */
  readonly outputPath: string
  /** The concrete URL this route is extracted from. */
  readonly url: string
  readonly descriptor: RouteDescriptor
}

export interface LoadedRoutes {
  readonly manifest: RouteManifest
  readonly routeCache: RouteCache
  readonly units: readonly RouteWorkUnit[]
}

function isDescriptorInit(value: unknown): value is RouteDescriptorInit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.outputName !== 'string' || obj.outputName === '') return false
  if (obj.shareGroup !== undefined && typeof obj.shareGroup !== 'boolean') return false
  const isStringArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((s) => typeof s === 'string')
  if (obj.sampleUrls !== undefined && !isStringArray(obj.sampleUrls)) return false
  if (obj.paramsInFingerprint !== undefined && !isStringArray(obj.paramsInFingerprint)) return false
  return true
}

/** Validate the authored JSON against the compact/rich manifest schema. */
export function validateAuthoredManifest(
  raw: unknown,
  sourcePath: string,
): Record<string, string | RouteDescriptorInit> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`routes: "${sourcePath}" must be a JSON object mapping pattern → output`)
  }
  const authored: Record<string, string | RouteDescriptorInit> = {}
  for (const [pattern, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!pattern.startsWith('/')) {
      throw new ConfigError(`routes: pattern "${pattern}" must start with "/"`)
    }
    if (typeof value === 'string') {
      if (value === '') throw new ConfigError(`routes: pattern "${pattern}" has an empty output name`)
      authored[pattern] = value
    } else if (isDescriptorInit(value)) {
      authored[pattern] = value
    } else {
      throw new ConfigError(
        `routes: pattern "${pattern}" must map to an output filename or a { outputName, sampleUrls?, shareGroup?, paramsInFingerprint? } object`,
      )
    }
  }
  if (Object.keys(authored).length === 0) {
    throw new ConfigError(`routes: "${sourcePath}" declares no routes`)
  }
  return authored
}

/**
 * A manifest's `outputName` values are artifact paths *relative to
 * `--out-dir`* (BRIEF §2.9) — an authored manifest must not be able to write
 * outside that directory. Absolute paths are rejected outright, and relative
 * paths must stay inside `resolve(outDir)` after resolution (prefix check
 * guarded with `path.sep` so `outdir-evil/` does not pass as inside
 * `outdir/`). Violations are manifest authoring errors (usage, exit 2).
 */
export function assertOutputPathWithinOutDir(
  outputName: string,
  outDir: string,
  pattern: string,
): void {
  if (isAbsolute(outputName)) {
    throw new ConfigError(
      `routes: pattern "${pattern}" has an absolute output path "${outputName}" — output names must be relative to --out-dir`,
    )
  }
  const root = resolve(outDir)
  const target = resolve(outDir, outputName)
  if (!target.startsWith(root + sep)) {
    throw new ConfigError(
      `routes: pattern "${pattern}" output path "${outputName}" escapes --out-dir ("${root}") — output names must stay within the output directory`,
    )
  }
}

const hasWildcards = (pattern: string): boolean =>
  pattern.split('/').some((seg) => seg === '*' || seg.startsWith(':'))

/** Resolve one descriptor to the concrete URL the crawl extracts. */
export function concreteUrlFor(descriptor: RouteDescriptor, baseUrl: string): string {
  if (!hasWildcards(descriptor.pattern)) {
    return new URL(descriptor.pattern, baseUrl).href
  }
  const sample = descriptor.sampleUrls[0]
  if (sample === undefined) {
    throw new ConfigError(
      `routes: pattern "${descriptor.pattern}" contains wildcards — provide "sampleUrls" with at least one representative concrete URL (803 §8.1)`,
    )
  }
  return new URL(sample, baseUrl).href
}

/** Load + validate the manifest file and expand it into work units. */
export async function loadRoutes(
  routesPath: string,
  baseUrl: string,
  outDir: string = '.',
): Promise<LoadedRoutes> {
  try {
    // Validates the base URL before any browser launches.
    new URL(baseUrl)
  } catch {
    throw new ConfigError(`--base-url must be an absolute URL, got: ${baseUrl}`)
  }
  let text: string
  try {
    text = await readFile(routesPath, 'utf8')
  } catch (err) {
    throw new ConfigError(
      `routes: could not read "${routesPath}" (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      `routes: "${routesPath}" is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  const authored = validateAuthoredManifest(parsed, routesPath)
  const manifest = expandRouteManifest(authored)
  // RouteCache construction also rejects duplicate/ambiguous patterns at
  // load time (803 §8.3) — before any extraction starts.
  const routeCache = new RouteCache(manifest)
  // Compose back into the shared RouteManifestEntry DTO for output paths —
  // the documented DTO seam between the cache policy and the orchestrator.
  const entries = toRouteManifestEntries(manifest)
  const units: RouteWorkUnit[] = manifest.routes.map((descriptor, i) => {
    const outputPath = entries[i]?.outputPath ?? descriptor.outputName
    // Reject escapes at load time — before any extraction starts (010 §8.1).
    assertOutputPathWithinOutDir(outputPath, outDir, descriptor.pattern)
    return {
      pattern: descriptor.pattern,
      outputPath,
      url: concreteUrlFor(descriptor, baseUrl),
      descriptor,
    }
  })
  return { manifest, routeCache, units }
}
