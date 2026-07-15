#!/usr/bin/env node
/**
 * critical-css-engine CLI (M1 MVP + M4 CI pipeline, BI-11):
 *   extract --url <url> | --routes <manifest.json> --base-url <origin>
 *
 * Exit codes: 0 success, 1 extraction failure (attributed diagnostic on
 * stderr), 2 usage, 3 CI baseline gate failed (--compare-baseline: CSS grew
 * beyond --max-growth, or missing dependencies detected). Extraction errors
 * take precedence over gate failures.
 */

import type { SandboxPolicy } from '@critical-css/shared'
import { ConfigError, isSandboxPolicy, isViewport, loadConfigFile } from './config.js'
import type { CliConfig, Mode, ViewportName } from './config.js'
import { run, type RunOptions } from './run.js'
import { parseShardSpec, type ShardSpec } from './shard.js'

const USAGE =
  'Usage: critical-css-engine extract (--url <url> | --routes <manifest.json> --base-url <origin>) [--viewport desktop|tablet|mobile] [--viewports d,t,m] [--mode cssom|coverage|hybrid] [--output <path>] [--report <path>] [--report-dir <dir>] [--out-dir <dir>] [--minify] [--format raw-css|inline-style|json-envelope] [--sandbox-policy full|ci-container|unsafe-no-sandbox] [--cache-dir <dir>] [--no-cache] [--compare-baseline <path>] [--write-baseline <path>] [--max-growth <percent>] [--shard <i>/<n>] [--config <path>]\n' +
  'Exit codes: 0 success, 1 extraction error, 2 usage, 3 baseline gate failed.'

/**
 * Explicit opt-in only (101 §8.8) — CLI flag takes precedence, then the
 * config file, then the `CRITICAL_CSS_SANDBOX_POLICY` env var (for CI setups
 * that can't easily add args or a config file), falling back to Chromium's
 * default sandbox (`'full'`).
 */
function envSandboxPolicy(): SandboxPolicy | undefined {
  const fromEnv = process.env.CRITICAL_CSS_SANDBOX_POLICY
  if (fromEnv === undefined) return undefined
  if (!isSandboxPolicy(fromEnv)) {
    throw new UsageError(
      `CRITICAL_CSS_SANDBOX_POLICY must be full|ci-container|unsafe-no-sandbox, got: ${fromEnv}`,
    )
  }
  return fromEnv
}

/**
 * Two-pass parse: a first pass finds only `--config` (it can appear anywhere
 * in argv) so its values become the base that the second, full pass of CLI
 * flags is layered on top of — CLI flag > config file > env > built-in
 * default, field by field.
 */
async function findConfigFlag(argv: readonly string[]): Promise<CliConfig> {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      const value = argv[i + 1]
      if (value === undefined) throw new UsageError(`--config requires a value\n${USAGE}`)
      try {
        return await loadConfigFile(value)
      } catch (err) {
        if (err instanceof ConfigError) throw new UsageError(err.message)
        throw err
      }
    }
  }
  return {}
}

