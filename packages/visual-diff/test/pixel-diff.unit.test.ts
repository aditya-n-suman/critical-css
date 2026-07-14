/**
 * Unit tests for the pure diff algorithm (703 §15) and the gate verdict logic
 * (002 §15) — no browser, synthetic images only.
 */

import { describe, expect, it, vi } from 'vitest'
import { PNG } from 'pngjs'
import {
  DEFAULT_DIFF_THRESHOLDS,
  visualDiff,
  type RasterImage,
} from '../src/diff/pixel-diff.js'
import {
  aggregateGateExit,
  runBaselineTest,
  runParityTest,
  VISUAL_GATE_EXIT,
  type VisualTestResult,
} from '../src/gate/gate.js'

/** A W×H raster with a deterministic non-uniform pattern (not RENDER_BLANK). */
function patterned(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (x * 7) % 256
      data[i + 1] = (y * 11) % 256
      data[i + 2] = ((x + y) * 13) % 256
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

function clone(img: RasterImage): RasterImage {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) }
}

function toPngBytes(img: RasterImage): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data)
  return new Uint8Array(PNG.sync.write(png))
}

describe('visualDiff (703 §10.1)', () => {
  it('identical images → PASS with zero differing pixels', () => {
    const img = patterned(100, 100)
    const result = visualDiff(img, clone(img))
    expect(result.verdict).toBe('PASS')
    expect(result.diffCount).toBe(0)
    expect(result.mask).not.toBeNull()
  })

  it('a single-pixel change stays below maxDiffRatio → PASS (noise tolerance)', () => {
    const ref = patterned(100, 100)
    const cand = clone(ref)
    // Flip one pixel to a strongly different colour.
    cand.data[0] = 255 - (cand.data[0] ?? 0)
    cand.data[1] = 255 - (cand.data[1] ?? 0)
    cand.data[2] = 255 - (cand.data[2] ?? 0)
    const result = visualDiff(ref, cand)
    expect(result.diffCount).toBeLessThanOrEqual(1)
    expect(result.diffRatio).toBeLessThanOrEqual(DEFAULT_DIFF_THRESHOLDS.maxDiffRatio)
    expect(result.verdict).toBe('PASS')
  })

  it('a shifted coherent block → FAIL (real parity break)', () => {
    const ref = patterned(100, 100)
    const cand = clone(ref)
    // Recolour a 30×30 block: a spatially-coherent, high-magnitude change.
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        const i = (y * 100 + x) * 4
        cand.data[i] = 255
        cand.data[i + 1] = 0
        cand.data[i + 2] = 0
        cand.data[i + 3] = 255
      }
    }
    const result = visualDiff(ref, cand)
    expect(result.verdict).toBe('FAIL')
    expect(result.diffRatio).toBeGreaterThan(DEFAULT_DIFF_THRESHOLDS.maxDiffRatio)
  })

  it('dimension mismatch → immediate DIMENSION_MISMATCH (never resized)', () => {
    const result = visualDiff(patterned(100, 100), patterned(100, 80))
    expect(result.verdict).toBe('DIMENSION_MISMATCH')
    expect(result.mask).toBeNull()
  })

  it('an all-background (failed-to-paint) reference → RENDER_BLANK, not a silent PASS', () => {
    const blank: RasterImage = { width: 50, height: 50, data: new Uint8Array(50 * 50 * 4).fill(255) }
    const result = visualDiff(blank, clone(blank))
    expect(result.verdict).toBe('RENDER_BLANK')
  })
})

describe('runBaselineTest (002 §10.1)', () => {
  const baseline = toPngBytes(patterned(60, 60))

  it('missing baseline → NEW_BASELINE_REQUIRED', async () => {
    const result = await runBaselineTest('visual::x::desktop', null, () => Promise.resolve(baseline))
    expect(result.verdict).toBe('NEW_BASELINE_REQUIRED')
    expect(result.artifacts?.candidate).toBeDefined()
  })

  it('current matches baseline → PASS', async () => {
    const result = await runBaselineTest('visual::x::desktop', baseline, () => Promise.resolve(baseline))
    expect(result.verdict).toBe('PASS')
  })

  it('a coherent diff far above threshold → FAIL without a retry', async () => {
    const changed = clone(patterned(60, 60))
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const i = (y * 60 + x) * 4
      changed.data[i] = 0; changed.data[i + 1] = 255; changed.data[i + 2] = 0; changed.data[i + 3] = 255
    }
    const render = vi.fn(() => Promise.resolve(toPngBytes(changed)))
    const result = await runBaselineTest('visual::x::desktop', baseline, render)
    expect(result.verdict).toBe('FAIL')
    expect(render).toHaveBeenCalledTimes(1) // far above band → no retry
    expect(result.artifacts?.mask).not.toBeNull()
  })
})

describe('runParityTest (703)', () => {
  const full = toPngBytes(patterned(60, 60))

  it('identical R_full/R_crit → PASS', async () => {
    const result = await runParityTest('parity::x::desktop', () => Promise.resolve(full), () => Promise.resolve(full))
    expect(result.verdict).toBe('PASS')
  })

  it('divergent R_crit → FAIL (missing-rule detection)', async () => {
    const crit = clone(patterned(60, 60))
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const i = (y * 60 + x) * 4
      crit.data[i] = 10; crit.data[i + 1] = 10; crit.data[i + 2] = 10; crit.data[i + 3] = 255
    }
    const result = await runParityTest('parity::x::desktop', () => Promise.resolve(full), () => Promise.resolve(toPngBytes(crit)))
    expect(result.verdict).toBe('FAIL')
  })
})

describe('aggregateGateExit (703 §8.6 / 002 §8.4 hard gate)', () => {
  const r = (verdict: VisualTestResult['verdict'], diffVerdict?: VisualTestResult['diffVerdict']): VisualTestResult => ({
    testId: 't', verdict, ...(diffVerdict !== undefined ? { diffVerdict } : {}),
  })

  it('all PASS → 0', () => {
    expect(aggregateGateExit([r('PASS', 'PASS'), r('PASS', 'PASS')])).toBe(VISUAL_GATE_EXIT.PASS)
  })
  it('any FAIL → DIFF_FAILED', () => {
    expect(aggregateGateExit([r('PASS', 'PASS'), r('FAIL', 'FAIL')])).toBe(VISUAL_GATE_EXIT.DIFF_FAILED)
  })
  it('a NEW_BASELINE_REQUIRED (no FAIL) → BASELINE_REQUIRED', () => {
    expect(aggregateGateExit([r('PASS', 'PASS'), r('NEW_BASELINE_REQUIRED')])).toBe(VISUAL_GATE_EXIT.BASELINE_REQUIRED)
  })
  it('a render error dominates everything', () => {
    expect(aggregateGateExit([r('FAIL', 'DIMENSION_MISMATCH')])).toBe(VISUAL_GATE_EXIT.RENDER_ERROR)
  })
})
