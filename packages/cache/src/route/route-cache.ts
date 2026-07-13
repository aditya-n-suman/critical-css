/**
 * RouteCache — route-manifest-keyed cache policy
 * (docs/design/803-Route-Cache.md §8.1, §8.4, §8.7).
 *
 * Maps concrete URLs onto a bounded set of cache entries via the route
 * manifest: URLs sharing one template collapse to one entry, while the
 * template fingerprint (801) still guarantees a template change invalidates
 * every URL under the pattern — invalidation is a property of the KEY, not
 * an action on the store.
 */

import type { RouteManifestEntry } from '@critical-css/shared'
import { sha256Hex } from '../hash.js'
import { RoutePatternMatcher, normalizeUrl } from './route-pattern.js'

/** Internal, rich manifest schema (803 §8.1). */
export interface RouteDescriptor {
  /** Stable route identity, e.g. `"blog"` (derived from `outputName`). */
  readonly id: string
  /** `"/"`, `"/products"`, `"/blog/*"`, `"/docs/:section/*"` */
  readonly pattern: string
  /** Artifact name, e.g. `"blog.css"` (BRIEF §2.9). */
  readonly outputName: string
  /** `true` ⇒ all matching URLs collapse to one entry (default true). */
  readonly shareGroup: boolean
  /** Named params that DO affect rendering — controlled de-collapse (803 §8.1). */
  readonly paramsInFingerprint: readonly string[]
  /** Representative concrete URLs for verifying mode. */
  readonly sampleUrls: readonly string[]
}

export interface RouteManifest {
  readonly version: number
  readonly routes: readonly RouteDescriptor[]
}

/** Authored per-route options beyond the compact `pattern → outputName` form. */
export interface RouteDescriptorInit {
  readonly outputName: string
  readonly shareGroup?: boolean
  readonly paramsInFingerprint?: readonly string[]
  readonly sampleUrls?: readonly string[]
}

/**
 * Expand the authored compact form `{ "/blog/*": "blog.css" }` (or the rich
 * per-route init) into the internal `RouteManifest` (803 §8.1).
 */
export function expandRouteManifest(
  authored: Readonly<Record<string, string | RouteDescriptorInit>>,
): RouteManifest {
  const routes: RouteDescriptor[] = []
  for (const [pattern, value] of Object.entries(authored)) {
    const init: RouteDescriptorInit = typeof value === 'string' ? { outputName: value } : value
    routes.push({
      id: deriveRouteId(init.outputName),
      pattern,
      outputName: init.outputName,
      shareGroup: init.shareGroup ?? true,
      paramsInFingerprint: init.paramsInFingerprint ?? [],
      sampleUrls: init.sampleUrls ?? [],
    })
  }
  return { version: 1, routes }
}

/** Compose the manifest back into shared `RouteManifestEntry` DTOs. */
export function toRouteManifestEntries(manifest: RouteManifest): RouteManifestEntry[] {
  return manifest.routes.map((route) => ({
    routePattern: route.pattern,
    outputPath: route.outputName,
  }))
}

function deriveRouteId(outputName: string): string {
  return outputName.replace(/\.css$/i, '')
}

export interface RouteKeyResolution {
  /** The store key to read/write under. */
  readonly key: string
  /** `null` for unmatched URLs (per-URL fallback, 803 §8.7). */
  readonly descriptor: RouteDescriptor | null
  readonly params: Readonly<Record<string, string>>
}

/**
 * URL → pattern → key resolution (803 §8.4/§10.1).
 *
 * routeKey = digest(base ⊕ templateFingerprint ⊕ viewportProfileId ⊕
 *                   selectedParams), where `base` is the route id for
 * shareGroup routes (collapse) or the normalized URL otherwise.
 */
export class RouteCache {
  private readonly matcher: RoutePatternMatcher
  private readonly byPattern: ReadonlyMap<string, RouteDescriptor>

  constructor(private readonly manifest: RouteManifest) {
    this.matcher = new RoutePatternMatcher(manifest.routes.map((r) => r.pattern))
    this.byPattern = new Map(manifest.routes.map((r) => [r.pattern, r]))
  }

  get routes(): readonly RouteDescriptor[] {
    return this.manifest.routes
  }

  resolveRouteKey(
    url: string,
    templateFingerprint: string,
    viewportProfileId: string,
  ): RouteKeyResolution {
    const clean = normalizeUrl(url)
    const match = this.matcher.match(clean)
    if (match === null) {
      // Unmatched URLs degrade to individual caching, never dropped (803 §8.7).
      return {
        key: digestKey([clean, templateFingerprint, viewportProfileId]),
        descriptor: null,
        params: {},
      }
    }
    const descriptor = this.byPattern.get(match.pattern)
    if (descriptor === undefined) {
      // Unreachable by construction; treat as unmatched.
      return {
        key: digestKey([clean, templateFingerprint, viewportProfileId]),
        descriptor: null,
        params: match.params,
      }
    }
    const base = descriptor.shareGroup ? descriptor.id : clean
    const selectedParams = descriptor.paramsInFingerprint
      .map((name) => `${name}=${match.params[name] ?? ''}`)
      .sort()
    return {
      key: digestKey([base, templateFingerprint, viewportProfileId, ...selectedParams]),
      descriptor,
      params: match.params,
    }
  }
}

/**
 * Collision-proof key digest: each component is length-prefixed, so no input
 * byte can act as a delimiter — component boundaries are unambiguous even if
 * a component contains NULs, `=`, or any other byte (803 §12 defence in
 * depth; normalizeUrl additionally never emits control characters).
 */
function digestKey(components: readonly string[]): string {
  return sha256Hex(components.map((c) => `${c.length}:${c}`).join(''))
}
