/**
 * CI baseline gate (BRIEF.md §2.11: "Compare against baseline"; fail the
 * build when CSS grows beyond a configured threshold).
 *
 * The baseline is a committed JSON map `route → byte size` of the produced
 * CSS artifacts. `--compare-baseline` compares the current run against it;
 * `--write-baseline` (re)generates it. Growth strictly beyond
 * `--max-growth <percent>` (default 5) fails the gate (exit code 3). A size
 * exactly at the threshold passes. New routes (no baseline entry) and
 * removed routes (baseline entry not produced this run) are surfaced as
 * warnings, not failures — they signal a stale baseline, and the remedy is
 * an explicit, reviewed `--write-baseline`, not a silent pass/fail.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { ConfigError } from './config.js'

export type Baseline = Readonly<Record<string, number>>

export interface GrowthFailure {
  readonly route: string
  readonly baselineBytes: number
  readonly producedBytes: number
  /** Actual growth, percent (may be Infinity for a zero-byte baseline). */
  readonly growthPercent: number
}

export interface BaselineComparison {
  readonly failures: readonly GrowthFailure[]
  /** Produced this run but absent from the baseline. */
  readonly newRoutes: readonly string[]
  /** In the baseline but not produced this run. */
  readonly removedRoutes: readonly string[]
}

/**
 * Pure gate logic: a route fails when
 * `producedBytes > baselineBytes * (1 + maxGrowthPercent/100)`.
 */
export function compareBaseline(
  baseline: Baseline,
  produced: Baseline,
  maxGrowthPercent: number,
): BaselineComparison {
  const failures: GrowthFailure[] = []
  const newRoutes: string[] = []
  const removedRoutes: string[] = []
  for (const [route, producedBytes] of Object.entries(produced)) {
    const baselineBytes = baseline[route]
    if (baselineBytes === undefined) {
      newRoutes.push(route)
      continue
    }
    const allowed = baselineBytes * (1 + maxGrowthPercent / 100)
    if (producedBytes > allowed) {
      const growthPercent =
        baselineBytes === 0 ? Number.POSITIVE_INFINITY : ((producedBytes - baselineBytes) / baselineBytes) * 100
      failures.push({ route, baselineBytes, producedBytes, growthPercent })
    }
  }
  for (const route of Object.keys(baseline)) {
    if (!(route in produced)) removedRoutes.push(route)
  }
  return { failures, newRoutes, removedRoutes }
}

/** Load + validate a committed baseline file (fail loudly on bad shape). */
export async function loadBaseline(path: string): Promise<Baseline> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new ConfigError(
      `baseline: could not read "${path}" (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      `baseline: "${path}" is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`baseline: "${path}" must be a JSON object mapping route → byte size`)
  }
  for (const [route, bytes] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
      throw new ConfigError(`baseline: "${route}" must map to a non-negative byte count`)
    }
  }
  return parsed as Baseline
}

/** Write the baseline with sorted keys so diffs stay reviewable. */
export async function writeBaseline(path: string, produced: Baseline): Promise<void> {
  const sorted: Record<string, number> = {}
  for (const route of Object.keys(produced).sort()) {
    sorted[route] = produced[route] as number
  }
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}
