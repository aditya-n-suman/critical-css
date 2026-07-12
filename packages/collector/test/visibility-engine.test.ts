/**
 * Visibility Engine unit tests (task 005): pure host-side classification over
 * synthetic snapshots — zero browser involvement by design (200 §10.1).
 */

import { describe, expect, it } from 'vitest'
import type { DOMSnapshotNode, DOMSnapshotResult } from '@critical-css/browser'
import { DEFAULT_VISIBILITY_CONFIG } from '@critical-css/shared'
import { classifyVisibility, matchableNodeIds } from '../src/index.js'

const BASE_STYLES: Record<string, string> = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  transform: 'none',
  overflow: 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  contain: 'none',
  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  filter: 'none',
  'backdrop-filter': 'none',
  perspective: 'none',
  'will-change': 'auto',
}

let idCounter = 0
function node(overrides: Partial<DOMSnapshotNode> & { rect?: Partial<DOMSnapshotNode['boundingRect']> }): DOMSnapshotNode {
  const { rect, computedStyles, ...rest } = overrides
  return {
    nodeId: idCounter++,
    parentNodeId: null,
    tagName: 'DIV',
    classList: [],
    attributes: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50, ...rect },
    visible: true,
    isDisplayContents: false,
    computedStyles: { ...BASE_STYLES, ...computedStyles },
    ...rest,
  }
}

function snapshot(nodes: DOMSnapshotNode[], foldPx = 800): DOMSnapshotResult {
  return {
    foldPx,
    viewportWidth: 1280,
    viewportHeight: 800,
    scrollX: 0,
    scrollY: 0,
    capturedUrl: 'about:blank',
    nodes,
  }
}

function classify(nodes: DOMSnapshotNode[], config = DEFAULT_VISIBILITY_CONFIG, foldPx = 800) {
  idCounter = 0
  return classifyVisibility(snapshot(nodes, foldPx), 'snap-test', config)
}

