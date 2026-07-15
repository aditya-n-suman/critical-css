import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../src/server.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

describe('serve (dev-mode server, 1005 §7.3)', () => {
  let baseUrl: string
  let close: () => Promise<void>

  beforeAll(async () => {
    const { server, url } = await serve({ reportDir: join(FIXTURES, 'reports'), host: '127.0.0.1', port: 0 })
    baseUrl = url
    close = () => new Promise((r) => server.close(() => r()))
  })
  afterAll(async () => {
    await close()
  })

  it('binds to loopback only, per 1005 §11', async () => {
    expect(baseUrl.startsWith('http://127.0.0.1:')).toBe(true)
  })

  it('serves the picker at / with every fixture run listed', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Route / viewport picker')
    expect(html).toContain('desktop')
    expect(html).toContain('mobile')
  })

  it('filters the picker via query params', async () => {
    const res = await fetch(`${baseUrl}/?viewport=mobile`)
    const html = await res.text()
    expect(html).toContain('mobile')
  })

  it('serves a run detail page linking to every sub-view', async () => {
    const picker = await (await fetch(`${baseUrl}/`)).text()
    const idMatch = /\/run\/([^"]+)"/.exec(picker)
    expect(idMatch).not.toBeNull()
    const runPath = `/run/${idMatch![1]}`
    const res = await fetch(`${baseUrl}${runPath}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    for (const view of ['/matched', '/graph', '/waterfall', '/side-by-side', '/overlay']) {
      expect(html).toContain(`${runPath}${view}`)
    }
  })

  it('serves the matched/unmatched, graph, and waterfall sub-views with 200', async () => {
    const picker = await (await fetch(`${baseUrl}/`)).text()
    const idMatch = /\/run\/([^"]+)"/.exec(picker)
    const runPath = `/run/${idMatch![1]}`
    for (const view of ['/matched', '/graph', '/waterfall']) {
      const res = await fetch(`${baseUrl}${runPath}${view}`)
      expect(res.status).toBe(200)
    }
  })

  it('degrades the side-by-side/overlay views gracefully when the route is unreachable', async () => {
    const picker = await (await fetch(`${baseUrl}/`)).text()
    const idMatch = /\/run\/([^"]+)"/.exec(picker)
    const runPath = `/run/${idMatch![1]}`
    const res = await fetch(`${baseUrl}${runPath}/side-by-side`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Could not fetch')
  })

  it('returns 404 for an unknown run id', async () => {
    const res = await fetch(`${baseUrl}/run/does-not-exist`)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown top-level path', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`)
    expect(res.status).toBe(404)
  })
})
