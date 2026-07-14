/**
 * The G4 visual-diff CI gate (M4 exit criterion 3) — real Playwright Chromium,
 * real fixtures, committed baselines (Design Principle 1).
 *
 * This suite IS the required CI gate: a FAIL / NEW_BASELINE_REQUIRED verdict
 * fails an assertion, which fails `pnpm test` with a non-zero exit — the hard
 * gate of 703 §8.6 / 002 §8.4. It exercises BOTH layers over the same renders:
 *   - 703 dual-render parity: R_full vs R_crit (critical-CSS sufficiency);
 *   - 002 baseline regression: current R_full vs the committed baseline PNG.
 *
 * A deliberately-broken critical CSS case (703 §15) proves the gate is not a
 * trivial always-pass: stripping a layout rule must make parity FAIL.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserManager } from '@critical-css/browser'
import { runCaseGate, runParityTest, VISUAL_GATE_EXIT, aggregateGateExit, baselineMetaPath } from '../src/index.js'
import type { BaselineMeta } from '../src/index.js'
import { renderCase } from '../src/gate/orchestrate.js'
import { visualDiff, decodePng } from '../src/diff/pixel-diff.js'
import { buildCases, BASELINE_DIR } from '../src/cases.js'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')

/** Explicit soft-gate override for the 002 baseline leg (002 §8.4 rollout mode). */
const BASELINE_SOFT = process.env.VISUAL_BASELINE_SOFT === '1'

async function readBaselineMeta(fixtureId: string, viewport: string): Promise<BaselineMeta | null> {
  try {
    return JSON.parse(await readFile(baselineMetaPath(BASELINE_DIR, fixtureId, viewport), 'utf8')) as BaselineMeta
  } catch {
    return null
  }
}

describe('visual gate (G4, M4 exit criterion 3)', () => {
  let manager: BrowserManager
  let runnerVersion: string

  beforeAll(async () => {
    manager = new BrowserManager({ maxConcurrency: 1 })
    runnerVersion = `chromium ${await manager.browserVersion()}`
  })
  afterAll(async () => {
    await manager.teardown()
  })

  it('every committed case: 703 parity PASS (hard) and 002 baseline PASS (hard when browser pinned)', async () => {
    const cases = await buildCases()
    expect(cases.length).toBeGreaterThan(0)
    const results = []
    for (const testCase of cases) {
      const result = await runCaseGate(manager, testCase, BASELINE_DIR)
      // 703 same-session parity is ALWAYS a hard gate: it compares two renders
      // from the same browser build in the same run, so it carries no
      // cross-host determinism risk (703 §8.2/§8.6).
      expect(
        result.parity.verdict,
        `703 parity for ${testCase.fixtureId}::${testCase.viewport} (diffRatio=${result.parity.diffRatio})`,
      ).toBe('PASS')
      results.push(result.parity)

      // 002 baseline leg: hard gate ONLY when the runner's browser build
      // matches the build the baseline was captured under (002 §8.5.1 pinning,
      // §11 startup version check). On a version mismatch — or under an
      // explicit soft override (002 §8.4 rollout mode) — a baseline drift is a
      // SOFT signal (loud warning, not a build failure), because on an
      // unpinned host it cannot be distinguished from cross-host font/raster
      // drift, which is an environment concern, not an engine regression.
      const meta = await readBaselineMeta(testCase.fixtureId, testCase.viewport)
      const versionPinned = meta !== null && meta.browserVersion === runnerVersion
      const hardBaseline = versionPinned && !BASELINE_SOFT
      if (hardBaseline) {
        expect(
          result.baseline.verdict,
          `002 baseline for ${testCase.fixtureId}::${testCase.viewport} (diffRatio=${result.baseline.diffRatio})`,
        ).toBe('PASS')
        results.push(result.baseline)
      } else if (result.baseline.verdict !== 'PASS') {
        // Soft: surface loudly (002 §11) but do not fail the build.
        console.warn(
          `[002 baseline SOFT] ${testCase.fixtureId}::${testCase.viewport}: ` +
            `verdict=${result.baseline.verdict} diffRatio=${result.baseline.diffRatio}; ` +
            `runner=${runnerVersion} baseline=${meta?.browserVersion ?? '(none)'}` +
            (BASELINE_SOFT ? ' [VISUAL_BASELINE_SOFT=1]' : ' [browser-version mismatch — see 002 §8.5.2 font/container pinning]'),
        )
      }
    }
    // The aggregate hard-gate exit code over the HARD verdicts must be PASS (0).
    expect(aggregateGateExit(results)).toBe(VISUAL_GATE_EXIT.PASS)
  })

  it('deliberately dropping a layout-critical rule makes 703 parity FAIL (not a trivial pass)', async () => {
    const url = pathToFileURL(resolve(REPO_ROOT, 'fixtures', 'static', 'index.html')).href
    const golden = await readFile(resolve(REPO_ROOT, 'fixtures', 'golden', 'static.css'), 'utf8')
    // Remove the .hero block (height/background/colour/padding) — a
    // layout-and-colour-affecting rule that dominates the above-fold region.
    const broken = golden.replace(/\.hero \{[^}]*\}/, '')
    expect(broken).not.toBe(golden)

    const brokenCase = { fixtureId: 'static-broken', viewport: 'desktop' as const, url, criticalCss: broken }
    const { full, crit } = await renderCase(manager, brokenCase)
    const parity = await runParityTest(
      'parity::static-broken::desktop',
      () => Promise.resolve(full),
      () => Promise.resolve(crit),
    )
    expect(parity.verdict).toBe('FAIL')
    // Sanity: the difference is spatially coherent (well above residual noise).
    const direct = visualDiff(decodePng(full), decodePng(crit))
    expect(direct.diffRatio).toBeGreaterThan(0.001)
  })
})
