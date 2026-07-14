/**
 * Baseline storage + lifecycle (docs/testing/002-Visual-Tests.md §8.2).
 *
 * Each test ID `visual::<fixtureId>::<viewportId>` maps to exactly one
 * baseline image at a deterministic path
 * `<baselineDir>/<fixtureId>/<viewportId>.png`, with a sidecar manifest
 * `<viewportId>.meta.json` recording the browser/engine version, the diff
 * thresholds in effect at capture, and a mandatory non-empty reason string
 * (002 §8.2). Baselines are lossless PNG, never regenerated silently — an
 * update is an explicit, reviewable commit (002 §8.2, Principle 5).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DiffThresholds } from '../diff/pixel-diff.js'

export interface BaselineMeta {
  readonly testId: string
  readonly browserVersion: string
  readonly thresholds: DiffThresholds
  /** Mandatory, non-empty (002 §8.2 / §11 — enforced at the tooling level). */
  readonly reason: string
  readonly capturedAt: string
}

export function testId(fixtureId: string, viewportId: string): string {
  return `visual::${fixtureId}::${viewportId}`
}

export function baselineImagePath(baselineDir: string, fixtureId: string, viewportId: string): string {
  return join(baselineDir, fixtureId, `${viewportId}.png`)
}

export function baselineMetaPath(baselineDir: string, fixtureId: string, viewportId: string): string {
  return join(baselineDir, fixtureId, `${viewportId}.meta.json`)
}

/** Load a stored baseline image, or null if absent/undecodable (002 §10.1 fc a). */
export async function readBaselineImage(
  baselineDir: string,
  fixtureId: string,
  viewportId: string,
): Promise<Uint8Array | null> {
  try {
    const bytes = await readFile(baselineImagePath(baselineDir, fixtureId, viewportId))
    return new Uint8Array(bytes)
  } catch {
    return null
  }
}

/**
 * Commit a baseline image + sidecar manifest. Refuses an empty/placeholder
 * reason at the tooling level, not by convention (002 §11).
 */
export async function writeBaselineImage(
  baselineDir: string,
  fixtureId: string,
  viewportId: string,
  png: Uint8Array,
  meta: Omit<BaselineMeta, 'testId' | 'capturedAt'> & { capturedAt?: string },
): Promise<void> {
  if (meta.reason.trim() === '') {
    throw new Error('baseline: a non-empty reason string is required to write a baseline (002 §8.2)')
  }
  const imgPath = baselineImagePath(baselineDir, fixtureId, viewportId)
  await mkdir(dirname(imgPath), { recursive: true })
  await writeFile(imgPath, png)
  const fullMeta: BaselineMeta = {
    testId: testId(fixtureId, viewportId),
    browserVersion: meta.browserVersion,
    thresholds: meta.thresholds,
    reason: meta.reason,
    capturedAt: meta.capturedAt ?? new Date().toISOString(),
  }
  await writeFile(baselineMetaPath(baselineDir, fixtureId, viewportId), `${JSON.stringify(fullMeta, null, 2)}\n`, 'utf8')
}
