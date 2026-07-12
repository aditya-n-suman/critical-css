/**
 * Lexical reference extractors (docs/algorithms/501–505).
 *
 * Lexical scanning of declaration text is explicitly sanctioned (501 §8.1):
 * it identifies WHICH names to consider — never what values resolve to, and
 * never selector semantics. Over-inclusive by design: false positives are
 * safe, false negatives are correctness bugs.
 */

export interface VarReference {
  readonly propertyName: string
  readonly isFallbackBranch: boolean
}

/** 501 §10.2: depth-aware `var()` scan, including nested fallback branches. */
export function extractVarReferences(valueText: string): VarReference[] {
  const references: VarReference[] = []
  let i = 0
  for (;;) {
    const idx = valueText.indexOf('var(', i)
    if (idx === -1) break
    let depth = 1
    let cursor = idx + 4
    const nameStart = cursor
    while (cursor < valueText.length && depth > 0) {
      const ch = valueText[cursor]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) break
      } else if (ch === ',' && depth === 1) break
      cursor += 1
    }
    const propertyName = valueText.slice(nameStart, cursor).trim()
    if (propertyName.startsWith('--')) references.push({ propertyName, isFallbackBranch: false })
    if (valueText[cursor] === ',') {
      const fallbackEnd = findMatchingCloseParen(valueText, idx + 3)
      const fallbackText = valueText.slice(cursor + 1, fallbackEnd)
      for (const nested of extractVarReferences(fallbackText)) {
        references.push({ propertyName: nested.propertyName, isFallbackBranch: true })
      }
      i = fallbackEnd + 1
    } else {
      i = cursor + 1
    }
  }
  return references
}

function findMatchingCloseParen(text: string, openParenIndex: number): number {
  let depth = 0
  for (let i = openParenIndex; i < text.length; i++) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return text.length
}

/** Custom properties DECLARED by a declaration block (`--x: …;` at top level). */
export function extractCustomPropertyDeclarations(declarationText: string): string[] {
  const names: string[] = []
  // Browser-canonical cssText: declarations separated by `; `. Custom
  // property idents may contain any non-delimiter characters (spec-legal
  // non-ASCII/escaped names included) — the name char class must match
  // extractVarReferences' acceptance, or declarations go missing.
  const regex = /(?:^|[;{]\s*)(--[^\s:;{}]+)\s*:/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(declarationText)) !== null) {
    names.push(match[1] as string)
  }
  return names
}

/** Animation names referenced (502): `animation-name` longhand or `animation` shorthand. */
export function extractAnimationNames(declarationText: string, knownKeyframes: ReadonlySet<string>): string[] {
  const names = new Set<string>()
  const longhand = /animation-name\s*:\s*([^;]+)/g
  let match: RegExpExecArray | null
  while ((match = longhand.exec(declarationText)) !== null) {
    for (const raw of (match[1] as string).split(',')) {
      const name = raw.trim()
      if (name.length > 0 && name !== 'none') names.add(name)
    }
  }
  // Shorthand: conservative multi-value inclusion (502 §8.6) — any identifier
  // in the shorthand value that names a known @keyframes rule counts.
  const shorthand = /(?:^|[;{]\s*)animation\s*:\s*([^;]+)/g
  while ((match = shorthand.exec(declarationText)) !== null) {
    for (const token of (match[1] as string).split(/[\s,]+/)) {
      if (knownKeyframes.has(token)) names.add(token)
    }
  }
  return [...names]
}

/** Font families referenced (503): full fallback stack, quote-aware split. */
export function extractFontFamilies(declarationText: string): string[] {
  const families = new Set<string>()
  const regex = /font-family\s*:\s*([^;]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(declarationText)) !== null) {
    for (const raw of splitTopLevelCommas(match[1] as string)) {
      const family = raw.trim().replace(/^["']|["']$/g, '')
      if (family.length > 0) families.add(family)
    }
  }
  return [...families]
}

/**
 * Counter styles referenced (505): `counter()`/`counters()` style arguments
 * PLUS `list-style-type`/`list-style` idents — the canonical way to use a
 * custom @counter-style contains no counter() function at all.
 */
export function extractCounterStyleRefs(
  declarationText: string,
  knownCounterStyles: ReadonlySet<string>,
): string[] {
  const names = new Set<string>()
  const regex = /counters?\(\s*[^,)]+\s*(?:,\s*(?:"[^"]*"|'[^']*')\s*)?(?:,\s*([A-Za-z][A-Za-z0-9_-]*)\s*)?\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(declarationText)) !== null) {
    const style = match[1]
    if (style !== undefined && style !== 'decimal' && style !== 'none') names.add(style)
  }
  const listStyle = /list-style(?:-type)?\s*:\s*([^;]+)/g
  while ((match = listStyle.exec(declarationText)) !== null) {
    for (const token of (match[1] as string).split(/\s+/)) {
      if (knownCounterStyles.has(token)) names.add(token)
    }
  }
  return [...names]
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = []
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (quote !== null) {
      current += ch
      if (ch === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) parts.push(current)
  return parts
}
