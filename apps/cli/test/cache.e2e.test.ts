/**
 * M4 CLI cache e2e (REQ-301; 800 §9.1): the same fixture extracted twice with
 * `--cache-dir` — the second run is served from the disk cache. The per-run
 * `mode=… merged rules` stats line is emitted only by a real extraction, so
 * its absence (plus the `cache: 1 reused` summary) is the observable proof
 * that no browser pipeline ran on the hit.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const ROOT = resolve(import.meta.dirname, '../../..')
const MAIN = resolve(import.meta.dirname, '../dist/main.js')
const fixtureUrl = pathToFileURL(resolve(ROOT, 'fixtures', 'static', 'index.html')).href

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> =>
  execFileAsync(process.execPath, [MAIN, 'extract', ...args], { maxBuffer: 16 * 1024 * 1024 })

describe('CLI disk cache e2e', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccss-cache-e2e-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('second run with --cache-dir hits the cache and skips the browser pipeline', async () => {
    const cacheDir = join(dir, 'cache')
    const first = await runCli(['--url', fixtureUrl, '--cache-dir', cacheDir])
    expect(first.stderr).toContain('mode=cssom') // fresh extraction ran
    expect(first.stderr).toContain('cache: 0 reused from cache, 1 freshly extracted')

    const second = await runCli(['--url', fixtureUrl, '--cache-dir', cacheDir])
    expect(second.stderr).toContain('cache: 1 reused from cache, 0 freshly extracted')
    expect(second.stderr).not.toContain('mode=') // no extraction pipeline ran
    expect(second.stdout).toBe(first.stdout) // cached CSS is byte-identical

    // The cached path still matches the committed golden byte-for-byte (G3).
    const golden = await readFile(resolve(ROOT, 'fixtures', 'golden', 'static.css'), 'utf8')
    expect(second.stdout).toBe(golden)
  }, 60_000)

  it('--no-cache forces a fresh extraction even with a warm cache', async () => {
    const cacheDir = join(dir, 'cache')
    const result = await runCli(['--url', fixtureUrl, '--cache-dir', cacheDir, '--no-cache'])
    expect(result.stderr).toContain('mode=cssom')
    expect(result.stderr).toContain('(cache disabled by --no-cache)')
  }, 60_000)
})
