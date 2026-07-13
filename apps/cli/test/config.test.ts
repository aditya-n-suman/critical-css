/**
 * Config-file validation unit tests for the M4 CI keys (011; 010 §8.1:
 * validated field-by-field before any browser launches; unknown keys are
 * rejected loudly — Principle 6).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfigFile } from '../src/config.js'

describe('loadConfigFile — M4 CI keys', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-config-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const load = async (config: unknown) => {
    const path = join(dir, 'config.json')
    await writeFile(path, JSON.stringify(config), 'utf8')
    return loadConfigFile(path)
  }

  it('accepts every new key with a valid value', async () => {
    const config = await load({
      cacheDir: '.critical-css-cache',
      noCache: false,
      routes: 'routes.json',
      baseUrl: 'https://example.com',
      outDir: 'dist/critical',
      compareBaseline: 'baseline.json',
      writeBaseline: 'baseline.json',
      maxGrowth: 7.5,
    })
    expect(config).toEqual({
      cacheDir: '.critical-css-cache',
      noCache: false,
      routes: 'routes.json',
      baseUrl: 'https://example.com',
      outDir: 'dist/critical',
      compareBaseline: 'baseline.json',
      writeBaseline: 'baseline.json',
      maxGrowth: 7.5,
    })
  })

  it('rejects wrong types field-by-field', async () => {
    await expect(load({ cacheDir: 5 })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ noCache: 'yes' })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ routes: [] })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ baseUrl: 1 })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ outDir: true })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ compareBaseline: 0 })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ writeBaseline: {} })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a negative, non-finite, or non-numeric maxGrowth', async () => {
    await expect(load({ maxGrowth: -1 })).rejects.toBeInstanceOf(ConfigError)
    await expect(load({ maxGrowth: '5' })).rejects.toBeInstanceOf(ConfigError)
    const path = join(dir, 'inf.json')
    await writeFile(path, '{"maxGrowth": 1e999}', 'utf8')
    await expect(loadConfigFile(path)).rejects.toBeInstanceOf(ConfigError)
  })

  it('still rejects unknown keys loudly', async () => {
    await expect(load({ cacheDirectory: '.cache' })).rejects.toBeInstanceOf(ConfigError)
  })
})
