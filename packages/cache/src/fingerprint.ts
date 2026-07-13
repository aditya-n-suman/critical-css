/**
 * Canonical cache-fingerprint computation (docs/design/801-Fingerprinting.md
 * §8.4, §8.5, §11).
 *
 * This is the authoritative implementation of the concrete fingerprint
 * algorithm (task 007): SHA-256, 64-char lowercase hex, over a
 * collision-proof canonicalization of all output-affecting inputs.
 *
 * Why here and not in `@critical-css/shared`: shared must stay free of Node
 * built-ins (it is evaluated inside browser-injected functions), but 801 §8.4
 * mandates a cryptographic hash (SHA-256 via `node:crypto`). Shared keeps the
 * DTO shapes (`CacheFingerprint`, `CacheFingerprintInput`); the computation
 * lives here. The composite pre-image is canonical JSON — every field is
 * JSON-escaped, so no input byte can act as a field delimiter (the classic
 * `("a","b:c")` vs `("a:b","c")` collision is structurally impossible).
 */

import type { CacheFingerprint, CacheFingerprintInput, CssAssetFingerprint } from '@critical-css/shared'
import { canonicalJsonStringify } from '@critical-css/shared'

import { sha256Hex } from './hash.js'

/**
 * Compute the composite fingerprint (801 §8.5). CSS assets are sorted by URL
 * so input order never affects the hash; the composite is canonical JSON so
 * variable-length fields cannot collide across field boundaries; the outer
 * hash is SHA-256 ⇒ 64-char lowercase hex (801 §11 output format).
 */
export function computeCacheFingerprint(input: CacheFingerprintInput): CacheFingerprint {
  const htmlHash = sha256Hex(input.htmlContent)
  const cssAssets: CssAssetFingerprint[] = [...input.cssAssets].sort((a, b) =>
    a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
  )
  const composite = canonicalJsonStringify({
    htmlHash,
    cssAssets: cssAssets.map((a) => ({ url: a.url, contentHash: a.contentHash })),
    viewportProfile: input.viewportProfile,
    extractionMode: input.extractionMode,
    engineVersion: input.engineVersion,
  })
  return {
    htmlHash,
    cssAssets,
    viewportProfile: input.viewportProfile,
    extractionMode: input.extractionMode,
    engineVersion: input.engineVersion,
    hash: sha256Hex(composite),
  }
}
