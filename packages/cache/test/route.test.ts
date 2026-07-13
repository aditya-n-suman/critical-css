import { describe, expect, it } from 'vitest'

import {
  RouteCache,
  RoutePatternMatcher,
  expandRouteManifest,
  normalizeUrl,
  toRouteManifestEntries,
} from '../src/index.js'

describe('normalizeUrl (803 §8.2)', () => {
  it.each([
    ['/blog/hello-world?utm=x#top', '/blog/hello-world'],
    ['//blog///post', '/blog/post'],
    ['/blog/', '/blog'],
    ['/', '/'],
    ['https://example.com/products?a=1', '/products'],
    ['https://example.com', '/'],
    ['/docs%20intro', '/docs intro'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected)
  })

  it('refuses a percent-encoded separator escaping its segment', () => {
    expect(normalizeUrl('/a%2Fb')).toBe('/a%2Fb')
  })
})

describe('RoutePatternMatcher (803 §8.2–8.3)', () => {
  it('glob pattern /blog/* matches /blog/post-1 and deeper paths', () => {
    const matcher = new RoutePatternMatcher(['/blog/*'])
    expect(matcher.match('/blog/post-1')?.pattern).toBe('/blog/*')
    expect(matcher.match('/blog/2026/announcement')?.pattern).toBe('/blog/*')
    expect(matcher.match('/blog/2026/announcement')?.params['*']).toBe('2026/announcement')
  })

  it('wildcard requires at least one trailing segment', () => {
    const matcher = new RoutePatternMatcher(['/blog/*'])
    expect(matcher.match('/blog')).toBeNull()
  })

  it('literal beats wildcard (specificity ordering, deterministic)', () => {
    const matcher = new RoutePatternMatcher(['/blog/*', '/blog/feed'])
    expect(matcher.match('/blog/feed')?.pattern).toBe('/blog/feed')
    expect(matcher.match('/blog/other')?.pattern).toBe('/blog/*')
  })

  it(':param captures a segment and beats bare wildcard', () => {
    const matcher = new RoutePatternMatcher(['/docs/:section', '/docs/*'])
    const match = matcher.match('/docs/api')
    expect(match?.pattern).toBe('/docs/:section')
    expect(match?.params['section']).toBe('api')
    expect(matcher.match('/docs/api/deep')?.pattern).toBe('/docs/*')
  })

  it('param+wildcard beats bare wildcard for deeper paths (803 §12)', () => {
    const matcher = new RoutePatternMatcher(['/blog/*', '/blog/:year/*'])
    expect(matcher.match('/blog/2026/x')?.pattern).toBe('/blog/:year/*')
    expect(matcher.match('/blog/one-segment')?.pattern).toBe('/blog/*')
  })

  it('root pattern matches exactly the site root', () => {
    const matcher = new RoutePatternMatcher(['/', '/products'])
    expect(matcher.match('/')?.pattern).toBe('/')
    expect(matcher.match('/products')?.pattern).toBe('/products')
    expect(matcher.match('/unknown')).toBeNull()
  })

  it('rejects duplicate patterns at construction (manifest error)', () => {
    expect(() => new RoutePatternMatcher(['/blog/*', '/blog/*'])).toThrow(/duplicate/)
  })

  it('query/tracking params collapse to the same match', () => {
    const matcher = new RoutePatternMatcher(['/blog/*'])
    expect(matcher.match('/blog/post?utm_source=tw')?.pattern).toBe('/blog/*')
  })

  it('regression (B3): positional specificity — earliest literal wins over summed score', () => {
    // At position 0, '/a/:b' has a literal where '/:a/b' has a param: the
    // left-to-right positional comparison must pick '/a/:b', regardless of
    // declaration order (both have equal summed scores).
    expect(new RoutePatternMatcher(['/:a/b', '/a/:b']).match('/a/b')?.pattern).toBe('/a/:b')
    expect(new RoutePatternMatcher(['/a/:b', '/:a/b']).match('/a/b')?.pattern).toBe('/a/:b')
  })

  it('regression (B3): literal at first position beats params even against a trailing wildcard', () => {
    // '/a/*' has a literal at position 0 where '/:x/:y' has a param — the
    // positional rule mandates '/a/*' despite its lower summed score.
    expect(new RoutePatternMatcher(['/:x/:y', '/a/*']).match('/a/b')?.pattern).toBe('/a/*')
    expect(new RoutePatternMatcher(['/a/*', '/:x/:y']).match('/a/b')?.pattern).toBe('/a/*')
  })

  it('regression (B3): structurally identical ambiguous patterns are rejected at manifest load (803 §8.3)', () => {
    expect(() => new RoutePatternMatcher(['/docs/:a', '/docs/:b'])).toThrow(/ambiguous/)
    expect(() => new RoutePatternMatcher(['/docs/:a/x/*', '/docs/:b/x/*'])).toThrow(/ambiguous/)
  })

  it('regression (S4): percent-encoding normalization is injective for %2F vs %252F', () => {
    // '/a%2Fb' (encoded slash) and '/a%252Fb' (encoded percent + literal 2F)
    // are different URLs and must not normalize identically.
    expect(normalizeUrl('/a%2Fb')).not.toBe(normalizeUrl('/a%252Fb'))
    expect(normalizeUrl('/a%2Fb')).toBe('/a%2Fb')
    expect(normalizeUrl('/a%252Fb')).toBe('/a%252Fb')
  })

  it('regression (B2): %00 never decodes to a literal NUL', () => {
    expect(normalizeUrl('/x/a%00b')).toBe('/x/a%00b')
    expect(normalizeUrl('/x/a%00b')).not.toContain('\u0000')
  })
})

