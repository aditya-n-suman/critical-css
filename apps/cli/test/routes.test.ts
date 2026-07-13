/**
 * Route-manifest loading/expansion unit tests (BRIEF.md §2.9, 803 §8.1,
 * BI-11.3): compact + rich authored forms, wildcard sample resolution, and
 * load-time validation (before any browser launches).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError } from '../src/config.js'
import { concreteUrlFor, loadRoutes, validateAuthoredManifest } from '../src/routes.js'

describe('validateAuthoredManifest', () => {
  it('accepts the BRIEF §2.9 compact form', () => {
    const authored = validateAuthoredManifest({ '/': 'home.css', '/blog/*': 'blog.css' }, 'routes.json')
    expect(authored).toEqual({ '/': 'home.css', '/blog/*': 'blog.css' })
  })

  it('accepts the rich per-route object form', () => {
    const rich = { outputName: 'blog.css', sampleUrls: ['/blog/first-post'], shareGroup: true }
    expect(validateAuthoredManifest({ '/blog/*': rich }, 'routes.json')).toEqual({ '/blog/*': rich })
  })

  it('rejects non-object roots, patterns without a leading slash, empty outputs, and malformed values', () => {
    expect(() => validateAuthoredManifest([1], 'r.json')).toThrow(ConfigError)
    expect(() => validateAuthoredManifest({ 'blog/*': 'b.css' }, 'r.json')).toThrow(ConfigError)
    expect(() => validateAuthoredManifest({ '/': '' }, 'r.json')).toThrow(ConfigError)
    expect(() => validateAuthoredManifest({ '/': 42 }, 'r.json')).toThrow(ConfigError)
    expect(() => validateAuthoredManifest({ '/': { sampleUrls: [] } }, 'r.json')).toThrow(ConfigError)
    expect(() => validateAuthoredManifest({}, 'r.json')).toThrow(ConfigError)
  })
})

describe('concreteUrlFor', () => {
  const descriptor = (pattern: string, sampleUrls: string[] = []) => ({
    id: 'x',
    pattern,
    outputName: 'x.css',
    shareGroup: true,
    paramsInFingerprint: [],
    sampleUrls,
  })

  it('resolves a literal pattern directly against --base-url', () => {
    expect(concreteUrlFor(descriptor('/pricing'), 'https://example.com')).toBe('https://example.com/pricing')
  })

  it('resolves a wildcard pattern through its first sampleUrl (803 §8.1)', () => {
    expect(concreteUrlFor(descriptor('/blog/*', ['/blog/first-post']), 'https://example.com')).toBe(
      'https://example.com/blog/first-post',
    )
  })

  it('resolves a :param pattern through its first sampleUrl', () => {
    expect(concreteUrlFor(descriptor('/docs/:section', ['/docs/setup']), 'https://example.com')).toBe(
      'https://example.com/docs/setup',
    )
  })

  it('rejects a wildcard pattern without sampleUrls as a manifest authoring error', () => {
    expect(() => concreteUrlFor(descriptor('/blog/*'), 'https://example.com')).toThrow(ConfigError)
  })
})

describe('loadRoutes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-routes-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('expands the manifest file into work units with concrete URLs and output paths', async () => {
    const path = join(dir, 'routes.json')
    await writeFile(
      path,
      JSON.stringify({
        '/': 'home.css',
        '/blog/*': { outputName: 'blog.css', sampleUrls: ['/blog/first-post'] },
      }),
      'utf8',
    )
    const loaded = await loadRoutes(path, 'https://example.com')
    expect(loaded.units).toHaveLength(2)
    expect(loaded.units[0]).toMatchObject({
      pattern: '/',
      outputPath: 'home.css',
      url: 'https://example.com/',
    })
    expect(loaded.units[1]).toMatchObject({
      pattern: '/blog/*',
      outputPath: 'blog.css',
      url: 'https://example.com/blog/first-post',
    })
    // The RouteCache groups matching URLs under the shared route key (803).
    const resolution = loaded.routeCache.resolveRouteKey('https://example.com/blog/another', 'fp', 'desktop')
    expect(resolution.descriptor?.pattern).toBe('/blog/*')
  })

  it('rejects an invalid --base-url, a missing file, and invalid JSON before any extraction', async () => {
    const path = join(dir, 'routes.json')
    await writeFile(path, JSON.stringify({ '/': 'home.css' }), 'utf8')
    await expect(loadRoutes(path, 'not-a-url')).rejects.toBeInstanceOf(ConfigError)
    await expect(loadRoutes(join(dir, 'missing.json'), 'https://example.com')).rejects.toBeInstanceOf(ConfigError)
    await writeFile(path, '{oops', 'utf8')
    await expect(loadRoutes(path, 'https://example.com')).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a relative outputName that escapes --out-dir as a usage error (G7 #6)', async () => {
    const path = join(dir, 'routes.json')
    await writeFile(path, JSON.stringify({ '/': '../../etc/x.css' }), 'utf8')
    const outDir = join(dir, 'out')
    await expect(loadRoutes(path, 'https://example.com', outDir)).rejects.toThrow(
      /escapes --out-dir/,
    )
    await expect(loadRoutes(path, 'https://example.com', outDir)).rejects.toBeInstanceOf(ConfigError)
    // Nested-but-contained relative paths remain fine.
    await writeFile(path, JSON.stringify({ '/': 'nested/../home.css' }), 'utf8')
    await expect(loadRoutes(path, 'https://example.com', outDir)).resolves.toBeDefined()
  })

  it('rejects an absolute outputName as a usage error (G7 #6)', async () => {
    const path = join(dir, 'routes.json')
    await writeFile(
      path,
      JSON.stringify({ '/': { outputName: '/abs/x.css', sampleUrls: [] } }),
      'utf8',
    )
    await expect(loadRoutes(path, 'https://example.com', join(dir, 'out'))).rejects.toThrow(
      /absolute output path/,
    )
    await expect(
      loadRoutes(path, 'https://example.com', join(dir, 'out')),
    ).rejects.toBeInstanceOf(ConfigError)
  })
})
