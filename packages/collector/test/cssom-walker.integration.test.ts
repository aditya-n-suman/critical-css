/**
 * CSSOM Walker acceptance tests (docs/tasks/002): real Playwright page, no
 * DOM mocks. Covers nested at-rule traversal, source order, <style>/<link>
 * distinction, and the cross-origin SecurityError path (via two local HTTP
 * servers on different ports = different origins).
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserManager } from '@critical-css/browser'
import type { PageHandle } from '@critical-css/browser'
import { collect } from '../src/index.js'

const LINKED_CSS = 'h1 { color: rgb(0, 128, 0); }\n'
const PAGE_CSS = `
p { margin: 0; }
@media (max-width: 600px) {
  .responsive { display: none; }
  @supports (display: grid) {
    .grid-fallback { display: block; }
  }
}
@layer base {
  .layered { color: blue; }
}
`

function startServer(handler: (url: string) => { body: string; type: string } | null): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const payload = handler(req.url ?? '/')
      if (payload === null) {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('content-type', payload.type)
      // Deliberately NO Access-Control-Allow-Origin on CSS responses:
      // the cross-origin sheet must be CSSOM-inaccessible.
      res.end(payload.body)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const port = (s: Server): number => (s.address() as AddressInfo).port

describe('CssomWalker (real Chromium)', () => {
  let manager: BrowserManager
  let pageServer: Server
  let crossOriginServer: Server
  let handle: PageHandle

  beforeAll(async () => {
    crossOriginServer = await startServer((url) =>
      url === '/x.css' ? { body: '.cross { color: red; }', type: 'text/css' } : null,
    )
    pageServer = await startServer((url) => {
      if (url === '/same.css') return { body: LINKED_CSS, type: 'text/css' }
      if (url === '/') {
        return {
          type: 'text/html',
          body: `<!doctype html><html><head>
            <link rel="stylesheet" href="/same.css">
            <style>${PAGE_CSS}</style>
            <link rel="stylesheet" href="http://127.0.0.1:${port(crossOriginServer)}/x.css">
          </head><body><h1>hello</h1><p class="responsive">text</p></body></html>`,
        }
      }
      return null
    })
    manager = new BrowserManager({ maxConcurrency: 1 })
    handle = await manager.acquire()
    await handle.navigate(`http://127.0.0.1:${port(pageServer)}/`)
  })

  afterAll(async () => {
    await manager.release(handle)
    await manager.teardown()
    pageServer.close()
    crossOriginServer.close()
  })

  it('enumerates stylesheets in document order and distinguishes <link> vs <style>', async () => {
    const { cssom } = await collect(handle)
    expect(cssom.stylesheets).toHaveLength(3)
    expect(cssom.stylesheets.map((s) => s.origin)).toEqual(['link', 'style', 'link'])
    expect(cssom.stylesheets.map((s) => s.sourceStylesheetIndex)).toEqual([0, 1, 2])
    expect(cssom.stylesheets[0]?.href).toContain('/same.css')
    expect(cssom.stylesheets[1]?.href).toBeNull()
  })

  it('walks nested @media > @supports and @layer with full index paths', async () => {
    const { cssom } = await collect(handle)
    const inline = cssom.stylesheets[1]
    expect(inline?.accessible).toBe(true)
    const rules = inline?.rules ?? []

    const media = rules.find((r) => r.ruleType === 'media')
    expect(media?.conditionText).toBe('(max-width: 600px)')
    expect(media?.childRuleIds.length).toBe(2)

    const responsive = rules.find((r) => r.selectorText === '.responsive')
    expect(responsive?.ruleIndexPath).toEqual([1, 0])
    expect(responsive?.parentRuleId).toBe(media?.ruleId)

    const supports = rules.find((r) => r.ruleType === 'supports')
    expect(supports?.conditionText).toBe('(display: grid)')
    const gridFallback = rules.find((r) => r.selectorText === '.grid-fallback')
    expect(gridFallback?.ruleIndexPath).toEqual([1, 1, 0])

    const layer = rules.find((r) => r.ruleType === 'layer-block')
    expect(layer?.conditionText).toBe('base')
    const layered = rules.find((r) => r.selectorText === '.layered')
    expect(layered?.parentRuleId).toBe(layer?.ruleId)
  })

  it('records source order exactly, never re-sorted', async () => {
    const { cssom } = await collect(handle)
    const inline = cssom.stylesheets[1]
    const topLevel = (inline?.rules ?? []).filter((r) => r.parentRuleId === null)
    expect(topLevel.map((r) => r.sourceRuleIndex)).toEqual([0, 1, 2])
    expect(topLevel[0]?.selectorText).toBe('p')
  })

  it('marks the cross-origin sheet inaccessible with a diagnostic — no crash, no silent drop', async () => {
    const { cssom } = await collect(handle)
    const cross = cssom.stylesheets[2]
    expect(cross?.accessible).toBe(false)
    expect(cross?.rules).toHaveLength(0)
    expect(cross?.diagnostics[0]?.code).toBe('CROSS_ORIGIN_STYLESHEET_SKIPPED')
    expect(cross?.diagnostics[0]?.href).toContain('/x.css')
    // Other sheets were still walked (per-sheet isolation).
    expect(cssom.stylesheets[0]?.accessible).toBe(true)
  })

  it('declaration text comes verbatim from CSSOM getters (browser-normalized)', async () => {
    const { cssom } = await collect(handle)
    const h1 = cssom.stylesheets[0]?.rules.find((r) => r.selectorText === 'h1')
    expect(h1?.declarationText).toBe('color: rgb(0, 128, 0);')
  })

  it('DOM and CSSOM captures share one snapshotId (016 §8.4)', async () => {
    const result = await collect(handle)
    expect(result.dom.snapshotId).toBe(result.cssom.snapshotId)
    expect(result.snapshotId).toBe(result.cssom.snapshotId)
  })
})