describe('manifest expansion + composition (803 §8.1, BRIEF §2.9)', () => {
  it('expands the compact authored form into descriptors', () => {
    const manifest = expandRouteManifest({
      '/': 'home.css',
      '/products': 'products.css',
      '/blog/*': 'blog.css',
    })
    expect(manifest.routes).toHaveLength(3)
    const blog = manifest.routes.find((r) => r.pattern === '/blog/*')
    expect(blog).toMatchObject({
      id: 'blog',
      outputName: 'blog.css',
      shareGroup: true,
      paramsInFingerprint: [],
    })
  })

  it('supports rich per-route init (shareGroup, paramsInFingerprint)', () => {
    const manifest = expandRouteManifest({
      '/products/:category/*': {
        outputName: 'products.css',
        paramsInFingerprint: ['category'],
      },
      '/one-off/*': { outputName: 'one-off.css', shareGroup: false },
    })
    expect(manifest.routes[0]?.paramsInFingerprint).toEqual(['category'])
    expect(manifest.routes[1]?.shareGroup).toBe(false)
  })

  it('composes back into shared RouteManifestEntry DTOs', () => {
    const manifest = expandRouteManifest({ '/blog/*': 'blog.css', '/': 'home.css' })
    expect(toRouteManifestEntries(manifest)).toEqual([
      { routePattern: '/blog/*', outputPath: 'blog.css' },
      { routePattern: '/', outputPath: 'home.css' },
    ])
  })
})

