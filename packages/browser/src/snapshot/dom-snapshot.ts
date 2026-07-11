/**
 * DOMSnapshot — eager, single-round-trip above-fold DOM capture
 * (docs/design/106-DOM-Snapshot.md, BI-02.5 / M0 scope).
 *
 * Executes entirely in-page via one evaluate() call — no DOM parsing on the
 * Node side (ADR-0001). Geometry and allow-listed computed style are read in
 * the same per-node visit as structural identity (106 §8.2).
 */

import { computeFold } from '@critical-css/shared'
import { getRaw } from '../internal/raw.js'
import type { DOMSnapshotNode, DOMSnapshotResult } from '../types/dom-snapshot-result.js'
import type { PageHandle } from '../types/page-handle.js'

/** Fixed computed-style allow-list (106 §8.2) — never the full declaration. */
const STYLE_ALLOW_LIST = [
  'display',
  'visibility',
  'opacity',
  'position',
  'transform',
  'overflow',
  'overflow-x',
  'overflow-y',
  'content-visibility',
  'contain',
  'z-index',
] as const

interface WalkConfig {
  foldPx: number
  styleAllowList: readonly string[]
}

interface WalkResult {
  viewportWidth: number
  viewportHeight: number
  nodes: DOMSnapshotNode[]
}

/** Runs in-page. Single synchronous pass — one coherent instant (106 §8.6). */
function captureAboveFold(cfg: WalkConfig): WalkResult {
  const nodes: DOMSnapshotNode[] = []
  let nodeIdCounter = 0
  const round = (n: number): number => Math.round(n * 100) / 100

  const visit = (element: Element, parentNodeId: number | null): void => {
    const rect = element.getBoundingClientRect()
    // Zero-rect elements (display:none collapses to 0×0 at 0,0) are captured
    // conservatively when their collapsed position is above the fold: their
    // rules can still be extraction-relevant, and completeness is the default
    // bias (Principle 3). Their `visible` flag is false.
    const zeroRect = rect.width === 0 && rect.height === 0
    const aboveFold = rect.top < cfg.foldPx && (rect.bottom > 0 || zeroRect)
    let nodeId: number | null = null

    if (aboveFold) {
      nodeId = nodeIdCounter
      nodeIdCounter += 1
      const style = getComputedStyle(element)
      const computedStyles: Record<string, string> = {}
      for (const prop of cfg.styleAllowList) {
        computedStyles[prop] = style.getPropertyValue(prop)
      }
      const attributes: Record<string, string> = {}
      for (const attr of Array.from(element.attributes)) {
        attributes[attr.name] = attr.value
      }
      const visible =
        computedStyles['display'] !== 'none' &&
        computedStyles['visibility'] !== 'hidden' &&
        computedStyles['visibility'] !== 'collapse' &&
        rect.width > 0 &&
        rect.height > 0
      nodes.push({
        nodeId,
        parentNodeId,
        tagName: element.tagName,
        classList: Array.from(element.classList),
        attributes,
        boundingRect: {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
        },
        visible,
        computedStyles,
      })
    }

    // Children are visited even when the parent is below-fold: a below-fold
    // (e.g. absolutely positioned) ancestor can still have above-fold children.
    for (const child of Array.from(element.children)) {
      visit(child, nodeId ?? parentNodeId)
    }
  }

  visit(document.documentElement, null)
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    nodes,
  }
}

export class DOMSnapshot {
  async capture(handle: PageHandle): Promise<DOMSnapshotResult> {
    const raw = getRaw(handle)
    const profile = raw.appliedProfile
    // Fold: ViewportProfile.foldOffset when set, else window.innerHeight
    // (AGENT_IMPL_BRIEF / 105 §8.3 — headless viewport height == innerHeight).
    const foldPx =
      profile !== null ? computeFold(profile) : await raw.page.evaluate(() => window.innerHeight)

    const result = await raw.page.evaluate(captureAboveFold, {
      foldPx,
      styleAllowList: STYLE_ALLOW_LIST as readonly string[],
    })
    return {
      foldPx,
      viewportWidth: result.viewportWidth,
      viewportHeight: result.viewportHeight,
      capturedUrl: raw.page.url(),
      nodes: result.nodes,
    }
  }
}
