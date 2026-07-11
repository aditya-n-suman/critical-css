/**
 * Structured diagnostic entry, per docs/design/1000-Diagnostics-Overview.md.
 *
 * Diagnostics are data, not console noise (Design Principle 6 — Fail-Fast
 * Diagnostics): every module that can partially fail emits `Diagnostic`
 * records that the Reporter renders uniformly.
 */

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/** Location in a source artifact (stylesheet, page URL) a diagnostic refers to. */
export interface DiagnosticSourceLocation {
  /** URL of the artifact (page, stylesheet). `null` for inline/synthetic sources. */
  readonly url: string | null
  readonly line?: number
  readonly column?: number
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  /**
   * Stable, machine-readable code, e.g. `NAVIGATION_TIMEOUT`,
   * `CROSS_ORIGIN_STYLESHEET_SKIPPED`, `CLOSED_SHADOW_ROOT`.
   */
  readonly code: string
  /** Human-readable message. */
  readonly message: string
  readonly source?: DiagnosticSourceLocation
  /** Structured, JSON-serializable context (route, viewport, elapsed ms, …). */
  readonly context?: Readonly<Record<string, unknown>>
}