describe('RouteCache key resolution (803 §8.4)', () => {
  const routeCache = new RouteCache(
    expandRouteManifest({
      '/': 'home.css',
      '/blog/*': 'blog.css',
      '/products/:category/*': {
        outputName: 'products.css',
        paramsInFingerprint: ['category'],
      },
      '/isolated/*': { outputName: 'isolated.css', shareGroup: false },
    }),
  )
  const TEMPLATE_FP = 'f'.repeat(64)
  const VP = 'vp-desktop'

  it('collapse invariant: many URLs under /blog/* share one routeKey', () => {
    const k1 = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, VP)
    const k2 = routeCache.resolveRouteKey('/blog/why-css', TEMPLATE_FP, VP)
    const k3 = routeCache.resolveRouteKey('/blog/2026/x?utm=y', TEMPLATE_FP, VP)
    expect(k1.key).toBe(k2.key)
    expect(k2.key).toBe(k3.key)
    expect(k1.descriptor?.id).toBe('blog')
  })

  it('invalidation invariant: template fingerprint change strands the old key', () => {
    const before = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, VP)
    const after = routeCache.resolveRouteKey('/blog/hello', 'e'.repeat(64), VP)
    expect(after.key).not.toBe(before.key)
  })

  it('viewport composition: one route fans out to one key per viewport', () => {
    const desktop = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, 'vp-desktop')
    const mobile = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, 'vp-mobile')
    expect(desktop.key).not.toBe(mobile.key)
  })

  it('paramsInFingerprint splits the shared entry along exactly that axis', () => {
    const shoes1 = routeCache.resolveRouteKey('/products/shoes/nike-1', TEMPLATE_FP, VP)
    const shoes2 = routeCache.resolveRouteKey('/products/shoes/adidas-2', TEMPLATE_FP, VP)
    const hats = routeCache.resolveRouteKey('/products/hats/cap-9', TEMPLATE_FP, VP)
    expect(shoes1.key).toBe(shoes2.key) // same category collapses
    expect(shoes1.key).not.toBe(hats.key) // different category splits
    expect(shoes1.params['category']).toBe('shoes')
  })

  it('shareGroup=false forces per-URL keys (no collapse)', () => {
    const a = routeCache.resolveRouteKey('/isolated/a', TEMPLATE_FP, VP)
    const b = routeCache.resolveRouteKey('/isolated/b', TEMPLATE_FP, VP)
    expect(a.key).not.toBe(b.key)
    expect(a.descriptor?.id).toBe('isolated')
  })

  it('unmatched URLs fall back to per-URL keys — cached, not dropped', () => {
    const a = routeCache.resolveRouteKey('/unknown/a', TEMPLATE_FP, VP)
    const b = routeCache.resolveRouteKey('/unknown/b', TEMPLATE_FP, VP)
    expect(a.descriptor).toBeNull()
    expect(a.key).not.toBe(b.key)
    // deterministic: same URL always resolves to the same fallback key
    expect(routeCache.resolveRouteKey('/unknown/a', TEMPLATE_FP, VP).key).toBe(a.key)
  })

  it('key resolution is deterministic (Principle 5)', () => {
    const k1 = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, VP)
    const k2 = routeCache.resolveRouteKey('/blog/hello', TEMPLATE_FP, VP)
    expect(k1.key).toBe(k2.key)
    expect(k1.key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('regression (B2): NUL/param injection cannot collide routeKeys (803 §12)', () => {
  it('the confirmed repro pair resolves to distinct routeKeys', () => {
    const cache = new RouteCache(
      expandRouteManifest({
        '/x/:p/:q': { outputName: 'x.css', paramsInFingerprint: ['p', 'q'] },
      }),
    )
    const fp = 'f'.repeat(64)
    // Before the fix, %00 decoded to a literal NUL — the digest delimiter —
    // letting param boundaries shift: both URLs produced one routeKey.
    const a = cache.resolveRouteKey('/x/a/w%00q=z', fp, 'vp-desktop')
    const b = cache.resolveRouteKey('/x/a%00q=w/z', fp, 'vp-desktop')
    expect(a.descriptor).not.toBeNull()
    expect(b.descriptor).not.toBeNull()
    expect(a.key).not.toBe(b.key)
  })

  it('length-prefixed digest: shifted param boundaries never collide', () => {
    const cache = new RouteCache(
      expandRouteManifest({
        '/y/:p/:q': { outputName: 'y.css', paramsInFingerprint: ['p', 'q'] },
      }),
    )
    const fp = 'f'.repeat(64)
    const a = cache.resolveRouteKey('/y/ab/c', fp, 'vp')
    const b = cache.resolveRouteKey('/y/a/bc', fp, 'vp')
    expect(a.key).not.toBe(b.key)
  })
})
