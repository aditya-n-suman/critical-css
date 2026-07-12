/**
 * Combined single-pass collection entry point (BI-03.6): DOM Collector and
 * CSSOM Walker run against the same stabilized page, correlated by one shared
 * `snapshotId` — peers, not consumers of each other (016 §8.4).
 */

import type { PageHandle } from '@critical-css/browser'
import { fnv1a64 } from '@critical-css/shared'
import { CssomWalker } from './cssom-walker/cssom-walker.js'
import type { CssomRuleList } from './cssom-walker/types.js'
import { DomCollector } from './dom-collector/dom-collector.js'
import type { CollectedDom } from './dom-collector/dom-collector.js'

export interface CollectionResult {
  readonly snapshotId: string
  readonly dom: CollectedDom
  readonly cssom: CssomRuleList
}

let collectionCounter = 0

/**
 * snapshotId is a correlation key only — it never reaches the deterministic
 * CSS payload (Principle 5). Derived from the page URL plus a monotonic
 * per-process counter, never wall-clock time.
 */
export function nextSnapshotId(url: string): string {
  collectionCounter += 1
  return `snap-${fnv1a64(url)}-${collectionCounter}`
}

export async function collect(handle: PageHandle): Promise<CollectionResult> {
  const snapshotId = nextSnapshotId(handle.url())
  // Independent in-page passes: the CSSOM walk reads only document.styleSheets
  // and never touches the correlation attributes the DOM capture stamps, so
  // both round trips are dispatched concurrently (each evaluate body is
  // synchronous in-page — they cannot interleave mid-walk).
  const [dom, cssom] = await Promise.all([
    new DomCollector().collect(handle, snapshotId),
    new CssomWalker().walk(handle, snapshotId),
  ])
  return { snapshotId, dom, cssom }
}
