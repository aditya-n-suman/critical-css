import { describe, expect, it } from 'vitest'

import { correlateCascades, type CascadeMissRecord } from '../src/index.js'

const TOKENS = 'https://example.com/tokens.css'
const OTHER = 'https://example.com/other.css'

function miss(
  fingerprint: string,
  workItem: string,
  assetHashes: readonly { url: string; hash: string }[],
): CascadeMissRecord {
  return { fingerprint, workItem, assetHashes }
}

const prior = new Map([
  [TOKENS, 'tokens-v1'],
  [OTHER, 'other-v1'],
])

describe('correlateCascades (805 §8.5/§10.3)', () => {
  it('groups N misses sharing one changed asset into a single cascade event', () => {
    const misses = [
      miss('f1', '/blog/a', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f2', '/blog/b', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f3', '/products', [
        { url: TOKENS, hash: 'tokens-v2' },
        { url: OTHER, hash: 'other-v1' }, // unchanged sibling asset
      ]),
    ]
    const result = correlateCascades(misses, prior)
    expect(result.cascades).toHaveLength(1)
    expect(result.cascades[0]).toEqual({
      assetCanonicalUrl: TOKENS,
      affectedFingerprints: ['f1', 'f2', 'f3'],
      affectedWorkItems: ['/blog/a', '/blog/b', '/products'],
    })
    expect(result.residualMisses).toHaveLength(0)
  })

  it('an unrelated miss is reported individually, not folded into the cascade', () => {
    const misses = [
      miss('f1', '/blog/a', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f2', '/blog/b', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f9', '/contact', [{ url: OTHER, hash: 'other-v2' }]), // its own change
    ]
    const result = correlateCascades(misses, prior)
    expect(result.cascades).toHaveLength(1)
    expect(result.cascades[0]?.assetCanonicalUrl).toBe(TOKENS)
    expect(result.residualMisses.map((m) => m.fingerprint)).toEqual(['f9'])
  })

  it('a miss with TWO changed assets forms its own group, never merged (805 §12)', () => {
    const misses = [
      miss('f1', '/a', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f2', '/b', [{ url: TOKENS, hash: 'tokens-v2' }]),
      miss('f3', '/both', [
        { url: TOKENS, hash: 'tokens-v2' },
        { url: OTHER, hash: 'other-v2' },
      ]),
    ]
    const result = correlateCascades(misses, prior)
    expect(result.cascades).toHaveLength(1)
    expect(result.cascades[0]?.affectedFingerprints).toEqual(['f1', 'f2'])
    expect(result.residualMisses.map((m) => m.fingerprint)).toEqual(['f3'])
  })

  it('group size exactly at the threshold is NOT a cascade (strict >)', () => {
    const misses = [miss('f1', '/a', [{ url: TOKENS, hash: 'tokens-v2' }])]
    const result = correlateCascades(misses, prior, { cascadeThreshold: 1 })
    expect(result.cascades).toHaveLength(0)
    expect(result.residualMisses).toHaveLength(1)
  })

  it('degrades gracefully with no prior asset hashes (first build)', () => {
    const misses = [
      miss('f1', '/a', [{ url: TOKENS, hash: 'tokens-v1' }]),
      miss('f2', '/b', [{ url: TOKENS, hash: 'tokens-v1' }]),
    ]
    // Empty prior map: every asset appears "changed" (unknown), but the
    // grouping still functions; here both misses share one "changed" asset,
    // so they group — verify no throw and a coherent partition.
    const result = correlateCascades(misses, new Map())
    expect(result.cascades.length + result.residualMisses.length).toBeGreaterThan(0)
    const reported =
      result.residualMisses.length +
      result.cascades.reduce((n, c) => n + c.affectedFingerprints.length, 0)
    expect(reported).toBe(2)
  })
})
