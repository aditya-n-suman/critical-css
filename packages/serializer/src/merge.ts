/**
 * Multi-viewport merge (docs/architecture/016-Data-Flow.md §10.1,
 * docs/design/602-Deduplication.md §8.6).
 *
 * Combines N independent per-viewport rule sets into one
 * MergedMultiViewportRuleSet. Rule identity is `(stylesheetIndex,
 * ruleIndexPath)` (602 §8.1 canonicalId); a rule matched in a strict subset
 * of profiles with no intrinsic media condition gets a synthetic width-band
 * `@media` wrapper (602 §8.6.2). Determinism: input branches are sorted by
 * viewportProfileId so behavior never depends on completion order.
 *
 * Single-viewport invariant: with one configured profile every rule's
 * matchedIn equals the full profile set → emitted unconditionally with only
 * its intrinsic chain → byte-identical to the single-viewport path.
 */

import type { AtRuleCondition, DependencyNode } from '@critical-css/shared'
import type { MergedMultiViewportRuleSet, MergedRule } from './types.js'

/** A configured viewport profile's identity + width, for band derivation. */
export interface ViewportBand {
  readonly viewportProfileId: string
  readonly width: number
}

export interface PerViewportRuleSet {
  readonly viewportProfileId: string
  readonly rules: readonly MergedRule[]
  readonly dependencyManifest: readonly DependencyNode[]
  readonly layerDeclarationOrder: readonly string[]
}

const identityKey = (rule: MergedRule): string => `${rule.stylesheetIndex}:${rule.ruleIndex.join('.')}`

const hasIntrinsicMedia = (rule: MergedRule): boolean => rule.atRuleChain.some((c) => c.kind === 'media')

/**
 * Synthetic width-band condition for a CONTIGUOUS subset of profiles
 * (602 §8.6.2). Bands partition the width axis at profile widths: the
 * smallest profile covers `(max-width: <next-1>)`, the largest
 * `(min-width: <own>)`, middles a bounded range. Breakpoints derive from
 * profile widths (105), not hardcoded.
 *
 * A NON-contiguous subset (e.g. mobile + desktop but not tablet) cannot be
 * expressed as a single min/max range; a single-range band would wrongly
 * re-include the skipped middle viewport. Returns `''` in that case — the
 * caller then emits the rule unconditionally, which is the fidelity-safe and
 * honest choice (include everywhere rather than band it wrong).
 */
export function synthesizeBand(matchedIn: ReadonlySet<string>, bands: readonly ViewportBand[]): string {
  const sorted = [...bands].sort((a, b) => a.width - b.width)
  const matchedIdx = sorted
    .map((b, i) => (matchedIn.has(b.viewportProfileId) ? i : -1))
    .filter((i) => i >= 0)
  if (matchedIdx.length === 0) return ''
  const minIdx = matchedIdx[0] as number
  const maxIdx = matchedIdx[matchedIdx.length - 1] as number
  // Contiguity: every profile between min and max must be matched.
  if (maxIdx - minIdx + 1 !== matchedIdx.length) return ''

  const parts: string[] = []
  if (minIdx > 0) parts.push(`(min-width: ${sorted[minIdx]?.width}px)`)
  if (maxIdx < sorted.length - 1) parts.push(`(max-width: ${(sorted[maxIdx + 1]?.width ?? 1) - 1}px)`)
  return parts.join(' and ')
}

interface Accumulator {
  rule: MergedRule
  matchedIn: Set<string>
}

export function mergeViewports(
  sets: readonly PerViewportRuleSet[],
  bands: readonly ViewportBand[],
): MergedMultiViewportRuleSet {
  // Step 0 — sort branches by profile identity for order-independence.
  const sortedSets = [...sets].sort((a, b) =>
    a.viewportProfileId < b.viewportProfileId ? -1 : a.viewportProfileId > b.viewportProfileId ? 1 : 0,
  )
  const allProfileIds = new Set(bands.map((b) => b.viewportProfileId))

  // Reference-dedup by canonicalId, unioning matchedIn (insertion order = first seen).
  const byIdentity = new Map<string, Accumulator>()
  for (const set of sortedSets) {
    for (const rule of set.rules) {
      const key = identityKey(rule)
      const existing = byIdentity.get(key)
      if (existing === undefined) {
        byIdentity.set(key, { rule, matchedIn: new Set([set.viewportProfileId]) })
      } else {
        existing.matchedIn.add(set.viewportProfileId)
      }
    }
  }

  const merged: MergedRule[] = []
  for (const { rule, matchedIn } of byIdentity.values()) {
    const contributingViewports = [...matchedIn].sort()
    let atRuleChain: readonly AtRuleCondition[] = rule.atRuleChain
    const matchedAll = matchedIn.size === allProfileIds.size
    if (!matchedAll && !hasIntrinsicMedia(rule)) {
      // Subset match, no intrinsic media → restrict to the profiles' band.
      const band = synthesizeBand(matchedIn, bands)
      if (band.length > 0) {
        atRuleChain = [{ kind: 'media', conditionText: band }, ...rule.atRuleChain]
      }
    }
    merged.push({ ...rule, atRuleChain, contributingViewports })
  }

  // Dependency manifest union by id — emitted once, unconditionally, by the
  // serializer, so the unconditional-consumer invariant (602 §8.6.4) holds
  // by construction (deps are never wrapped).
  const depsById = new Map<string, DependencyNode>()
  for (const set of sortedSets) {
    for (const dep of set.dependencyManifest) {
      if (!depsById.has(dep.id)) depsById.set(dep.id, dep)
    }
  }
  const dependencyManifest = [...depsById.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Layer declaration order: union preserving first occurrence across branches.
  const layerOrder: string[] = []
  const seenLayers = new Set<string>()
  for (const set of sortedSets) {
    for (const name of set.layerDeclarationOrder) {
      if (!seenLayers.has(name)) {
        seenLayers.add(name)
        layerOrder.push(name)
      }
    }
  }

  return { rules: merged, dependencyManifest, layerDeclarationOrder: layerOrder }
}
