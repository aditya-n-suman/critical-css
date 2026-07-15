#!/usr/bin/env node
/**
 * Generates sample data to browse with `apps/visualizer serve` (README "How
 * to run"): starts a throwaway static HTTP server over `fixtures/ci-project`
 * (the same fixture + serving pattern `apps/cli`'s
 * `test/ci-pipeline.e2e.test.ts` uses) and shells out to `apps/cli`'s built
 * CLI binary as a **subprocess** (never an in-process import — 1005 §8.2's
 * "trigger re-run" boundary applies equally to sample-data generation: this
 * script is itself a convenience wrapper around the real CLI, not a second
 * extraction code path) to produce real `ReportBundle` JSON under
 * `--report-dir`.
 *
 * Requires `apps/cli` to be built first (`pnpm --filter @critical-css/cli build`,
 * or just `pnpm build` from the repo root) and a Chromium binary available to
 * Playwright (`packages/browser`'s dependency) — the same requirement any
 * real extraction has.
 *
 * Usage: node scripts/generate-sample-data.mjs [--out <dir>] [--report-dir <dir>]
 * Defaults to `.sample-data/out` and `.sample-data/reports` under this package.
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..')
const CI_PROJECT = join(REPO_ROOT, 'fixtures', 'ci-project')
const CLI_BIN = join(REPO_ROOT, 'apps', 'cli', 'dist', 'main.js')

const ROUTE_FILES = {
  '/': 'index.html',
  '/about': 'about/index.html',
  '/products': 'products/index.html',
  '/contact': 'contact/index.html',
}

function parseArgs(argv) {
  const opts = {
    out: join(PACKAGE_ROOT, '.sample-data', 'out'),
    reportDir: join(PACKAGE_ROOT, '.sample-data', 'reports'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = resolve(argv[(i += 1)])
    else if (argv[i] === '--report-dir') opts.reportDir = resolve(argv[(i += 1)])
  }
  return opts
}

function startServer() {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const file = ROUTE_FILES[pathname === '' ? '/' : pathname]
      if (file === undefined) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      createReadStream(join(CI_PROJECT, file)).pipe(res)
    })
    server.on('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveServer({ origin: `http://127.0.0.1:${port}`, server })
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { origin, server } = await startServer()
  console.log(`[generate-sample-data] serving fixtures/ci-project at ${origin}`)

  const args = [
    CLI_BIN,
    'extract',
    '--routes',
    join(CI_PROJECT, 'routes.json'),
    '--base-url',
    origin,
    '--viewports',
    'desktop,mobile',
    '--out-dir',
    opts.out,
    '--report-dir',
    opts.reportDir,
  ]

  const code = await new Promise((resolveExit) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('exit', (exitCode) => resolveExit(exitCode ?? 1))
  })
  server.close()

  if (code !== 0) {
    console.error(`[generate-sample-data] apps/cli exited with code ${code}`)
    process.exitCode = code
    return
  }
  console.log(`[generate-sample-data] wrote critical CSS to ${opts.out}`)
  console.log(`[generate-sample-data] wrote report bundles to ${opts.reportDir}`)
  console.log(`\nNow run: critical-css-visualizer serve --report-dir ${opts.reportDir} --css-dir ${opts.out}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
