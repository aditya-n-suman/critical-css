/**
 * Noise-tolerant above-fold pixel diff (docs/design/703-Visual-Diff.md §10.1).
 *
 * The diff does NOT compare raw RGB equality. It uses the anti-aliasing-aware
 * perceptual comparison of the `pixelmatch` family (703 §8.4 item 2): a
 * luminance-weighted per-pixel color distance, plus an AA classifier
 * (`isAntiAliased`) so edge-smoothing pixels are excluded from the failure
 * count. The aggregate gate (703 §8.4 item 3) then thresholds on the *count*
 * / *fraction* of remaining non-AA differing pixels, not on any single pixel.
 *
 * `pixelmatch` + `pngjs` are the concrete diff/decoder libraries. They are a
 * test/CI-scope image dependency, not part of the ADR-0001 core stack; 703
 * §8.4/§10.1 and §17 name the `pixelmatch`/Blink-diff family and the Yang et
 * al. AA heuristic as the intended prior art, so this is the standard
 * lightweight choice the design leaves open rather than a deviation.
 */

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/** A decoded RGBA raster. */
export interface RasterImage {
  readonly width: number
  readonly height: number
  /** RGBA, 4 bytes/pixel, row-major (pngjs layout). */
  readonly data: Uint8Array
}

export type DiffVerdict = 'PASS' | 'FAIL' | 'DIMENSION_MISMATCH' | 'RENDER_BLANK'

export interface DiffThresholds {
  /** Per-pixel color-distance sensitivity (0–1). Lower = stricter (703 §8.4). */
  readonly perceptualThreshold: number
  /** Fraction of non-AA differing pixels tolerated before FAIL (703 §8.4). */
  readonly maxDiffRatio: number
  /** Count AA-classified pixels as differences. Default false (703 §8.4). */
  readonly includeAA: boolean
}

/**
 * Conservative defaults, correctness-over-tolerance (703 §8.4, Principle 3):
 * strict per-pixel sensitivity, a tiny aggregate ratio that absorbs residual
 * single-pixel noise but never a spatially-coherent block.
 */
export const DEFAULT_DIFF_THRESHOLDS: DiffThresholds = {
  perceptualThreshold: 0.1,
  maxDiffRatio: 0.001,
  includeAA: false,
}

export interface DiffResult {
  readonly verdict: DiffVerdict
  readonly diffCount: number
  readonly diffRatio: number
  readonly width: number
  readonly height: number
  /** PNG bytes of the highlighted diff mask (703 §10.1); null on a setup FAIL. */
  readonly mask: Uint8Array | null
}

export function decodePng(bytes: Uint8Array): RasterImage {
  const png = PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: png.data }
}

function encodeMask(width: number, height: number, data: Uint8Array): Uint8Array {
  const png = new PNG({ width, height })
  png.data = Buffer.from(data)
  return new Uint8Array(PNG.sync.write(png))
}

/**
 * A render that failed to paint is a solid background, not parity. Reject
 * images whose pixels are (near-)uniform below a minimum distinct-pixel
 * fraction (703 §10.1 failure case b) — a real blank splash page still
 * trips this, which is why the caller treats RENDER_BLANK as a setup error to
 * investigate, never a silent PASS.
 */
function distinctPixelFraction(img: RasterImage): number {
  const { data } = img
  if (data.length < 4) return 0
  const r0 = data[0]!
  const g0 = data[1]!
  const b0 = data[2]!
  let distinct = 0
  const total = img.width * img.height
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) distinct += 1
  }
  return total === 0 ? 0 : distinct / total
}

const MIN_DISTINCT_FRACTION = 0.001

/**
 * Compare two equal-dimension RGBA rasters. Returns a verdict, the non-AA
 * differing-pixel count/ratio, and a diff mask. Dimension mismatch is an
 * immediate FAIL (never silently resized — resizing fabricates pixels and
 * masks real differences, 703 §10.1 failure case a).
 */
export function visualDiff(
  ref: RasterImage,
  cand: RasterImage,
  thresholds: DiffThresholds = DEFAULT_DIFF_THRESHOLDS,
): DiffResult {
  if (ref.width !== cand.width || ref.height !== cand.height) {
    return {
      verdict: 'DIMENSION_MISMATCH',
      diffCount: Number.POSITIVE_INFINITY,
      diffRatio: 1,
      width: ref.width,
      height: ref.height,
      mask: null,
    }
  }
  // A failed-to-paint render (all-background) is a setup failure, not parity.
  if (distinctPixelFraction(ref) < MIN_DISTINCT_FRACTION) {
    return { verdict: 'RENDER_BLANK', diffCount: 0, diffRatio: 0, width: ref.width, height: ref.height, mask: null }
  }

  const { width, height } = ref
  const maskData = new Uint8Array(width * height * 4)
  const diffCount = pixelmatch(ref.data, cand.data, maskData, width, height, {
    threshold: thresholds.perceptualThreshold,
    includeAA: thresholds.includeAA,
    // pixelmatch marks AA pixels yellow and real diffs red when `diffMask` is
    // false (default), matching 703 §10.1's mask colour convention.
  })
  const area = width * height
  const diffRatio = area === 0 ? 0 : diffCount / area
  return {
    verdict: diffRatio <= thresholds.maxDiffRatio ? 'PASS' : 'FAIL',
    diffCount,
    diffRatio,
    width,
    height,
    mask: encodeMask(width, height, maskData),
  }
}
