/**
 * Baseline generation (docs/testing/002-Visual-Tests.md §8.2).
 *
 * Captures each case's R_full above-fold render and commits it as the
 * baseline image + sidecar manifest under fixtures/visual-baselines/. Run
 * after a KNOWN-GOOD render only:
 *
 *   pnpm --filter @critical-css/visual-diff build
 *   node packages/visual-diff/scripts/generate-baselines.mjs "<reason>"
 *
 * Baselines are reviewed, versioned artifacts — regenerate deliberately, never
 * to make a red gate green (002 §8.2, DoD §11.3 analogue).
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserManager } from '@critical-css/browser'
import { renderCase, writeBaselineImage, DEFAULT_DIFF_THRESHOLDS } from '@critical-css/visual-diff'
import { buildCases, BASELINE_DIR } from '../dist/cases.js'

const reason = process.argv[2] ?? 'initial baseline capture (known-good render)'

async function main() {
  const cases = await buildCases()
  const manager = new BrowserManager({ maxConcurrency: 1 })
  try {
    // Record the REAL resolved browser build (002 §8.2 / §11), not a
    // placeholder — this is what the suite checks runner parity against.
    const browserVersion = `chromium ${await manager.browserVersion()}`
    console.error(`resolved browser version: ${browserVersion}`)
    for (const c of cases) {
      const { full } = await renderCase(manager, c)
      await writeBaselineImage(BASELINE_DIR, c.fixtureId, c.viewport, full, {
        browserVersion,
        thresholds: DEFAULT_DIFF_THRESHOLDS,
        reason,
      })
      console.error(`baseline written: visual::${c.fixtureId}::${c.viewport}`)
    }
  } finally {
    await manager.teardown()
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