describe('classifyVisibility — seven-term predicate (200 §7.1)', () => {
  it('classifies display:none', () => {
    idCounter = 0
    const result = classify([node({ computedStyles: { display: 'none' }, rect: { width: 0, height: 0 } })])
    expect(result.annotations[0]).toMatchObject({ isVisible: false, reason: 'DISPLAY_NONE' })
  })

  it('classifies zero dimensions (in-viewport but 0×0)', () => {
    const result = classify([node({ rect: { width: 0, height: 0 } })])
    expect(result.annotations[0]).toMatchObject({ isVisible: false, reason: 'ZERO_DIMENSIONS' })
  })

  it('classifies visibility:hidden — and honors the config toggle', () => {
    const hidden = node({ computedStyles: { visibility: 'hidden' } })
    expect(classify([hidden]).annotations[0]?.reason).toBe('VISIBILITY_HIDDEN')
    const off = classify([node({ computedStyles: { visibility: 'hidden' } })], {
      ...DEFAULT_VISIBILITY_CONFIG,
      honorVisibilityHidden: false,
    })
    expect(off.annotations[0]?.isVisible).toBe(true)
  })

  it('opacity modes: default ignores, treatZeroAsHidden excludes', () => {
    expect(classify([node({ computedStyles: { opacity: '0' } })]).annotations[0]?.isVisible).toBe(true)
    const strict = classify([node({ computedStyles: { opacity: '0' } })], {
      ...DEFAULT_VISIBILITY_CONFIG,
      opacityMode: 'treatZeroAsHidden',
    })
    expect(strict.annotations[0]).toMatchObject({ isVisible: false, reason: 'OPACITY_HIDDEN' })
  })

  it('classifies below-fold (half-open interval: touching the fold fails)', () => {
    const below = classify([node({ rect: { y: 900 } })])
    expect(below.annotations[0]).toMatchObject({ isVisible: false, reason: 'BELOW_FOLD' })
    const touching = classify([node({ rect: { y: 800, height: 100 } })])
    expect(touching.annotations[0]?.reason).toBe('BELOW_FOLD')
    const partial = classify([node({ rect: { y: 790, height: 100 } })])
    expect(partial.annotations[0]?.isVisible).toBe(true)
    expect(partial.annotations[0]?.overlapFraction).toBeCloseTo(0.1)
  })

  it('classifies clipped-by-ancestor overflow with ancestor attribution (203)', () => {
    idCounter = 0
    const parent = node({ computedStyles: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, rect: { x: 0, y: 0, width: 200, height: 100 } })
    const clipped = node({ parentNodeId: parent.nodeId, rect: { x: 500, y: 0, width: 50, height: 50 } })
    const inside = node({ parentNodeId: parent.nodeId, rect: { x: 10, y: 10, width: 50, height: 50 } })
    const result = classifyVisibility(snapshot([parent, clipped, inside]), 's', DEFAULT_VISIBILITY_CONFIG)
    expect(result.annotations[1]).toMatchObject({
      isVisible: false,
      reason: 'CLIPPED_BY_ANCESTOR',
      contributingAncestorNodeId: parent.nodeId,
    })
    expect(result.annotations[2]?.isVisible).toBe(true)
  })

  it('overflow-x:hidden clips the X axis only (axis independence)', () => {
    idCounter = 0
    const parent = node({ computedStyles: { 'overflow-x': 'hidden' }, rect: { width: 200, height: 100 } })
    const belowButInX = node({ parentNodeId: parent.nodeId, rect: { x: 10, y: 300, width: 50, height: 50 } })
    const result = classifyVisibility(snapshot([parent, belowButInX]), 's', DEFAULT_VISIBILITY_CONFIG)
    // Y is unbounded by overflow-x — the node stays visible (y 300 < fold).
    expect(result.annotations[1]?.isVisible).toBe(true)
  })

  it('sticky with an active offset is always-critical regardless of resting position (205/REQ-109)', () => {
    const sticky = classify([node({ computedStyles: { position: 'sticky', top: '0px' }, rect: { y: 5000 } })])
    expect(sticky.annotations[0]?.isVisible).toBe(true)
    // No active offset → behaves relative → ordinary geometry (below fold).
    const inert = classify([node({ computedStyles: { position: 'sticky' }, rect: { y: 5000 } })])
    expect(inert.annotations[0]?.reason).toBe('BELOW_FOLD')
    // geometry-only policy: resting position rules.
    const geometryOnly = classify(
      [node({ computedStyles: { position: 'sticky', top: '0px' }, rect: { y: 5000 } })],
      { ...DEFAULT_VISIBILITY_CONFIG, stickyPolicy: 'geometry-only' },
    )
    expect(geometryOnly.annotations[0]?.reason).toBe('BELOW_FOLD')
  })

  it('viewport-relative fixed is always-critical; transform-ancestor fixed falls back to geometry (206)', () => {
    idCounter = 0
    const fixedBelow = classify([node({ computedStyles: { position: 'fixed', bottom: '10px' }, rect: { y: 5000 } })])
    expect(fixedBelow.annotations[0]?.isVisible).toBe(true)

    idCounter = 0
    const transformedAncestor = node({ computedStyles: { transform: 'translateX(0px)' } })
    const nestedFixed = node({
      parentNodeId: transformedAncestor.nodeId,
      computedStyles: { position: 'fixed' },
      rect: { y: 5000 },
    })
    const result = classifyVisibility(snapshot([transformedAncestor, nestedFixed]), 's', DEFAULT_VISIBILITY_CONFIG)
    expect(result.annotations[1]).toMatchObject({ isVisible: false, reason: 'BELOW_FOLD' })
  })

  it('transform-offscreen exclusion is opt-in (204/REQ-103)', () => {
    const transformed = node({ computedStyles: { transform: 'matrix(1, 0, 0, 1, 0, 5000)' }, rect: { y: 5000 } })
    // Default off: plain BELOW_FOLD.
    expect(classify([transformed]).annotations[0]?.reason).toBe('BELOW_FOLD')
    idCounter = 0
    const optIn = classify(
      [node({ computedStyles: { transform: 'matrix(1, 0, 0, 1, 0, 5000)' }, rect: { y: 5000 } })],
      { ...DEFAULT_VISIBILITY_CONFIG, ignoreTransformedOffscreen: true },
    )
    expect(optIn.annotations[0]?.reason).toBe('TRANSFORMED_OFFSCREEN')
  })

  it('annotates every node — never sparse (200 §8.3)', () => {
    const result = classify([node({}), node({ rect: { y: 5000 } }), node({ computedStyles: { display: 'none' } })])
    expect(result.annotations).toHaveLength(3)
  })
})

describe('matchableNodeIds', () => {
  it('includes visible nodes plus above-fold hidden nodes (rendering parity, REQ-501)', () => {
    idCounter = 0
    const visible = node({})
    const hiddenAboveFold = node({ computedStyles: { display: 'none' }, rect: { width: 0, height: 0 } })
    const belowFold = node({ rect: { y: 5000 } })
    const snap = snapshot([visible, hiddenAboveFold, belowFold])
    const annotated = classifyVisibility(snap, 's', DEFAULT_VISIBILITY_CONFIG)
    const ids = matchableNodeIds(snap, annotated)
    expect(ids.has(visible.nodeId)).toBe(true)
    expect(ids.has(hiddenAboveFold.nodeId)).toBe(true)
    expect(ids.has(belowFold.nodeId)).toBe(false)
  })
})
