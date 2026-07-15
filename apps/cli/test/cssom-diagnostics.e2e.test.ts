/**
 * B1 regression: the CSSOM walker's real diagnostic codes
 * (CROSS_ORIGIN_STYLESHEET_SKIPPED, CSSOM_WALK_ERROR, UNKNOWN_GROUPING_RULE,
 * IMPORT_SHEET_UNAVAILABLE, CIRCULAR_IMPORT — packages/collector/src/
 * cssom-walker/cssom-walker.ts) must reach `extract()`'s returned
 * `ExtractionOutcome.diagnostics`, not just live unread on
 * `collection.cssom.stylesheets[].diagnostics`.
 *
 * Uses two local HTTP servers on different ports (same technique as
 * packages/collector/test/cssom-walker.integration.test.ts) so one
 * stylesheet is genuinely cross-origin and CSSOM-inaccessible.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extract } from '../src/index.js'

function startServer(handler: (url: string) => { body: string; type: string } | null): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const payload = handler(req.url ?? '/')
      if (payload === null) {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('content-type', payload.type)
      // Deliberately no Access-Control-Allow-Origin: the linked sheet stays
      // cross-origin-inaccessible to the CSSOM walker.
      res.end(payload.body)
    })
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

const port = (s: Server): number => (s.address() as AddressInfo).port

describe('extract() surfaces CSSOM-walk diagnostics (B1)', () => {
  let pageServer: Server
  let crossOriginServer: Server
  let pageOrigin: string

  beforeAll(async () => {
    crossOriginServer = await startServer((url) =>
      url === '/x.css' ? { body: '.cross { color: red; }', type: 'text/css' } : null,
    )
    pageServer = await startServer((url) => {
      if (url === '/' || url === '') {
        return {
          type: 'text/html',
          body: `<!doctype html><html><head>
            <style>.local { color: blue; }</style>
            <link rel="stylesheet" href="http://127.0.0.1:${port(crossOriginServer)}/x.css">
          </head><body><h1 class="local">hello</h1></body></html>`,
        }
      }
      return null
    })
    pageOrigin = `http://127.0.0.1:${port(pageServer)}`
  })

  afterAll(() => {
    pageServer.close()
    crossOriginServer.close()
  })

  it('includes a CROSS_ORIGIN_STYLESHEET_SKIPPED diagnostic in ExtractOutcome.diagnostics', async () => {
    const outcome = await extract({ url: `${pageOrigin}/`, viewport: 'desktop' })
    const found = outcome.diagnostics.find((d) => d.code === 'CROSS_ORIGIN_STYLESHEET_SKIPPED')
    expect(found).toBeDefined()
    expect(found?.severity).toBe('warning')
    expect(found?.source?.url).toContain('/x.css')
    // Diagnostics are metadata — the CSS artifact itself must be unaffected
    // by folding these in (still only the locally-accessible sheet's rule).
    expect(outcome.css).toContain('.local')
    expect(outcome.css).not.toContain('.cross')
  })
})
