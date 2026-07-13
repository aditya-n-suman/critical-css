/**
 * CSS coverage session types (docs/design/100-Browser-Abstraction.md §8.2,
 * docs/design/700-Coverage-Mode.md, ADR-0005).
 *
 * Coverage is acquired ONLY through the browser abstraction — never a
 * parallel CDP connection (ADR-0003 / two-CDP-sessions instability). The
 * adapter uses Playwright's Chromium CSS-coverage API, its sanctioned CDP
 * integration (CSS.startRuleUsageTracking under the hood).
 */

export interface CssCoverageRange {
  /** Byte offset into the stylesheet source text (inclusive). */
  readonly start: number
  /** Byte offset (exclusive). */
  readonly end: number
}

export interface CssCoverageEntry {
  /** Stylesheet URL; the page URL for inline `<style>` content. */
  readonly url: string
  /** Full stylesheet source text. */
  readonly text: string
  /** Byte ranges that were actually used (applied) during the page's life. */
  readonly ranges: readonly CssCoverageRange[]
}

export interface RawCssCoverage {
  readonly entries: readonly CssCoverageEntry[]
}

/**
 * A live coverage session. Page-scoped: created before navigation, stopped
 * after stabilization. Cannot outlive its PageHandle (100 §8.2).
 */
export interface CoverageSession {
  stop(): Promise<RawCssCoverage>
}
