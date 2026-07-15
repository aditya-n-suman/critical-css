/**
 * Side-by-side full-CSS vs critical-CSS render (docs/design/1005-Debug-UI.md
 * §8.3.2). "This view is a render, not a re-extraction: it never asks a
 * browser to compute visibility or matching again."
 *
 * Gap vs 1005 §8.3.2: the spec's two iframes both come "from the cached
 * `CacheEntry`" — but `packages/cache`'s `CacheEntry` (store/types.ts) only
 * persists the critical CSS text, never the original page HTML. There is no
 * artifact anywhere in this repo's persisted output that reproduces "the same
 * HTML, full stylesheet bundle." This module's `buildCriticalHtml` therefore
 * takes the ORIGINAL page HTML as an explicit input the caller must supply
 * (the dev-mode server fetches it live from `bundle.route` at request time —
 * see server.ts; export mode cannot, and says so — see README "Scope cuts"),
 * not something this app persists or re-derives itself.
 *
 * This function is pure string transformation (regex-based tag stripping),
 * not a CSSOM operation and not a selector-matching operation — it performs
 * no re-extraction, per the architectural boundary in 1005 §7.2/§8.1.
 *
 * `criticalCss` is escaped before injection via `escapeCssLessThan` (see
 * `../css-injection-safety.ts`). Today `criticalCss` originates from this
 * repo's own serializer output, but the serializer's job is to faithfully
 * reproduce input CSS — which can itself originate from an untrusted page —
 * so the same `</style`-breakout trust boundary that applies to
 * `overlay.ts`'s matched-selector highlighting applies here too.
 */

import { escapeCssLessThan } from '../css-injection-safety.js'

const STYLESHEET_LINK_RE = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi
const STYLE_TAG_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi
const HEAD_OPEN_RE = /<head[^>]*>/i

export interface CriticalHtmlResult {
  readonly html: string
  readonly strippedStylesheetCount: number
  readonly strippedInlineStyleCount: number
}

/**
 * Strips `<link rel="stylesheet">` and `<style>` tags from `pageHtml` and
 * injects `criticalCss` as a single `<style>` block right after `<head>`,
 * mirroring what an SSR adapter ships (703-Visual-Diff.md's R_crit
 * construction, reused here for rendering only).
 */
export function buildCriticalHtml(pageHtml: string, criticalCss: string): CriticalHtmlResult {
  const stylesheetMatches = pageHtml.match(STYLESHEET_LINK_RE) ?? []
  const styleMatches = pageHtml.match(STYLE_TAG_RE) ?? []
  let stripped = pageHtml.replace(STYLESHEET_LINK_RE, '').replace(STYLE_TAG_RE, '')

  const injected = `<style data-ccss-visualizer="critical">${escapeCssLessThan(criticalCss)}</style>`
  if (HEAD_OPEN_RE.test(stripped)) {
    stripped = stripped.replace(HEAD_OPEN_RE, (m) => `${m}${injected}`)
  } else {
    stripped = `${injected}${stripped}`
  }

  return {
    html: stripped,
    strippedStylesheetCount: stylesheetMatches.length,
    strippedInlineStyleCount: styleMatches.length,
  }
}
