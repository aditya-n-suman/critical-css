import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { ReportBundle } from '@critical-css/reporter'
import { buildOverlayHtml } from '../src/overlay.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

async function loadHomeDesktop(): Promise<ReportBundle> {
  const raw = await readFile(join(FIXTURES, 'reports', 'home.css.report.json'), 'utf8')
  const bundles = JSON.parse(raw) as ReportBundle[]
  const bundle = bundles.find((b) => b.viewportProfileId === 'desktop')
  if (bundle === undefined) throw new Error('fixture missing desktop bundle')
  return bundle
}

const PAGE_HTML = `<!doctype html>
<html><head><title>t</title></head>
<body><div class="hero"><h1>Home above the fold</h1></div><footer class="footer">bye</footer></body></html>`

describe('buildOverlayHtml', () => {
  it('produces a complete, well-formed standalone HTML document', async () => {
    const bundle = await loadHomeDesktop()
    const html = buildOverlayHtml(bundle)
    expect(html.trim().startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain(bundle.route)
  })

  it('discloses the fold-line/DOM-snapshot gap in every artifact, with or without pageHtml', async () => {
    const bundle = await loadHomeDesktop()
    const withoutPage = buildOverlayHtml(bundle)
    const withPage = buildOverlayHtml(bundle, { pageHtml: PAGE_HTML })
    for (const html of [withoutPage, withPage]) {
      expect(html).toContain('Disclosed gap')
      expect(html).toContain('no fold line')
    }
  })

  it('without pageHtml, renders the degraded summary-only state (no highlighted iframe)', async () => {
    const bundle = await loadHomeDesktop()
    const html = buildOverlayHtml(bundle)
    expect(html).not.toContain('<iframe')
    expect(html).toContain('No page HTML was supplied')
  })

  it('with pageHtml, injects a real CSS rule per matched selector for genuine browser-side highlighting', async () => {
    const bundle = await loadHomeDesktop()
    const html = buildOverlayHtml(bundle, { pageHtml: PAGE_HTML })
    expect(html).toContain('<iframe')
    expect(html).toContain('matched-rule-highlight')
    // .hero and .hero h1 are matched selectors in the home fixture — the injected
    // srcdoc (HTML-escaped) must contain the escaped selector text.
    expect(html).toContain('.hero')
  })

  it('lists every matched and unmatched selector row from the real bundle', async () => {
    const bundle = await loadHomeDesktop()
    const html = buildOverlayHtml(bundle)
    for (const row of bundle.matchedSelectors.rows) {
      expect(html).toContain(row.selectorText)
    }
    for (const row of bundle.unmatchedSelectors.rows) {
      expect(html).toContain(row.selectorText)
    }
  })

  it('is deterministic: identical input produces byte-identical output', async () => {
    const bundle = await loadHomeDesktop()
    expect(buildOverlayHtml(bundle)).toBe(buildOverlayHtml(bundle))
  })

  it('refuses to inject a selector containing brace characters (defensive guard, not expected in real data)', () => {
    const bundle: ReportBundle = {
      route: '/x',
      viewportProfileId: 'desktop',
      mode: 'cssom',
      matchedSelectors: {
        count: 1,
        rows: [{ selectorText: '.a{evil:1}', stylesheetHref: null, ruleIndexPath: [0], matchedNodeCount: 1 }],
      },
      unmatchedSelectors: { count: 0, rows: [] },
      timing: { stages: [], totalMs: 0 },
      stylesheetContribution: { stylesheets: [], totalBytes: 0 },
      dependencyGraph: { nodes: [], edges: [] },
      extractionTrace: { spans: [] },
    }
    const html = buildOverlayHtml(bundle, { pageHtml: '<html><head></head><body></body></html>' })
    // srcdoc is HTML-escaped in the outer document; match the escaped form.
    const styleBlockMatch = /data-ccss-overlay=&quot;matched-rule-highlight&quot;&gt;([\s\S]*?)&lt;\/style&gt;/.exec(html)
    expect(styleBlockMatch?.[1]?.trim()).toBe('')
  })

  it('regression (BLOCKER, confirmed by reviewer): a real-CSSOM-producible selector cannot break out of the injected <style> block and execute script', () => {
    // This exact string is a realistic `selectorText`: a real CSSOM will hand back
    // `[data-x="</STYLE><script>alert(1)</script>"]` verbatim from a genuinely
    // valid, parseable stylesheet rule on a third-party page — the tool's actual
    // use case. The previous guard (`selectorText.includes('</style')`,
    // case-sensitive) never matched this uppercase `</STYLE>` variant, so the
    // payload was injected unescaped into the artifact's <style> block, which is
    // itself later placed into an iframe `srcdoc` — HTML tag matching there is
    // case-insensitive, so `</STYLE>` closes the <style> tag exactly like
    // `</style>` would, letting the following <script> execute.
    const evilSelector = '[data-x="</STYLE><script>alert(1)</script>"]'
    const bundle: ReportBundle = {
      route: '/x',
      viewportProfileId: 'desktop',
      mode: 'cssom',
      matchedSelectors: {
        count: 1,
        rows: [{ selectorText: evilSelector, stylesheetHref: null, ruleIndexPath: [0], matchedNodeCount: 1 }],
      },
      unmatchedSelectors: { count: 0, rows: [] },
      timing: { stages: [], totalMs: 0 },
      stylesheetContribution: { stylesheets: [], totalBytes: 0 },
      dependencyGraph: { nodes: [], edges: [] },
      extractionTrace: { spans: [] },
    }
    const html = buildOverlayHtml(bundle, { pageHtml: '<html><head></head><body></body></html>' })

    // Real proof, not a string check: parse the outer artifact with a real HTML
    // parser (jsdom/parse5), read the iframe's `srcdoc` *as the DOM API returns
    // it* (i.e. HTML-attribute-decoded, exactly as a real browser would hand it
    // to the iframe's nested document parse), then parse THAT as its own HTML
    // document — the same two-stage parse a browser performs for
    // `<iframe srcdoc="...">`.
    const outerDom = new JSDOM(html)
    const iframe = outerDom.window.document.querySelector('iframe.page-iframe')
    expect(iframe).not.toBeNull()
    const innerHtml = iframe!.getAttribute('srcdoc')
    expect(innerHtml).not.toBeNull()
    // The payload text is genuinely present (not silently dropped) ...
    expect(innerHtml).toContain('alert(1)')

    const innerDom = new JSDOM(innerHtml!)
    // ... but a real HTML parser must never have materialized a <script> element
    // from it: the fix must make the <style> block swallow the whole payload as
    // inert raw text, not merely hide the substring from a naive string search.
    expect(innerDom.window.document.querySelectorAll('script').length).toBe(0)
    const styleEl = innerDom.window.document.querySelector('style[data-ccss-overlay="matched-rule-highlight"]')
    expect(styleEl).not.toBeNull()
    // The <style> element's parsed text content contains the full payload,
    // proving it was consumed as raw text inside the style block rather than
    // prematurely closing it.
    expect(styleEl!.textContent).toContain('alert(1)')
  })
})
