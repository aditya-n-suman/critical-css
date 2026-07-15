/**
 * Shared safety helper for embedding CSS text (selector text, or a whole
 * critical-CSS payload) verbatim inside an inline `<style>` block that this
 * app then serializes into an `iframe[srcdoc]` HTML document.
 *
 * The CSS text this app handles (`ReportBundle.matchedSelectors[].selectorText`
 * and a run's serialized critical CSS) is attacker-influenced whenever the
 * tool is pointed at a third-party page — which is this tool's actual use
 * case. A real CSSOM can produce a `selectorText` like
 * `[data-x="</STYLE><script>alert(1)</script>"]` verbatim from a page's own,
 * genuinely valid stylesheet rule; a serializer that faithfully reproduces
 * page CSS can carry the same kind of string through in a critical-CSS
 * payload. Neither is a hypothetical edge case for this tool.
 *
 * See `escapeCssLessThan`'s doc comment for why escaping every literal `<`
 * (rather than blocklisting the substring `</style`) is the correct, complete
 * fix for this specific injection: a `<style>` element's HTML "raw text"
 * content model only ever terminates on a literal `<` byte.
 */

/**
 * Escapes every literal `<` character as a CSS hex escape (`\3C `), so the
 * character never appears verbatim in the `<style>` block this string is
 * embedded in.
 *
 * Why this (and not a `</style` substring blocklist): a `<style>` element has
 * the HTML "raw text" content model. Per the HTML parsing spec, the
 * tokenizer ends a raw-text element at the first *case-insensitive* `</` +
 * tag-name sequence it finds by scanning for a literal `<` byte — it has no
 * notion of CSS syntax, CSS comments, or CSS string escaping while doing
 * this. A blocklist on the substring `</style` is provably incomplete (an
 * unbounded set of casing/whitespace variants could still slip through) and
 * is fundamentally the wrong tool for a parsing rule that triggers on a
 * single character, not a fixed string.
 *
 * Removing every literal `<` is complete and sufficient: the tokenizer can
 * only begin end-tag detection in raw text upon seeing a literal `<`; if none
 * remain in the text, no end tag can ever be recognized, regardless of case,
 * of what tag name follows, or of any other obfuscation. The CSS escape
 * sequence used here round-trips back to the literal `<` character once the
 * browser's CSS parser runs (after HTML parsing has already produced the
 * `<style>` element's text node), so the CSS's meaning is unchanged —
 * this is an HTML-parse-time transformation only, invisible to the CSS
 * engine's own evaluation of the selector/declarations.
 */
export function escapeCssLessThan(value: string): string {
  return value.replace(/</g, '\\3C ')
}
