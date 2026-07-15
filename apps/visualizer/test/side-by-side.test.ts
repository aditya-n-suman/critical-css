import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { buildCriticalHtml } from '../src/viewmodel/side-by-side.js'

// Mirrors server.ts's `renderSideBySide`, which places `buildCriticalHtml`'s
// `.html` output verbatim into `<iframe srcdoc="${escapeHtml(...)}">`.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PAGE_HTML = `<!doctype html>
<html>
<head>
<title>t</title>
<link rel="stylesheet" href="/a.css">
<style>.x { color: red; }</style>
<link rel="stylesheet" href="/b.css">
</head>
<body><div class="hero">hi</div></body>
</html>`

describe('buildCriticalHtml', () => {
  it('strips every <link rel=stylesheet> and <style> tag', () => {
    const result = buildCriticalHtml(PAGE_HTML, '.hero{color:blue}')
    expect(result.html).not.toContain('<link')
    expect(result.strippedStylesheetCount).toBe(2)
    expect(result.strippedInlineStyleCount).toBe(1)
  })

  it('injects the critical CSS as a single <style> block right after <head>', () => {
    const result = buildCriticalHtml(PAGE_HTML, '.hero{color:blue}')
    expect(result.html).toContain('<style data-ccss-visualizer="critical">.hero{color:blue}</style>')
    expect(result.html.indexOf('<head>')).toBeLessThan(result.html.indexOf('data-ccss-visualizer'))
  })

  it('preserves body content untouched', () => {
    const result = buildCriticalHtml(PAGE_HTML, '')
    expect(result.html).toContain('<div class="hero">hi</div>')
  })

  it('prepends the style block when there is no <head> tag at all', () => {
    const result = buildCriticalHtml('<body>no head here</body>', '.a{color:red}')
    expect(result.html.startsWith('<style data-ccss-visualizer="critical">')).toBe(true)
    expect(result.strippedStylesheetCount).toBe(0)
    expect(result.strippedInlineStyleCount).toBe(0)
  })

  it('regression (SHOULD-FIX, same class as the overlay.ts BLOCKER): critical CSS containing a </style>-breakout sequence cannot execute script once embedded in the real iframe[srcdoc] rendering context', () => {
    // `criticalCss` is serializer output today, but the serializer's job is to
    // faithfully reproduce input CSS that can itself originate from an
    // untrusted page — e.g. a CSS custom property or generated-content string
    // value containing this sequence, verbatim, from a real stylesheet.
    const evilCss = 'body::after{content:"</STYLE><script>alert(2)</script>"}'
    const result = buildCriticalHtml(PAGE_HTML, evilCss)

    // Mirror server.ts's actual embedding of this output into an iframe.
    const outerHtml = `<!doctype html><html><body><iframe class="render" srcdoc="${escapeHtml(result.html)}"></iframe></body></html>`

    const outerDom = new JSDOM(outerHtml)
    const iframe = outerDom.window.document.querySelector('iframe.render')
    expect(iframe).not.toBeNull()
    const innerHtml = iframe!.getAttribute('srcdoc')
    expect(innerHtml).not.toBeNull()
    expect(innerHtml).toContain('alert(2)')

    // Real proof via a real HTML parser (jsdom/parse5), not a string check:
    // no <script> element may exist in the parsed inner document.
    const innerDom = new JSDOM(innerHtml!)
    expect(innerDom.window.document.querySelectorAll('script').length).toBe(0)
    const styleEl = innerDom.window.document.querySelector('style[data-ccss-visualizer="critical"]')
    expect(styleEl).not.toBeNull()
    expect(styleEl!.textContent).toContain('alert(2)')
  })
})
