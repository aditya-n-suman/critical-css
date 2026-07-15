#!/usr/bin/env node
/**
 * `apps/visualizer`'s CLI entry point (bin: `critical-css-visualizer`, per
 * this package's `package.json`). Only subcommand implemented this session:
 * `serve` (1005 §7.3 "Dev mode"). Export mode (§7.3/§8.6, `apps/visualizer
 * export --out=...`) is NOT implemented — see README "Scope cuts".
 *
 * Usage:
 *   critical-css-visualizer serve --report-dir <dir> [--css-dir <dir>] [--port <n>] [--host <h>]
 */

import { serve } from './server.js'

const USAGE =
  'Usage: critical-css-visualizer serve --report-dir <dir> [--css-dir <dir>] [--port <n>] [--host <h>]'

class UsageError extends Error {}

interface ParsedArgs {
  reportDir: string
  cssDir?: string
  port?: number
  host?: string
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let reportDir: string | undefined
  let cssDir: string | undefined
  let port: number | undefined
  let host: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const v = argv[i + 1]
      if (v === undefined) throw new UsageError(`${arg} requires a value\n${USAGE}`)
      i += 1
      return v
    }
    switch (arg) {
      case '--report-dir':
        reportDir = next()
        break
      case '--css-dir':
        cssDir = next()
        break
      case '--port':
        port = Number(next())
        break
      case '--host':
        host = next()
        break
      default:
        throw new UsageError(`Unknown flag: ${arg}\n${USAGE}`)
    }
  }
  if (reportDir === undefined) throw new UsageError(`--report-dir is required\n${USAGE}`)
  return {
    reportDir,
    ...(cssDir !== undefined ? { cssDir } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(host !== undefined ? { host } : {}),
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  if (command !== 'serve') {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  let options: ReturnType<typeof parseArgs>
  try {
    options = parseArgs(rest)
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`)
      return 2
    }
    throw err
  }
  const { url } = await serve(options)
  process.stdout.write(`critical-css visualizer serving at ${url}\n`)
  process.stdout.write(`(bound to ${options.host ?? '127.0.0.1'} — 1005 §11's localhost-by-default posture)\n`)
  // Keep the process alive; Ctrl-C to stop.
  return 0
}

main()
  .then((code) => {
    if (code !== 0) process.exitCode = code
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exitCode = 1
  })
