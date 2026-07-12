/**
 * DOM snapshot DTOs, per docs/design/106-DOM-Snapshot.md §8.2 (M0 scope:
 * above-fold element records; the full fragment-linked walk lands with
 * packages/collector in M1).
 */

export interface BoundingRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DOMSnapshotNode {
  /** Stable within-snapshot id, assigned by walk order (106 §8.2). */
  readonly nodeId: number
  readonly parentNodeId: number | null
  /** Uppercased, per DOM spec convention. */
  readonly tagName: string
  readonly classList: readonly string[]
  readonly attributes: Readonly<Record<string, string>>
  /** Rounded to 2 decimal places at capture time (determinism epsilon, 106 §8.2). */
  readonly boundingRect: BoundingRect
  /** Naive computed-style visibility flag; the Visibility Engine (200) is authoritative. */
  readonly visible: boolean
  /** `display: contents` marker — box carries no positional info (201 §11). */
  readonly isDisplayContents: boolean
  /** Fixed allow-list of visibility-relevant computed styles (106 §8.2 + 203/205/206). */
  readonly computedStyles: Readonly<Record<string, string>>
}

export interface DOMSnapshotResult {
  /** The fold cutoff used, in CSS px (`ViewportProfile.foldOffset` ?? `window.innerHeight`). */
  readonly foldPx: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  /** Scroll offsets at capture instant (201 §11). */
  readonly scrollX: number
  readonly scrollY: number
  readonly capturedUrl: string
  /** ALL reachable element records, in document walk order (106 §8.6 eager whole-tree). */
  readonly nodes: readonly DOMSnapshotNode[]
}
