/**
 * Purely syntactic, delimiter-based selector bookkeeping — permitted by
 * ADR-0002 (comma-splitting a selector list; stripping a trailing
 * pseudo-element token). NEVER interprets selector semantics: every match
 * decision still goes through `element.matches()`.
 */

/** Longest-first, per docs/design/402-Pseudo-Elements.md. */
const PSEUDO_ELEMENT_TOKENS = [
  '::first-letter',
  '::placeholder',
  '::first-line',
  '::selection',
  '::backdrop',
  '::marker',
  '::before',
  '::after',
  ':before',
  ':after',
] as const

/**
 * Shared quote/escape/bracket-depth scanner: walks `text` up to `end`
 * (exclusive) and reports whether that position sits at top level
 * (outside every paren/bracket/quote). Single source of truth for both
 * bookkeeping operations below.
 */
function isTopLevelAt(text: string, end: number): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < end; i++) {
    const ch = text[i] as string
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
  }
  return depth === 0 && quote === null
}

/**
 * Split a selector list on TOP-LEVEL commas only — never inside
 * `:is()`/`:where()`/`:has()` argument lists, attribute brackets, or quotes.
 */
export function splitSelectorList(selectorText: string): string[] {
  const branches: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i] as string
    if (quote !== null) {
      current += ch
      if (ch === quote && selectorText[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[') depth += 1
    if (ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      branches.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) branches.push(current.trim())
  return branches
}

export interface BaseSelectorExtraction {
  readonly baseSelector: string
  readonly pseudoElement: string | null
}

/**
 * Strip a TRAILING pseudo-element token (bracket/quote-depth guarded, so
 * `[data-x="::before"]` is untouched, and escape-guarded, so a Tailwind-style
 * class literally named `.toggle\:after` is untouched) to obtain a selector
 * that corresponds to a real host element `matches()` can evaluate (402).
 * The original selectorText is what gets serialized — decision-path only.
 */
export function extractBaseSelector(selectorText: string): BaseSelectorExtraction {
  const trimmed = selectorText.trimEnd()
  for (const token of PSEUDO_ELEMENT_TOKENS) {
    if (!trimmed.toLowerCase().endsWith(token)) continue
    const boundary = trimmed.length - token.length
    // The token's leading colon must not be escaped (`\:after` is a class
    // name character sequence, not a pseudo-element).
    if (trimmed[boundary - 1] === '\\') continue
    if (!isTopLevelAt(trimmed, boundary)) continue
    const base = trimmed.slice(0, boundary).trimEnd()
    const normalized = token.startsWith('::') ? token : `:${token}`
    return {
      // A bare pseudo-element selector (`::before`) hosts on every element.
      baseSelector: base.length > 0 ? base : '*',
      pseudoElement: normalized,
    }
  }
  return { baseSelector: trimmed, pseudoElement: null }
}

/** Dynamic/interaction pseudo-classes: `matches()` correctly reports false on
 * a non-interacted page — exclusion is by design, surfaced as a diagnostic
 * (403), never silently dropped. Detection here is lexical, diagnostics-only. */
const DYNAMIC_PSEUDO_CLASSES = [
  ':hover',
  ':active',
  ':focus-within',
  ':focus-visible',
  ':focus',
  ':visited',
  ':target-within',
]

export function containsDynamicPseudoClass(selector: string): boolean {
  const lower = selector.toLowerCase()
  for (const token of DYNAMIC_PSEUDO_CLASSES) {
    let from = 0
    for (;;) {
      const idx = lower.indexOf(token, from)
      if (idx === -1) break
      // Skip escaped-colon class-name sequences (`.lg\:hover-card`).
      if (lower[idx - 1] !== '\\') return true
      from = idx + token.length
    }
  }
  return false
}
