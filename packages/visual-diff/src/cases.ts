/**
 * The visual-gate case matrix (docs/testing/002-Visual-Tests.md §8.1).
 *
 * One case per (fixture, viewport) pair, drawn from the small committed
 * fixtures whose golden critical CSS already exists (fixtures/golden/*.css):
 * static@desktop, async@desktop, mobile@mobile. Each case's `criticalCss` is
 * that committed golden CSS, so the 703 parity check proves the ACTUAL
 * shipped extraction reproduces the full render — not a throwaway string.
 *
 * Internal helper (not part of the package's public API): consumed by the
 * visual test suite and the baseline-generation script only.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { VisualCase } from './gate/orchestrate.js'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')

export const BASELINE_DIR = resolve(REPO_ROOT, 'fixtures', 'visual-baselines')

const fixtureUrl = (name: string): string =>
  pathToFileURL(resolve(REPO_ROOT, 'fixtures', name, 'index.html')).href
const goldenCss = (name: string): Promise<string> =>
  readFile(resolve(REPO_ROOT, 'fixtures', 'golden', `${name}.css`), 'utf8')

interface CaseSpec {
  readonly fixtureId: string
  readonly viewport: VisualCase['viewport']
  /** Golden CSS basename in fixtures/golden/. */
  readonly golden: string
}

export const CASE_SPECS: readonly CaseSpec[] = [
  { fixtureId: 'static', viewport: 'desktop', golden: 'static' },
  { fixtureId: 'async', viewport: 'desktop', golden: 'async' },
  { fixtureId: 'mobile', viewport: 'mobile', golden: 'mobile' },
]

export async function buildCases(): Promise<readonly VisualCase[]> {
  return Promise.all(
    CASE_SPECS.map(async (spec) => ({
      fixtureId: spec.fixtureId,
      viewport: spec.viewport,
      url: fixtureUrl(spec.fixtureId),
      criticalCss: await goldenCss(spec.golden),
    })),
  )
}
