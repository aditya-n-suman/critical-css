/**
 * Visibility Engine (docs/tasks/005-Implement-Visibility-Engine.md,
 * docs/design/200–206, BI-03.3).
 *
 * Pure host-side classification over an already-captured DomSnapshot —
 * zero page.evaluate() round trips (106 §8.7). Implements the canonical
 * seven-term predicate (200 §7.1) in fixed evaluation order; the first
 * sufficient reason wins (200 §12).
 */

import type { DOMSnapshotNode, DOMSnapshotResult } from '@critical-css/browser'
import { DEFAULT_VISIBILITY_CONFIG } from '@critical-css/shared'
import type {
  VisibilityAnnotatedNodeSet,
  VisibilityAnnotation,
  VisibilityConfig,
  VisibilityReasonCode,
} from '@critical-css/shared'

interface ClipRect {
  left: number
  right: number
  top: number
  bottom: number
}

const INFINITE_CLIP: ClipRect = {
  left: Number.NEGATIVE_INFINITY,
  right: Number.POSITIVE_INFINITY,
  top: Number.NEGATIVE_INFINITY,
  bottom: Number.POSITIVE_INFINITY,
}

const CLIPPING_OVERFLOW = new Set(['hidden', 'scroll', 'auto', 'clip'])

function isClippingContainer(node: DOMSnapshotNode): boolean {
  if (node.isDisplayContents) return false // no box → cannot clip (201)
  const styles = node.computedStyles
  const contain = styles['contain'] ?? ''
  return (
    CLIPPING_OVERFLOW.has(styles['overflow-x'] ?? '') ||
    CLIPPING_OVERFLOW.has(styles['overflow-y'] ?? '') ||
    contain.includes('paint') ||
    contain.includes('layout') ||
    contain === 'strict' ||
    contain === 'content'
  )
}

/** 206: ancestors establishing a containing block for position:fixed. */
function establishesContainingBlockForFixed(node: DOMSnapshotNode): boolean {
  const s = node.computedStyles
  const willChange = s['will-change'] ?? ''
  return (
    (s['transform'] ?? 'none') !== 'none' ||
    (s['perspective'] ?? 'none') !== 'none' ||
    (s['filter'] ?? 'none') !== 'none' ||
    (s['backdrop-filter'] ?? 'none') !== 'none' ||
    willChange.includes('transform') ||
    willChange.includes('perspective') ||
    willChange.includes('filter') ||
    ['layout', 'paint', 'strict', 'content'].some((v) => (s['contain'] ?? '').includes(v))
  )
}

function hasActiveStickyOffset(node: DOMSnapshotNode): boolean {
  return ['top', 'right', 'bottom', 'left'].some(
    (side) => (node.computedStyles[side] ?? 'auto') !== 'auto',
  )
}

interface FoldOverlap {
  intersects: boolean
  overlapFraction: number
}

/** 202 §testFoldIntersection: 1-D vertical halfplane, half-open interval. */
function testFoldIntersection(
  node: DOMSnapshotNode,
  foldPx: number,
  config: VisibilityConfig,
): FoldOverlap {
  const { y, height } = node.boundingRect
  const effectiveFoldPx = foldPx + config.foldMarginPx
  if (height <= 0) return { intersects: false, overlapFraction: 0 }
  const overlapStart = Math.max(y, 0)
  const overlapEnd = Math.min(y + height, effectiveFoldPx)
  const overlapPx = Math.max(0, overlapEnd - overlapStart)
  const overlapFraction = overlapPx / height
  return {
    intersects: overlapFraction >= config.visibilityThreshold - 1e-6 && overlapPx > 0,
    overlapFraction,
  }
}

