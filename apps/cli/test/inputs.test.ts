/**
 * Fingerprint-input collection unit tests (801 §8.1; 704 §14): link-tag scan,
 * recursive `@import` discovery with cycle/depth guards, and fail-closed
 * behavior on unreadable inputs — all through an injected fetcher, no network.
 */

import { describe, expect, it } from 'vitest'
import {
  baseHrefOf,
  collectFingerprintInputs,
  importUrlsOf,
  InputCollectionError,
  stylesheetLinksOf,
} from '../src/inputs.js'

describe('stylesheetLinksOf', () => {
  it('finds stylesheet links regardless of attribute order and quoting', () => {
    const html = [
      '<link rel="stylesheet" href="/a.css">',
      "<link href='/b.css' rel='stylesheet'>",
      '<link href=/c.css rel=stylesheet>',
      '<link rel="preload stylesheet" href="/d.css">',
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="stylesheet">', // no href
    ].join('\n')
    expect(stylesheetLinksOf(html, 'https://example.com/page/')).toEqual([
      'https://example.com/a.css',
      'https://example.com/b.css',
      'https://example.com/c.css',
      'https://example.com/d.css',
    ])
  })

  it('resolves hrefs against the first <base href>, matching browser resolution (G7 #1)', () => {
    const html = '<base href="assets/"><base href="ignored/"><link rel="stylesheet" href="a.css">'
    expect(baseHrefOf(html, 'https://example.com/page/')).toBe('https://example.com/page/assets/')
    expect(stylesheetLinksOf(html, 'https://example.com/page/')).toEqual([
      'https://example.com/page/assets/a.css',
    ])
  })
})

describe('importUrlsOf', () => {
  it('resolves url(), quoted, and bare @import targets against the sheet URL', () => {
    const css = '@import url("nested/x.css"); @import \'y.css\'; @import url(z.css);'
    expect(importUrlsOf(css, 'https://example.com/css/main.css')).toEqual([
      'https://example.com/css/nested/x.css',
      'https://example.com/css/y.css',
      'https://example.com/css/z.css',
    ])
  })
})

describe('collectFingerprintInputs', () => {
  it('hashes the page plus every linked sheet and recursive import, cycle-guarded', async () => {
    const site: Record<string, string> = {
      'https://example.com/': '<link rel="stylesheet" href="/main.css">hello',
      'https://example.com/main.css': '@import "sub.css"; .a{}',
      'https://example.com/sub.css': '@import "main.css"; .b{}', // cycle back
    }
    const fetched: string[] = []
    const inputs = await collectFingerprintInputs('https://example.com/', async (url) => {
      fetched.push(url)
      const body = site[url]
      if (body === undefined) throw new InputCollectionError(`404 ${url}`)
      return body
    })
    expect(inputs.htmlContent).toContain('hello')
    expect(inputs.cssAssets.map((a) => a.url)).toEqual([
      'https://example.com/main.css',
      'https://example.com/sub.css',
    ])
    // The cycle is visited once — no infinite recursion, no duplicate fetch.
    expect(fetched.filter((u) => u.endsWith('main.css'))).toHaveLength(1)
    expect(inputs.cssAssets.every((a) => /^[0-9a-f]{64}$/.test(a.contentHash))).toBe(true)
  })

  it('base-href pages fingerprint the sheet the browser actually loads — editing it changes the inputs (G7 #1)', async () => {
    // Repro: page uses `<base href="assets/">`; a naive page-URL resolution
    // would hash https://example.com/a.css and never see edits to
    // https://example.com/assets/a.css → stale CSS on a false cache hit.
    const siteWith = (assetCss: string): Record<string, string> => ({
      'https://example.com/': '<base href="assets/"><link rel="stylesheet" href="a.css">',
      'https://example.com/assets/a.css': assetCss,
    })
    const fetcherFor =
      (site: Record<string, string>) =>
      async (url: string): Promise<string> => {
        const body = site[url]
        if (body === undefined) throw new InputCollectionError(`404 ${url}`)
        return body
      }
    const before = await collectFingerprintInputs('https://example.com/', fetcherFor(siteWith('.a{color:red}')))
    expect(before.cssAssets.map((a) => a.url)).toEqual(['https://example.com/assets/a.css'])
    const after = await collectFingerprintInputs('https://example.com/', fetcherFor(siteWith('.a{color:blue}')))
    expect(after.cssAssets[0]?.contentHash).not.toBe(before.cssAssets[0]?.contentHash)
  })

  it('fails closed on an @import chain deeper than the depth cap (G7 #5)', async () => {
    // 11-deep chain: page links c0.css, c0 → c1 → … → c10.
    const site: Record<string, string> = {
      'https://example.com/': '<link rel="stylesheet" href="/c0.css">',
    }
    for (let i = 0; i <= 10; i++) {
      site[`https://example.com/c${i}.css`] = i < 10 ? `@import "c${i + 1}.css"; .c${i}{}` : '.c10{}'
    }
    await expect(
      collectFingerprintInputs('https://example.com/', async (url) => {
        const body = site[url]
        if (body === undefined) throw new InputCollectionError(`404 ${url}`)
        return body
      }),
    ).rejects.toThrow(/@import chain exceeds depth/)
  })

  it('fails closed when any referenced sheet is unreadable', async () => {
    const fetcher = async (url: string): Promise<string> => {
      if (url === 'https://example.com/') return '<link rel="stylesheet" href="/missing.css">'
      throw new InputCollectionError(`404 ${url}`)
    }
    await expect(collectFingerprintInputs('https://example.com/', fetcher)).rejects.toBeInstanceOf(
      InputCollectionError,
    )
  })
})
