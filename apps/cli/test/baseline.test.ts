/**
 * CI baseline gate unit tests (BRIEF.md §2.11; BI-11): growth strictly beyond
 * `--max-growth` fails; at-threshold passes; new/removed routes are warnings
 * (surfaced, never pass/fail).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareBaseline, loadBaseline, writeBaseline } from '../src/baseline.js'
import { ConfigError } from '../src/config.js'

describe('compareBaseline (pure gate logic)', () => {
  it('passes when growth is under the threshold', () => {
    const result = compareBaseline({ '/': 1000 }, { '/': 1040 }, 5)
    expect(result.failures).toEqual([])
  })

  it('passes when the size is exactly at the threshold (strict >)', () => {
    const result = compareBaseline({ '/': 1000 }, { '/': 1050 }, 5)
    expect(result.failures).toEqual([])
  })

  it('fails when growth is strictly over the threshold', () => {
    const result = compareBaseline({ '/': 1000 }, { '/': 1051 }, 5)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ route: '/', baselineBytes: 1000, producedBytes: 1051 })
    expect(result.failures[0]?.growthPercent).toBeCloseTo(5.1)
  })

  it('reports Infinity growth for a zero-byte baseline entry that grew', () => {
    const result = compareBaseline({ '/': 0 }, { '/': 1 }, 5)
    expect(result.failures[0]?.growthPercent).toBe(Number.POSITIVE_INFINITY)
  })

  it('surfaces a produced route with no baseline entry as newRoutes, not a failure', () => {
    const result = compareBaseline({ '/': 1000 }, { '/': 1000, '/blog/*': 2000 }, 5)
    expect(result.failures).toEqual([])
    expect(result.newRoutes).toEqual(['/blog/*'])
  })

  it('surfaces a baseline route not produced this run as removedRoutes, not a failure', () => {
    const result = compareBaseline({ '/': 1000, '/gone': 500 }, { '/': 1000 }, 5)
    expect(result.failures).toEqual([])
    expect(result.removedRoutes).toEqual(['/gone'])
  })

  it('shrinking always passes', () => {
    const result = compareBaseline({ '/': 1000 }, { '/': 10 }, 0)
    expect(result.failures).toEqual([])
  })
})

describe('baseline file I/O', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-baseline-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips through writeBaseline/loadBaseline with sorted keys', async () => {
    const path = join(dir, 'baseline.json')
    await writeBaseline(path, { '/z': 3, '/a': 1 })
    expect(await loadBaseline(path)).toEqual({ '/a': 1, '/z': 3 })
    // Keys are sorted on disk so diffs stay reviewable.
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ '/a': 1, '/z': 3 })
    expect((await readFile(path, 'utf8')).indexOf('"/a"')).toBeLessThan((await readFile(path, 'utf8')).indexOf('"/z"'))
  })

  it('rejects a missing file, invalid JSON, non-object roots, and non-numeric sizes', async () => {
    await expect(loadBaseline(join(dir, 'missing.json'))).rejects.toBeInstanceOf(ConfigError)
    const bad = join(dir, 'bad.json')
    await writeFile(bad, 'not json', 'utf8')
    await expect(loadBaseline(bad)).rejects.toBeInstanceOf(ConfigError)
    await writeFile(bad, '[1,2]', 'utf8')
    await expect(loadBaseline(bad)).rejects.toBeInstanceOf(ConfigError)
    await writeFile(bad, '{"/": "large"}', 'utf8')
    await expect(loadBaseline(bad)).rejects.toBeInstanceOf(ConfigError)
    await writeFile(bad, '{"/": -1}', 'utf8')
    await expect(loadBaseline(bad)).rejects.toBeInstanceOf(ConfigError)
  })
})
