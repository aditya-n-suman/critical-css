import { describe, expect, it } from 'vitest'
import {
  canonicalJsonStringify,
  computeCacheFingerprint,
  fnv1a64,
  type CacheFingerprintInput,
  type ViewportProfile,
} from '../src/index.js'

const desktop: ViewportProfile = {
  name: 'desktop',
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  userAgent: null,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  forcedColors: 'none',
  foldOffset: null,
}

function input(overrides: Partial<CacheFingerprintInput> = {}): CacheFingerprintInput {
  return {
    htmlContent: '<html><body>hello</body></html>',
    cssAssets: [
      { url: 'https://a.test/a.css', contentHash: 'h1' },
      { url: 'https://b.test/b.css', contentHash: 'h2' },
    ],
    viewportProfile: desktop,
    extractionMode: 'cssom',
    engineVersion: '0.1.0',
    ...overrides,
  }
}

describe('computeCacheFingerprint', () => {
  it('is stable across two identical inputs', () => {
    expect(computeCacheFingerprint(input()).hash).toBe(computeCacheFingerprint(input()).hash)
  })

  it('is order-independent over CSS asset input order', () => {
    const reversed = input({
      cssAssets: [
        { url: 'https://b.test/b.css', contentHash: 'h2' },
        { url: 'https://a.test/a.css', contentHash: 'h1' },
      ],
    })
    expect(computeCacheFingerprint(reversed).hash).toBe(computeCacheFingerprint(input()).hash)
  })

  it.each([
    ['HTML content', input({ htmlContent: '<html><body>bye</body></html>' })],
    ['a CSS asset hash', input({ cssAssets: [{ url: 'https://a.test/a.css', contentHash: 'CHANGED' }, { url: 'https://b.test/b.css', contentHash: 'h2' }] })],
    ['extraction mode', input({ extractionMode: 'hybrid' })],
    ['engine version', input({ engineVersion: '0.2.0' })],
    ['viewport profile', input({ viewportProfile: { ...desktop, width: 375 } })],
  ])('changes when %s changes', (_label, changed) => {
    expect(computeCacheFingerprint(changed).hash).not.toBe(computeCacheFingerprint(input()).hash)
  })
})

describe('fnv1a64', () => {
  it('is deterministic and fixed-width hex', () => {
    expect(fnv1a64('abc')).toBe(fnv1a64('abc'))
    expect(fnv1a64('abc')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a64('abc')).not.toBe(fnv1a64('abd'))
  })
})

describe('canonicalJsonStringify', () => {
  it('is insensitive to object key insertion order', () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJsonStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    )
  })
})
