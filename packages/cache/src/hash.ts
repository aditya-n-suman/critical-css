/**
 * Internal hashing helpers for packages/cache.
 *
 * Cache-internal digests (entry checksums, content hashes for dedup, route
 * key digests, merge keys) use SHA-256 per docs/design/801-Fingerprinting.md
 * §8.4. The extraction *fingerprint* itself is NOT computed here — it comes
 * from @critical-css/shared's `computeCacheFingerprint` (reused, never
 * duplicated).
 */

import { createHash } from 'node:crypto'

/** SHA-256 over a UTF-8 string; 64-char lowercase hex (801 §11 output format). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
