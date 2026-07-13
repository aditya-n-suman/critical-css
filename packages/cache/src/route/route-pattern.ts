/**
 * Route pattern grammar, URL normalisation, and specificity-ordered matching
 * (docs/design/803-Route-Cache.md §8.2–8.3).
 *
 * Grammar (Express-compatible subset):
 *  - literal segments:   `/products`
 *  - named params:       `/docs/:section` (one non-empty segment)
 *  - trailing wildcard:  `/blog/*` (one-or-more trailing segments)
 *  - root:               `/`
 */

export interface RouteMatch {
  readonly pattern: string
  readonly params: Readonly<Record<string, string>>
}

/** Segment classes for positional specificity (803 §8.3). */
const CLASS_LITERAL = 3
const CLASS_PARAM = 2
const CLASS_WILDCARD = 1

interface CompiledPattern {
  readonly pattern: string
  readonly segments: readonly string[]
  readonly hasWildcard: boolean
  /** Per-position segment class, left to right (803 §8.3). */
  readonly classes: readonly number[]
}

/**
 * Injective percent-decoding (803 §12, RFC 3986 §2.3 style): decode a `%XX`
 * triplet ONLY when the decoded character is a printable ASCII character that
 * cannot be confused with URL structure — never `/` (segment separator),
 * never `%` (the escape itself), never control characters (NUL injection
 * defence), never non-ASCII bytes (multi-byte sequences stay encoded).
 * Retained triplets are uppercased for a canonical form. Because `%` is never
 * decoded, no decoded output can fabricate a triplet, so normalisation is
 * injective: distinct escaped inputs can never collapse onto one another
 * (`/a%2Fb` vs `/a%252Fb` stay distinct; `%00` never becomes a literal NUL).
 */
function decodeSegment(segment: string): string {
  return segment.replace(/%([0-9a-fA-F]{2})/g, (_triplet, hex: string) => {
    const code = Number.parseInt(hex, 16)
    const isControl = code < 0x20 || code === 0x7f
    const isNonAscii = code >= 0x80
    if (isControl || isNonAscii || code === 0x2f /* / */ || code === 0x25 /* % */) {
      return `%${hex.toUpperCase()}`
    }
    return String.fromCharCode(code)
  })
}

/**
 * Normalisation applied to both patterns and incoming URLs (803 §8.2):
 * strip query/fragment, collapse duplicate slashes, injectively decode
 * percent-encoding (see `decodeSegment`), drop trailing slash except at root.
 */
export function normalizeUrl(url: string): string {
  let path = url
  // Strip scheme://host if a full URL was passed.
  const schemeIdx = path.indexOf('://')
  if (schemeIdx !== -1) {
    const pathStart = path.indexOf('/', schemeIdx + 3)
    path = pathStart === -1 ? '/' : path.slice(pathStart)
  }
  // Strip query string and fragment.
  for (const stop of ['?', '#']) {
    const idx = path.indexOf(stop)
    if (idx !== -1) path = path.slice(0, idx)
  }
  // Collapse duplicate slashes.
  path = path.replace(/\/{2,}/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  // Injective per-segment percent-decoding (path/NUL-injection defence, 803 §12).
  path = path.split('/').map(decodeSegment).join('/')
  // Drop trailing slash except at root.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

function segmentClass(segment: string): number {
  if (segment === '*') return CLASS_WILDCARD
  if (segment.startsWith(':')) return CLASS_PARAM
  return CLASS_LITERAL
}

function compile(pattern: string): CompiledPattern {
  const normalized = normalizeUrl(pattern)
  const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
  const hasWildcard = segments[segments.length - 1] === '*'
  return { pattern, segments, hasWildcard, classes: segments.map(segmentClass) }
}

/**
 * Positional specificity comparison (803 §8.3): compare segment classes
 * left-to-right; at the FIRST differing position, literal beats `:param`
 * beats `*`. A pattern exhausted before the other (only possible via a
 * trailing wildcard) loses at that position — "longer patterns beat shorter
 * at equal class". Returns >0 when `a` is more specific.
 */
function compareSpecificity(a: CompiledPattern, b: CompiledPattern): number {
  const len = Math.max(a.classes.length, b.classes.length)
  for (let i = 0; i < len; i++) {
    const ca = a.classes[i] ?? 0
    const cb = b.classes[i] ?? 0
    if (ca !== cb) return ca - cb
  }
  return 0
}

/**
 * Structural shape of a pattern: literals verbatim, every `:param` collapses
 * to `:` (its name is irrelevant to matching). Two patterns with the same
 * shape match exactly the same URL set — an ambiguity the manifest schema
 * forbids (803 §8.3): rejected at load time.
 */
function structuralShape(compiled: CompiledPattern): string {
  return compiled.segments
    .map((seg) => (seg === '*' ? '*' : seg.startsWith(':') ? ':' : seg))
    .join('/')
}

function matchCompiled(compiled: CompiledPattern, urlSegments: readonly string[]): RouteMatch | null {
  const params: Record<string, string> = {}
  const patSegs = compiled.segments
  const lastIdx = compiled.hasWildcard ? patSegs.length - 1 : patSegs.length
  if (compiled.hasWildcard) {
    // `*` matches one-or-more trailing segments (803 §8.2).
    if (urlSegments.length < patSegs.length) return null
  } else if (urlSegments.length !== patSegs.length) {
    return null
  }
  for (let i = 0; i < lastIdx; i++) {
    const pat = patSegs[i]
    const seg = urlSegments[i]
    if (pat === undefined || seg === undefined) return null
    if (pat.startsWith(':')) {
      if (seg.length === 0) return null
      params[pat.slice(1)] = seg
    } else if (pat !== seg) {
      return null
    }
  }
  if (compiled.hasWildcard) {
    params['*'] = urlSegments.slice(lastIdx).join('/')
  }
  return { pattern: compiled.pattern, params }
}

/**
 * Specificity-ordered, first-match-wins matcher (803 §8.3). Patterns are
 * compiled once at construction; structurally identical (hence ambiguous)
 * patterns are a manifest error rejected at load.
 */
export class RoutePatternMatcher {
  private readonly compiled: readonly CompiledPattern[]

  constructor(patterns: readonly string[]) {
    const seen = new Map<string, string>()
    const compiled: CompiledPattern[] = []
    for (const pattern of patterns) {
      const c = compile(pattern)
      const shape = structuralShape(c)
      const clash = seen.get(shape)
      if (clash !== undefined) {
        throw new TypeError(
          `duplicate/ambiguous route patterns (identical match structure): ${clash} vs ${pattern}`,
        )
      }
      seen.set(shape, pattern)
      compiled.push(c)
    }
    // Descending positional specificity; deterministic (Principle 5).
    this.compiled = compiled.sort((a, b) => compareSpecificity(b, a))
  }

  /** Returns the most specific match, or `null` (caller applies fallback). */
  match(url: string): RouteMatch | null {
    const normalized = normalizeUrl(url)
    const urlSegments = normalized === '/' ? [] : normalized.slice(1).split('/')
    for (const compiled of this.compiled) {
      const match = matchCompiled(compiled, urlSegments)
      if (match !== null) return match
    }
    return null
  }
}