export async function parseArgs(argv: readonly string[]): Promise<RunOptions> {
  const [command, ...rest] = argv
  if (command !== 'extract') {
    throw new UsageError(`Unknown command: ${command ?? '(none)'}\n${USAGE}`)
  }
  const fileConfig = await findConfigFlag(rest)
  let url: string | null = fileConfig.url ?? null
  let viewports: ViewportName[] = [...(fileConfig.viewports ?? ['desktop'])]
  let mode: Mode = fileConfig.mode ?? 'cssom'
  let output: string | null = fileConfig.output ?? null
  let reportOutput: string | null = fileConfig.report ?? null
  let reportDir: string | null = fileConfig.reportDir ?? null
  let minify = fileConfig.minify ?? false
  let format: RunOptions['format'] = fileConfig.format ?? 'raw-css'
  let sandboxPolicy: SandboxPolicy = fileConfig.sandboxPolicy ?? envSandboxPolicy() ?? 'full'
  let cacheDir: string | null = fileConfig.cacheDir ?? null
  let noCache = fileConfig.noCache ?? false
  let routes: string | null = fileConfig.routes ?? null
  let baseUrl: string | null = fileConfig.baseUrl ?? null
  let outDir: string = fileConfig.outDir ?? '.'
  let compareBaseline: string | null = fileConfig.compareBaseline ?? null
  let writeBaseline: string | null = fileConfig.writeBaseline ?? null
  let maxGrowth: number = fileConfig.maxGrowth ?? 5
  let shard: ShardSpec | null = fileConfig.shard !== undefined ? parseShardSpec(fileConfig.shard) : null
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    const value = rest[i + 1]
    switch (flag) {
      case '--minify':
        minify = true
        break
      case '--no-cache':
        noCache = true
        break
      case '--format':
        if (value !== 'raw-css' && value !== 'inline-style' && value !== 'json-envelope') {
          throw new UsageError(`--format must be raw-css|inline-style|json-envelope\n${USAGE}`)
        }
        format = value
        i += 1
        break
      case '--url':
        if (value === undefined) throw new UsageError(`--url requires a value\n${USAGE}`)
        url = value
        i += 1
        break
      case '--viewport':
        if (!isViewport(value)) throw new UsageError(`--viewport must be desktop|tablet|mobile\n${USAGE}`)
        viewports = [value]
        i += 1
        break
      case '--viewports': {
        if (value === undefined) throw new UsageError(`--viewports requires a comma list\n${USAGE}`)
        const parsed = value.split(',').map((v) => v.trim())
        if (parsed.length === 0 || !parsed.every(isViewport)) {
          throw new UsageError(`--viewports entries must be desktop|tablet|mobile\n${USAGE}`)
        }
        viewports = parsed as ViewportName[]
        i += 1
        break
      }
      case '--mode':
        if (value !== 'cssom' && value !== 'coverage' && value !== 'hybrid') {
          throw new UsageError(`--mode must be cssom|coverage|hybrid\n${USAGE}`)
        }
        mode = value
        i += 1
        break
      case '--output':
        if (value === undefined) throw new UsageError(`--output requires a value\n${USAGE}`)
        output = value
        i += 1
        break
      case '--report':
        if (value === undefined) throw new UsageError(`--report requires a value\n${USAGE}`)
        reportOutput = value
        i += 1
        break
      case '--report-dir':
        if (value === undefined) throw new UsageError(`--report-dir requires a value\n${USAGE}`)
        reportDir = value
        i += 1
        break
      case '--sandbox-policy':
        if (!isSandboxPolicy(value)) {
          throw new UsageError(`--sandbox-policy must be full|ci-container|unsafe-no-sandbox\n${USAGE}`)
        }
        sandboxPolicy = value
        i += 1
        break
      case '--cache-dir':
        if (value === undefined) throw new UsageError(`--cache-dir requires a value\n${USAGE}`)
        cacheDir = value
        i += 1
        break
      case '--routes':
        if (value === undefined) throw new UsageError(`--routes requires a value\n${USAGE}`)
        routes = value
        i += 1
        break
      case '--base-url':
        if (value === undefined) throw new UsageError(`--base-url requires a value\n${USAGE}`)
        baseUrl = value
        i += 1
        break
      case '--out-dir':
        if (value === undefined) throw new UsageError(`--out-dir requires a value\n${USAGE}`)
        outDir = value
        i += 1
        break
      case '--compare-baseline':
        if (value === undefined) throw new UsageError(`--compare-baseline requires a value\n${USAGE}`)
        compareBaseline = value
        i += 1
        break
      case '--write-baseline':
        if (value === undefined) throw new UsageError(`--write-baseline requires a value\n${USAGE}`)
        writeBaseline = value
        i += 1
        break
      case '--max-growth': {
        const parsed = value === undefined ? Number.NaN : Number(value)
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new UsageError(`--max-growth must be a non-negative percent\n${USAGE}`)
        }
        maxGrowth = parsed
        i += 1
        break
      }
      case '--shard':
        if (value === undefined) throw new UsageError(`--shard requires a value\n${USAGE}`)
        shard = parseShardSpec(value)
        i += 1
        break
      case '--config':
        // Already consumed by findConfigFlag's pre-pass; skip its value here.
        if (value === undefined) throw new UsageError(`--config requires a value\n${USAGE}`)
        i += 1
        break
      default:
        throw new UsageError(`Unknown flag: ${flag}\n${USAGE}`)
    }
  }
  // Cross-field validation (010 §8.1: reject before any browser launches).
  if (url === null && routes === null) throw new UsageError(`--url or --routes is required\n${USAGE}`)
  if (url !== null && routes !== null) {
    throw new UsageError(`--url and --routes are mutually exclusive\n${USAGE}`)
  }
  if (routes !== null && baseUrl === null) {
    throw new UsageError(`--routes requires --base-url (the origin route patterns resolve against)\n${USAGE}`)
  }
  if (routes !== null && (output !== null || reportOutput !== null)) {
    throw new UsageError(`--output/--report apply to single-URL mode; --routes writes artifacts under --out-dir\n${USAGE}`)
  }
  if (url !== null && reportDir !== null) {
    throw new UsageError(`--report-dir applies to --routes mode; use --report for a single --url\n${USAGE}`)
  }
  if (shard !== null && routes === null) {
    throw new UsageError(`--shard applies to --routes mode only\n${USAGE}`)
  }
  if (shard !== null && (compareBaseline !== null || writeBaseline !== null)) {
    throw new UsageError(
      `--shard cannot be combined with --compare-baseline/--write-baseline in the same invocation\n${USAGE}`,
    )
  }
  return {
    url,
    routes,
    baseUrl,
    outDir,
    output,
    reportOutput,
    reportDir,
    viewports,
    mode,
    minify,
    format,
    sandboxPolicy,
    cacheDir,
    noCache,
    compareBaseline,
    writeBaseline,
    maxGrowth,
    shard,
  }
}

class UsageError extends Error {}

async function main(): Promise<number> {
  let options: RunOptions
  try {
    options = await parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  try {
    return await run(options, {
      stdout: (text) => process.stdout.write(text),
      stderr: (line) => process.stderr.write(`${line}\n`),
    })
  } catch (err) {
    // Batch-level setup failures (unreadable manifest/baseline/base-url) are
    // usage errors — validated before any browser launched.
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`)
      return 2
    }
    throw err
  }
}

// Set exitCode instead of calling process.exit(): exit() truncates buffered
// stdout when piped, and the CSS payload is the one thing that must arrive
// intact. Node exits naturally once stdout drains.
main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
