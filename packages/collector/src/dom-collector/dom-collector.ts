/**
 * DOM Collector sub-module (BI-03.2). M1: delegates the above-fold walk to
 * `packages/browser`'s DOMSnapshot (docs/design/106) and stamps the shared
 * `snapshotId` correlation key (016 §8.4). The Visibility Engine overlay
 * (docs/design/200–207) lands in M2.
 */

import type { DOMSnapshotResult, PageHandle } from '@critical-css/browser'

export interface CollectedDom {
  readonly snapshotId: string
  readonly snapshot: DOMSnapshotResult
}

export class DomCollector {
  async collect(handle: PageHandle, snapshotId: string): Promise<CollectedDom> {
    const snapshot = await handle.captureSnapshot()
    return { snapshotId, snapshot }
  }
}