function intersectClip(a: ClipRect, b: ClipRect): ClipRect {
  return {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

export function classifyVisibility(
  snapshot: DOMSnapshotResult,
  snapshotId: string,
  config: VisibilityConfig = DEFAULT_VISIBILITY_CONFIG,
): VisibilityAnnotatedNodeSet {
  const byId = new Map(snapshot.nodes.map((n) => [n.nodeId, n]))

  // 203 tree-DP: effective clip rect per node, accumulated by INTERSECTION
  // (never nearest-wins). Walk order is DFS — parents always precede children.
  const clipOf = new Map<number, ClipRect>()
  const nearestClipperOf = new Map<number, number | null>()
  for (const node of snapshot.nodes) {
    if (node.parentNodeId === null) {
      clipOf.set(node.nodeId, INFINITE_CLIP)
      nearestClipperOf.set(node.nodeId, null)
      continue
    }
    // position:fixed escapes ancestor overflow clips (206): its containing
    // block is the viewport, so it — and its subtree — restarts the DP.
    if (node.computedStyles['position'] === 'fixed') {
      clipOf.set(node.nodeId, INFINITE_CLIP)
      nearestClipperOf.set(node.nodeId, null)
      continue
    }
    const parent = byId.get(node.parentNodeId)
    let clip = clipOf.get(node.parentNodeId) ?? INFINITE_CLIP
    let nearest = nearestClipperOf.get(node.parentNodeId) ?? null
    if (parent !== undefined && isClippingContainer(parent)) {
      const box = parent.boundingRect
      const styles = parent.computedStyles
      const contain = styles['contain'] ?? ''
      // contain: paint/layout clips BOTH axes (padding-box approximated by
      // border-box, conservative); overflow-x/-y clip their own axis only.
      const containClips =
        contain.includes('paint') || contain.includes('layout') || contain === 'strict' || contain === 'content'
      const clipsX = CLIPPING_OVERFLOW.has(styles['overflow-x'] ?? '') || containClips
      const clipsY = CLIPPING_OVERFLOW.has(styles['overflow-y'] ?? '') || containClips
      // Axis-independent clamping (203): overflow-x clips X only, etc.
      clip = intersectClip(clip, {
        left: clipsX ? box.x : Number.NEGATIVE_INFINITY,
        right: clipsX ? box.x + box.width : Number.POSITIVE_INFINITY,
        top: clipsY ? box.y : Number.NEGATIVE_INFINITY,
        bottom: clipsY ? box.y + box.height : Number.POSITIVE_INFINITY,
      })
      nearest = parent.nodeId
    }
    clipOf.set(node.nodeId, clip)
    nearestClipperOf.set(node.nodeId, nearest)
  }

  // 206: fixed elements are viewport-relative only when no ancestor
  // establishes a containing block for them.
  const fixedIsViewportRelative = (node: DOMSnapshotNode): boolean => {
    let parentId = node.parentNodeId
    while (parentId !== null) {
      const parent = byId.get(parentId)
      if (parent === undefined) break
      if (establishesContainingBlockForFixed(parent)) return false
      parentId = parent.parentNodeId
    }
    return true
  }

  const annotations: VisibilityAnnotation[] = []
  const annotate = (
    node: DOMSnapshotNode,
    isVisible: boolean,
    reason: VisibilityReasonCode,
    overlapFraction: number,
    contributingAncestorNodeId: number | null = null,
  ): void => {
    annotations.push({ nodeId: node.nodeId, isVisible, reason, contributingAncestorNodeId, overlapFraction })
  }

  for (const node of snapshot.nodes) {
    const styles = node.computedStyles
    const rect = node.boundingRect

    if (styles['display'] === 'none') {
      annotate(node, false, 'DISPLAY_NONE', 0)
      continue
    }
    // display:contents carries no box of its own (201) — conservatively
    // visible; its rendered children are classified independently.
    if (node.isDisplayContents) {
      annotate(node, true, 'VISIBLE', 0)
      continue
    }
    if (rect.width === 0 && rect.height === 0) {
      annotate(node, false, 'ZERO_DIMENSIONS', 0)
      continue
    }
    if (
      config.honorVisibilityHidden &&
      (styles['visibility'] === 'hidden' || styles['visibility'] === 'collapse')
    ) {
      annotate(node, false, 'VISIBILITY_HIDDEN', 0)
      continue
    }
    const opacity = Number(styles['opacity'])
    const opacityValue = Number.isFinite(opacity) ? opacity : 0
    if (
      (config.opacityMode === 'treatZeroAsHidden' && opacityValue <= 0) ||
      (config.opacityMode === 'treatBelowThresholdAsHidden' && opacityValue < config.opacityThreshold)
    ) {
      annotate(node, false, 'OPACITY_HIDDEN', 0)
      continue
    }

    // 206: viewport-relative fixed elements are scroll-invariant — effectively
    // above-fold for the whole session (REQ-109).
    if (styles['position'] === 'fixed' && config.fixedTreatment === 'always-critical') {
      if (fixedIsViewportRelative(node)) {
        annotate(node, true, 'VISIBLE', 1)
        continue
      }
      // Not viewport-relative: behaves like absolute — ordinary path below.
    }
    // 205: sticky with an active offset against the document viewport (REQ-109).
    if (
      styles['position'] === 'sticky' &&
      config.stickyPolicy === 'always-critical' &&
      hasActiveStickyOffset(node)
    ) {
      annotate(node, true, 'VISIBLE', 1)
      continue
    }

    const overlap = testFoldIntersection(node, snapshot.foldPx, config)

    // 204: getBoundingClientRect is already post-transform — offscreen-via-
    // transform exclusion is opt-in (REQ-103 "Could").
    if (
      config.ignoreTransformedOffscreen &&
      (styles['transform'] ?? 'none') !== 'none' &&
      !overlap.intersects
    ) {
      annotate(node, false, 'TRANSFORMED_OFFSCREEN', overlap.overlapFraction)
      continue
    }

    if (!overlap.intersects) {
      annotate(node, false, 'BELOW_FOLD', overlap.overlapFraction)
      continue
    }

    // 203: clipped by accumulated ancestor overflow?
    const clip = clipOf.get(node.nodeId) ?? INFINITE_CLIP
    const clippedOut =
      rect.x + rect.width <= clip.left ||
      rect.x >= clip.right ||
      rect.y + rect.height <= clip.top ||
      rect.y >= clip.bottom
    if (clippedOut) {
      annotate(node, false, 'CLIPPED_BY_ANCESTOR', overlap.overlapFraction, nearestClipperOf.get(node.nodeId) ?? null)
      continue
    }

    annotate(node, true, 'VISIBLE', overlap.overlapFraction)
  }

  return { snapshotId, annotations }
}

/**
 * The node set the Selector Matcher probes: visible nodes PLUS hidden nodes
 * whose (collapsed) position sits above the fold — their hiding rules
 * (`display:none`, `visibility:hidden`) are rendering-parity-critical: omit
 * them and the element flashes visible until the full CSS arrives (REQ-501).
 */
export function matchableNodeIds(
  snapshot: DOMSnapshotResult,
  annotated: VisibilityAnnotatedNodeSet,
  config: VisibilityConfig = DEFAULT_VISIBILITY_CONFIG,
): Set<number> {
  const byId = new Map(snapshot.nodes.map((n) => [n.nodeId, n]))
  // Same effective fold as the classification pass (202) — a divergent
  // boundary here reintroduces the flash-of-hidden-content REQ-501 forbids.
  const effectiveFoldPx = snapshot.foldPx + config.foldMarginPx
  const ids = new Set<number>()
  for (const annotation of annotated.annotations) {
    if (annotation.isVisible) {
      ids.add(annotation.nodeId)
      continue
    }
    if (
      annotation.reason === 'DISPLAY_NONE' ||
      annotation.reason === 'VISIBILITY_HIDDEN' ||
      annotation.reason === 'OPACITY_HIDDEN'
    ) {
      const node = byId.get(annotation.nodeId)
      if (node !== undefined && node.boundingRect.y < effectiveFoldPx) {
        ids.add(annotation.nodeId)
      }
    }
  }
  return ids
}
