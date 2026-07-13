#!/usr/bin/env node
/**
 * critical-css-engine CLI (M1 MVP):
 *   extract --url <url> [--viewport desktop|tablet|mobile] [--output <path>]
 *
 * Exit codes: 0 success, 1 failure (attributed diagnostic on stderr), 2 usage.
 */

import { writeFile } from 'node:fs/promises'
import { ExtractionError } from '@critical-css/shared'
import type { SandboxPolicy } from '@critical-css/shared'
import { ConfigError, isSandboxPolicy, isViewport, loadConfigFile } from './config.js'
import type { CliConfig, Mode, ViewportName } from './config.js'
import { extract } from './extract.js'

interface ParsedArgs {
  readonly url: string
  readonly viewports: readonly ViewportName[]
  readonly mode: Mode
  readonly output: string | null
  readonly reportOutput: string | null
  readonly minify: boolean
  readonly format: 'raw-css' | 'inline-style' | 'json-envelope'
  readonly sandboxPolicy: SandboxPolicy
}

const USAGE =
  'Usage: critical-css-engine extract --url <url> [--viewport desktop|tablet|mobile] [--viewports d,t,m] [--mode cssom|coverage|hybrid] [--output <path>] [--report <path>] [--minify] [--format raw-css|inline-style|json-envelope] [--sandbox-policy full|ci-container|unsafe-no-sandbox] [--config <path>]'

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

async function parseArgs(argv: readonly string[]): Promise<ParsedArgs> {
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
  let minify = fileConfig.minify ?? false
  let format: ParsedArgs['format'] = fileConfig.format ?? 'raw-css'
  let sandboxPolicy: SandboxPolicy = fileConfig.sandboxPolicy ?? envSandboxPolicy() ?? 'full'
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    const value = rest[i + 1]
    switch (flag) {
      case '--minify':
        minify = true
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
      case '--sandbox-policy':
        if (!isSandboxPolicy(value)) {
          throw new UsageError(`--sandbox-policy must be full|ci-container|unsafe-no-sandbox\n${USAGE}`)
        }
        sandboxPolicy = value
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
  if (url === null) throw new UsageError(`--url is required\n${USAGE}`)
  return { url, viewports, mode, output, reportOutput, minify, format, sandboxPolicy }
}

class UsageError extends Error {}

async function main(): Promise<number> {
  let args: ParsedArgs
  try {
    args = await parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  try {
    const outcome = await extract({
      url: args.url,
      viewports: args.viewports,
      mode: args.mode,
      minify: args.minify,
      format: args.format,
      sandboxPolicy: args.sandboxPolicy,
    })
    for (const diagnostic of outcome.diagnostics) {
      const location = diagnostic.source?.url !== null && diagnostic.source?.url !== undefined ? ` (${diagnostic.source.url})` : ''
      process.stderr.write(
        `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}\n`,
      )
    }
    process.stderr.write(
      `mode=${outcome.stats.mode} viewports=${outcome.stats.viewports.join('+')} — ${outcome.stats.mergedRules} merged rules, ${outcome.stats.dependencies} dependencies\n`,
    )
    if (args.reportOutput !== null) {
      await writeFile(args.reportOutput, JSON.stringify(outcome.reports, null, 2), 'utf8')
    }
    if (args.output !== null) {
      await writeFile(args.output, outcome.output, 'utf8')
    } else {
      process.stdout.write(outcome.output)
    }
    return 0
  } catch (err) {
    // Render failures through the same diagnostic taxonomy as the success
    // path — stable machine-readable codes, not ad hoc Error.name strings.
    if (err instanceof ExtractionError) {
      const diagnostic = err.toDiagnostic()
      process.stderr.write(`extraction failed — [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}\n`)
    } else {
      process.stderr.write(`extraction failed — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`)
    }
    // Fail-Fast Diagnostics (006 Principle 6): a wrapped launch/navigation
    // failure is worthless without its real cause — surface the full chain
    // rather than only the outer, generic message.
    let cause: unknown = err instanceof Error ? err.cause : undefined
    while (cause !== undefined) {
      process.stderr.write(`  caused by: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}\n`)
      cause = cause instanceof Error ? cause.cause : undefined
    }
    return 1
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
