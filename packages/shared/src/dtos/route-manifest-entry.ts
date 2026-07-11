/**
 * RouteManifestEntry — maps route path patterns (exact + wildcard, e.g.
 * `/blog/*`) to output CSS bundle identifiers, per REQ-350/REQ-352.
 */

import type { ExtractionOptions } from './extraction-options.js'

export interface RouteManifestEntry {
  /** Route pattern: exact (`/`) or wildcard (`/blog/*`). */
  readonly routePattern: string
  /** Output CSS file path / bundle identifier for the pattern. */
  readonly outputPath: string
  /** Per-route override of the global extraction options. */
  readonly optionsOverride?: Partial<ExtractionOptions>
}
