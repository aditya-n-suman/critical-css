/**
 * DOMSnapshot — eager, single-round-trip whole-tree DOM capture
 * (docs/design/106-DOM-Snapshot.md §8.6: enumerate the entire reachable tree
 * in one coherent instant; the Visibility Engine classifies host-side).
 *
 * Executes entirely in-page via one evaluate() call — no DOM parsing on the
 * Node side (ADR-0001). Geometry and allow-listed computed style are read in
 * the same per-node visit as structural identity (106 §8.2).
 */

import { CCSS_ID_ATTRIBUTE, computeFold } from '@critical-css/shared'
import { getRaw } from '../internal/raw.js'
import type { DOMSnapshotNode, DOMSnapshotResult } from '../types/dom-snapshot-result.js'
import type { PageHandle } from '../types/page-handle.js'

/**
 * Fixed computed-style allow-list (106 §8.2, extended per the Visibility
 * Engine's requirements: 203 clip fields, 205 sticky offsets, 206 fixed
 * containing-block predicate fields).
 */
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
  'top',
  'right',
  'bottom',
  'left',
  'clip-path',
  'clip',
  'filter',
  'backdrop-filter',
  'perspective',
  'will-change',
] as const

interface WalkConfig {
  /** `null` = resolve to `window.innerHeight` in-page (single round trip). */
  foldPx: number | null
  styleAllowList: readonly string[]
  idAttribute: string
}

interface WalkResult {
  foldPx: number
  viewportWidth: number
  viewportHeight: number
  scrollX: number
  scrollY: number
  nodes: DOMSnapshotNode[]
}

/** Runs in-page. Single synchronous pass — one coherent instant (106 §8.6). */
function captureDomSnapshot(cfg: WalkConfig): WalkResult {
  const foldPx = cfg.foldPx ?? window.innerHeight
  const nodes: DOMSnapshotNode[] = []
  let nodeIdCounter = 0
  const round = (n: number): number => Math.round(n * 100) / 100

  // Clear every stale correlation attribute (previous captures on this page,
  // or page-authored collisions) — nodeIds are only unique within ONE capture.
  const stale = document.querySelectorAll(`[${cfg.idAttribute}]`)
  for (let i = 0; i < stale.length; i++) {
    ;(stale[i] as Element).removeAttribute(cfg.idAttribute)
  }

  const visit = (element: Element, parentNodeId: number | null): void => {
    const rect = element.getBoundingClientRect()
    const nodeId = nodeIdCounter
    nodeIdCounter += 1

    const style = getComputedStyle(element)
    const computedStyles: Record<string, string> = {}
    for (const prop of cfg.styleAllowList) {
      computedStyles[prop] = style.getPropertyValue(prop)
    }
    const attributes: Record<string, string> = {}
    const attrs = element.attributes
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i] as Attr
      // The engine-injected correlation attribute is never part of the
      // captured snapshot (it would break determinism across runs).
      if (attr.name === cfg.idAttribute) continue
      attributes[attr.name] = attr.value
    }
    // Stable node identity for later batched selector matching
    // (ADR-0001: re-resolve nodes via stable identifiers, never JSHandles).
    element.setAttribute(cfg.idAttribute, String(nodeId))

    const visible =
      computedStyles['display'] !== 'none' &&
      computedStyles['visibility'] !== 'hidden' &&
      computedStyles['visibility'] !== 'collapse' &&
      rect.width > 0 &&
      rect.height > 0
    const classList: string[] = []
    for (let i = 0; i < element.classList.length; i++) {
      classList.push(element.classList[i] as string)
    }
    nodes.push({
      nodeId,
      parentNodeId,
      tagName: element.tagName,
      classList,
      attributes,
      boundingRect: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
      },
      visible,
      // display:contents boxes carry NO positional info (201 §11) — explicit
      // marker, never inferred from box shape by consumers.
      isDisplayContents: computedStyles['display'] === 'contents',
      computedStyles,
    })

    const children = element.children
    for (let i = 0; i < children.length; i++) {
      visit(children[i] as Element, nodeId)
    }
  }

  visit(document.documentElement, null)
  return {
    foldPx,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    nodes,
  }
}

export class DOMSnapshot {
  async capture(handle: PageHandle): Promise<DOMSnapshotResult> {
    const raw = getRaw(handle)
    const profile = raw.appliedProfile
    const foldPx = profile !== null ? computeFold(profile) : null

    const result = await raw.page.evaluate(captureDomSnapshot, {
      foldPx,
      styleAllowList: STYLE_ALLOW_LIST as readonly string[],
      idAttribute: CCSS_ID_ATTRIBUTE,
    })
    return {
      foldPx: result.foldPx,
      viewportWidth: result.viewportWidth,
      viewportHeight: result.viewportHeight,
      scrollX: result.scrollX,
      scrollY: result.scrollY,
      capturedUrl: raw.page.url(),
      nodes: result.nodes,
    }
  }
}
