/**
 * 1004 fold-overlay HTML generator (docs/design/1004-Visualization.md),
 * built from what `@critical-css/reporter`'s `ReportBundle` genuinely
 * carries — NOT from the `DiagnosticsBundle` 1004 §8.2 specifies as its
 * input.
 *
 * ## Disclosed gap vs 1004 (read before trusting this module's output)
 *
 * 1004 §8.2's `DiagnosticsBundle` supplies a `DomSnapshot` (per-node
 * bounding boxes), `foldY` (105 §8.3's fold scalar), and
 * per-node `VisibilityAnnotation`s (`reasonPrimary`/`reasonChain`, 200-series
 * taxonomy). `packages/reporter`'s actual `ReportBundle` (src/reports.ts)
 * has **none of these** — this repo's Reporter never persists a DOM
 * snapshot, a fold coordinate, or a visibility classification to disk (see
 * `packages/reporter/src/trace.ts`'s own header comment, which discloses the
 * identical gap for `visibilityReason` on trace decision events). Therefore
 * this module CANNOT render:
 *   - a fold line (§7.2 item 2) — no `foldY` exists anywhere downstream of
 *     extraction;
 *   - per-node color-coded boxes keyed by `reasonPrimary` (§8.3) — no
 *     visibility classification survives past the pipeline's internal
 *     Visibility Engine into any persisted artifact;
 *   - a DOM-mirror overlay of absolutely-positioned boxes (§7.2 item 1) — no
 *     bounding-box geometry is persisted.
 *
 * What this module DOES render, genuinely, from `ReportBundle` fields that
 * exist:
 *   - **Matched-rule highlighting** (§7.2 item 4): when the caller supplies
 *     the original page HTML (this module never fetches or fabricates it —
 *     see `buildOverlayHtml`'s `pageHtml` parameter, mirroring
 *     `viewmodel/side-by-side.ts`'s identical constraint), every matched
 *     selector's `selectorText` is used as a real CSS selector in an injected
 *     `<style>` outline rule (see `css-injection-safety.ts` for why literal
 *     `<` characters are CSS-escaped first — `selectorText` is
 *     attacker-influenced whenever this tool runs against a third-party
 *     page, which is its actual use case, and needs escaping for the HTML
 *     context it's placed in, not a substring blocklist). This is not a
 *     re-implementation of
 *     selector matching — it delegates to the viewer's own browser CSS
 *     engine to resolve the same selector text the Matcher already recorded
 *     as matched, so the highlight is real (an actual `element.matches()`-
 *     equivalent evaluation by a real browser), even though this module
 *     computed no geometry itself.
 *   - A companion match/unmatched table (§7.2 item 4's "companion data
 *     table"), reusing `viewmodel/matched-rules.ts` and
 *     `viewmodel/unmatched-selectors.ts` unchanged.
 *   - A legend (§7.2 item 5) that documents this exact gap inline, so the
 *     artifact is self-describing without this file's comment open beside
 *     it, per 1004 §7.2's own requirement.
 *
 * When no `pageHtml` is supplied, the artifact degrades to the summary
 * table alone (no highlighting is possible without markup to highlight),
 * with a banner explaining why.
 */

import type { ReportBundle } from '@critical-css/reporter'
import { buildMatchedRuleGroups } from './viewmodel/matched-rules.js'
import { buildUnmatchedRuleGroups } from './viewmodel/unmatched-selectors.js'
import { escapeCssLessThan } from './css-injection-safety.js'

const STYLE_TAG_CLOSE_RE = /<\/head>/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** CSS-escapes a selector for safe embedding inside a `<style>` block's selector list. */
function safeSelectorForInjection(selectorText: string): string | null {
  // A selector containing an unescaped `{`/`}` could terminate our declaration
  // block early and splice arbitrary CSS rules into this document's <style>
  // block — skipped rather than injected verbatim, since a real selector's
  // own attribute-value braces would already come CSS-string-escaped in a
  // real CSSOM's `selectorText`. (HTML-breakout safety is handled separately,
  // for every character including these, by `escapeCssLessThan` — see
  // `./css-injection-safety.ts` — this guard is about CSS-rule-injection,
  // not HTML-injection.)
  if (selectorText.includes('{') || selectorText.includes('}')) return null
  return escapeCssLessThan(selectorText)
}

export interface OverlayOptions {
  /**
   * The original page HTML for this (route, viewport, mode) run, if the
   * caller has it on hand (e.g. `server.ts` fetching `bundle.route` live, or
   * a cached copy). Omit to get the degraded, highlight-free summary-only
   * artifact — never fabricated by this module.
   */
  readonly pageHtml?: string
}

/**
 * Builds one self-contained HTML artifact for a single `ReportBundle`,
 * mirroring 1004 §8.6's "single-file packaging" (inline CSS, no external
 * assets) as closely as this module's available data permits.
 */
