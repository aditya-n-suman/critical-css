/**
 * BundleAdapter / RunIndexAdapter (docs/design/1005-Debug-UI.md §8.4),
 * scoped to what this milestone's CLI actually persists.
 *
 * `apps/cli`'s `--report-dir <dir>` (route mode) and `--report <file>`
 * (single-URL mode) each write one `<artifactPath>.report.json` file per run,
 * containing `JSON.stringify(reports)` where `reports: readonly
 * ReportBundle[]` — one entry per viewport extracted in that invocation
 * (apps/cli/src/run.ts `writeRouteReport`, apps/cli/src/extract.ts `reports`).
 *
 * This adapter is a read-only directory scanner: it never invokes the CLI,
 * never imports an extraction-side package, and never re-derives a
 * `ReportBundle` — it only parses what the Reporter already wrote to disk.
 * This is the file-format half of 1005 §8.4's `RunIndexAdapter`/
 * `BundleAdapter` pair; `packages/cache`'s `CacheStore` (802) is NOT wired in
 * (see README "Scope cuts") — every fact this app renders comes from
 * `--report-dir` JSON, not from the cache backend directly.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ReportBundle } from '@critical-css/reporter'
import type { RunRecord } from '../types.js'

const REPORT_SUFFIX = '.report.json'

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (entry.isFile() && entry.name.endsWith(REPORT_SUFFIX)) {
      files.push(full)
    }
  }
  return files
}

/** Best-effort shape guard — malformed/foreign JSON is skipped, never thrown (802 §8.2 "corruption is never an error" spirit). */
function isReportBundleArray(value: unknown): value is ReportBundle[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as Record<string, unknown>)['route'] === 'string' &&
        typeof (v as Record<string, unknown>)['viewportProfileId'] === 'string' &&
        typeof (v as Record<string, unknown>)['mode'] === 'string',
    )
  )
}

export interface LoadReportDirResult {
  readonly runs: readonly RunRecord[];
  /** Report files that existed but could not be parsed as a ReportBundle[] — surfaced, never silently dropped. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

/**
 * Scans `reportDir` recursively for every `*.report.json` file and flattens
 * each file's `ReportBundle[]` into one `RunRecord` per (route, viewport).
 */
export async function loadReportDir(reportDir: string): Promise<LoadReportDirResult> {
  const files = await walk(reportDir)
  const runs: RunRecord[] = []
  const skipped: { path: string; reason: string }[] = []
  for (const file of files) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch (err) {
      skipped.push({ path: file, reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }
    if (!isReportBundleArray(parsed)) {
      skipped.push({ path: file, reason: 'not a ReportBundle[] (missing route/viewportProfileId/mode fields)' })
      continue
    }
    const rel = relative(reportDir, file)
    for (const bundle of parsed) {
      runs.push({
        id: `${rel}::${bundle.viewportProfileId}`,
        reportFilePath: file,
        route: bundle.route,
        viewportProfileId: bundle.viewportProfileId,
        mode: bundle.mode,
        bundle,
      })
    }
  }
  // Deterministic order: route-dir authors and CI logs both benefit from a
  // stable listing, not filesystem-readdir order.
  runs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { runs, skipped }
}
