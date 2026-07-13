import { describe, expect, it } from 'vitest'
import type { ViewportProfile } from '@critical-css/shared'

import { computeCacheFingerprint } from '../src/index.js'

const desktop: ViewportProfile = {
  name: 'desktop',
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  userAgent: null,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  forcedColors: 'none',
  foldOffset: null,
}

const baseInput = {
  htmlContent: '<html><body><h1>hello</h1></body></html>',
  cssAssets: [
    { url: 'https://example.com/a.css', contentHash: 'hash-a' },
    { url: 'https://example.com/b.css', contentHash: 'hash-b' },
  ],
  viewportProfile: desktop,
  extractionMode: 'cssom' as const,
  engineVersion: '0.1.0',
}

describe('computeCacheFingerprint (801 §8.4/§8.5/§11)', () => {
  it('emits SHA-256 output format: 64-char lowercase hex (801 §11)', () => {
    const fp = computeCacheFingerprint(baseInput)
    expect(fp.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(fp.htmlHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic (pure function, 801 §11)', () => {
    expect(computeCacheFingerprint(baseInput).hash).toBe(
      computeCacheFingerprint({ ...baseInput }).hash,
    )
  })

  it('asset order does not affect the hash (801 §8.5)', () => {
    const reordered = {
      ...baseInput,
      cssAssets: [...baseInput.cssAssets].reverse(),
    }
    expect(computeCacheFingerprint(reordered).hash).toBe(computeCacheFingerprint(baseInput).hash)
  })

  it('regression (B1): asset field boundaries cannot collide across url/contentHash joins', () => {
    // Confirmed collision under the old ':'-joined `url=hash` composition:
    // two assets [a=b, c=d] vs one asset [a = "b:c=d"] serialized to the
    // same pre-image. Canonical-JSON composition must keep them distinct.
    const two = computeCacheFingerprint({
      ...baseInput,
      cssAssets: [
        { url: 'a', contentHash: 'b' },
        { url: 'c', contentHash: 'd' },
      ],
    })
    const one = computeCacheFingerprint({
      ...baseInput,
      cssAssets: [{ url: 'a', contentHash: 'b:c=d' }],
    })
    expect(two.hash).not.toBe(one.hash)
  })

  it('regression (B1): no input byte can act as a field delimiter (quote/space injection)', () => {
    const a = computeCacheFingerprint({ ...baseInput, htmlContent: 'x', engineVersion: 'y z' })
    const b = computeCacheFingerprint({ ...baseInput, htmlContent: 'x', engineVersion: 'y' })
    expect(a.hash).not.toBe(b.hash)
    const c = computeCacheFingerprint({
      ...baseInput,
      cssAssets: [{ url: 'u"', contentHash: 'h' }],
    })
    const d = computeCacheFingerprint({
      ...baseInput,
      cssAssets: [{ url: 'u', contentHash: '"h' }],
    })
    expect(c.hash).not.toBe(d.hash)
  })

  it('any single input change flips the hash (sensitivity)', () => {
    const base = computeCacheFingerprint(baseInput).hash
    expect(computeCacheFingerprint({ ...baseInput, htmlContent: 'other' }).hash).not.toBe(base)
    expect(computeCacheFingerprint({ ...baseInput, extractionMode: 'computed' as never }).hash).not.toBe(base)
    expect(computeCacheFingerprint({ ...baseInput, engineVersion: '0.2.0' }).hash).not.toBe(base)
    expect(
      computeCacheFingerprint({
        ...baseInput,
        viewportProfile: { ...desktop, width: 375 },
      }).hash,
    ).not.toBe(base)
  })
})