export function buildOverlayHtml(bundle: ReportBundle, options: OverlayOptions = {}): string {
  const matchedGroups = buildMatchedRuleGroups(bundle.matchedSelectors.rows)
  const unmatchedGroups = buildUnmatchedRuleGroups(bundle.unmatchedSelectors.rows)

  const injectableSelectors = bundle.matchedSelectors.rows
    .map((r) => safeSelectorForInjection(r.selectorText))
    .filter((s): s is string => s !== null)
  // Stable order for deterministic output (1004 §11 "deterministic output").
  const uniqueSelectors = [...new Set(injectableSelectors)].sort()

  const highlightCss =
    uniqueSelectors.length > 0
      ? `${uniqueSelectors.map((s) => `${s}`).join(',\n')} {\n  outline: 2px solid #2e9e3b !important;\n  outline-offset: -1px !important;\n}`
      : ''

  const hasPage = options.pageHtml !== undefined && options.pageHtml.length > 0

  let pageSection: string
  if (hasPage) {
    const injected = `<style data-ccss-overlay="matched-rule-highlight">\n${highlightCss}\n</style>`
    const withHighlight = STYLE_TAG_CLOSE_RE.test(options.pageHtml!)
      ? options.pageHtml!.replace(STYLE_TAG_CLOSE_RE, (m) => `${injected}${m}`)
      : `${injected}${options.pageHtml}`
    pageSection = `
      <section class="page-frame">
        <h2>Rendered page (matched selectors outlined green)</h2>
        <iframe class="page-iframe" title="page with matched-rule highlighting" sandbox="allow-same-origin" srcdoc="${escapeHtml(withHighlight)}"></iframe>
      </section>`
  } else {
    pageSection = `
      <section class="page-frame page-frame--missing">
        <h2>Rendered page</h2>
        <p class="banner">No page HTML was supplied for this run, so no highlighted render is shown here — this module never
        fetches or fabricates page markup on its own (see this file's doc comment, "Disclosed gap vs 1004"). The
        matched/unmatched tables below still reflect real Reporter data.</p>
      </section>`
  }

  const matchedRowsHtml = matchedGroups
    .map(
      (g) => `
        <details open>
          <summary>${escapeHtml(g.stylesheetHref ?? '(inline)')} — ${g.rows.length} matched selector(s), ${g.totalMatchedNodes} matched node(s)</summary>
          <table>
            <thead><tr><th>Selector</th><th>Matched nodes</th><th>Rule path</th></tr></thead>
            <tbody>
              ${g.rows
                .map(
                  (r) =>
                    `<tr><td><code>${escapeHtml(r.selectorText)}</code></td><td>${r.matchedNodeCount}</td><td>${escapeHtml(r.ruleIndexPath.join('.'))}</td></tr>`,
                )
                .join('\n')}
            </tbody>
          </table>
        </details>`,
    )
    .join('\n')

  const unmatchedRowsHtml = unmatchedGroups
    .map(
      (g) => `
        <details>
          <summary>${escapeHtml(g.stylesheetHref ?? '(inline)')} — ${g.rows.length} unmatched selector(s)</summary>
          <table>
            <thead><tr><th>Selector</th><th>Hint</th></tr></thead>
            <tbody>
              ${g.rows
                .map((r) => `<tr><td><code>${escapeHtml(r.selectorText)}</code></td><td>${escapeHtml(r.hint)}</td></tr>`)
                .join('\n')}
            </tbody>
          </table>
        </details>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en" data-ccss-overlay-artifact="1004-degraded">
<head>
<meta charset="utf-8" />
<title>Fold overlay — ${escapeHtml(bundle.route)} (${escapeHtml(bundle.viewportProfileId)})</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; line-height: 1.4; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .subtitle { color: #666; margin: 0 0 16px; font-size: 13px; }
  .legend { border: 1px solid #999; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }
  .legend strong { color: #2e9e3b; }
  .gap-banner { border: 1px solid #b45309; background: rgba(180,83,9,0.08); border-radius: 6px; padding: 12px 16px; font-size: 13px; margin-bottom: 16px; }
  .page-frame { margin-bottom: 24px; }
  .page-iframe { width: 100%; height: 480px; border: 1px solid #999; border-radius: 6px; }
  .banner { border: 1px dashed #999; border-radius: 6px; padding: 12px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  code { font-family: ui-monospace, monospace; }
  details summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
</style>
</head>
<body>
  <h1>Fold overlay: ${escapeHtml(bundle.route)}</h1>
  <p class="subtitle">viewport=${escapeHtml(bundle.viewportProfileId)} · mode=${escapeHtml(bundle.mode)}</p>

  <div class="gap-banner">
    <strong>Disclosed gap vs docs/design/1004-Visualization.md:</strong> this artifact has no fold line and no
    per-node visibility color-coding (§8.3's <code>reasonPrimary</code> palette) because <code>ReportBundle</code>
    (packages/reporter) does not persist a <code>DomSnapshot</code>, a fold Y-coordinate, or any visibility
    classification — those never leave the extraction pipeline's in-memory state. This artifact instead highlights
    matched selectors directly on the real page (when supplied) via genuine CSS selector matching, not a
    reconstruction of node geometry. See this repo's <code>overlay.ts</code> doc comment for the full disclosure.
  </div>

  <div class="legend"><strong>■ green outline</strong> = element matched by at least one selector in the matched-selector report (real <code>element.matches()</code>-equivalent evaluation by your browser, not a fabricated position).</div>

  ${pageSection}

  <h2>Matched selectors (${bundle.matchedSelectors.count})</h2>
  ${matchedRowsHtml || '<p>No matched selectors.</p>'}

  <h2>Unmatched selectors (${bundle.unmatchedSelectors.count})</h2>
  ${unmatchedRowsHtml || '<p>No unmatched selectors.</p>'}
</body>
</html>
`
}
