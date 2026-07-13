/**
 * Fingerprint-input collection WITHOUT a browser launch
 * (docs/design/801-Fingerprinting.md §8.1, docs/design/800-Cache-Overview.md
 * §9.1, docs/design/704-Incremental-Extraction.md §14).
 *
 * 801 mandates content-based fingerprinting (HTML content + every referenced
 * CSS asset's content), and 801 §8.4 notes the hashing cost is "dominated by
 * the same O(m) we would pay to READ the inputs" — i.e. the docs anticipate
 * reading the inputs on every run; what a cache hit skips is the *browser
 * extraction* (REQ-301), not the input read. This module reads those inputs
 * over plain HTTP/file I/O so the hit path provably never launches Chromium.
 *
 * Known approximation (recorded, not hidden — Principle 6): asset discovery
 * here is a lightweight scan of `<link rel="stylesheet">` tags plus a
 * recursive `@import` scan of fetched CSS. The in-browser Stylesheet Loader
 * (301) additionally sees JS-injected stylesheets, which this scan cannot.
 * A page whose only CSS change is inside a JS-injected sheet would therefore
 * produce an unchanged fingerprint (a false hit). Any fetch/scan failure
 * fails CLOSED: the caller must bypass the cache for that work unit and
 * extract fresh (704 §8.4 guardrail 1 — never skip on an unproven
 * fingerprint).
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { CssAssetFingerprint } from '@critical-css/shared'

/** Thrown when fingerprint inputs cannot be read — callers bypass the cache. */
export class InputCollectionError extends Error {}

export interface CollectedInputs {
  readonly htmlContent: string
  readonly cssAssets: readonly CssAssetFingerprint[]
}

export type TextFetcher = (url: string) => Promise<string>

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** Fetch a text resource over file:// or http(s):// — no browser involved. */
export async function fetchText(url: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new InputCollectionError(`not an absolute URL: ${url}`)
  }
  if (parsed.protocol === 'file:') {
    try {
      return await readFile(fileURLToPath(parsed), 'utf8')
    } catch (err) {
      throw new InputCollectionError(
        `could not read ${url} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    let response: Response
    try {
      response = await fetch(url)
    } catch (err) {
      throw new InputCollectionError(
        `could not fetch ${url} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
    if (!response.ok) {
      throw new InputCollectionError(`could not fetch ${url} (HTTP ${response.status})`)
    }
    return response.text()
  }
  throw new InputCollectionError(`unsupported protocol for fingerprint input: ${url}`)
}

/**
 * Effective document base URL: the FIRST `<base href>` in the document (per
 * the HTML spec only the first `base` element with an `href` is honored),
 * resolved against the page URL; falls back to the page URL itself. Browsers
 * resolve `<link href>` and inline `@import` targets against this, so the
 * fingerprint scan must too — otherwise a page using `<base href="assets/">`
 * would hash the wrong stylesheet and serve stale CSS on a false hit.
 * Conservative simplification (matching well-formed pages): the first base
 * applies to ALL relative hrefs, not only those appearing after it.
 */
export function baseHrefOf(html: string, pageUrl: string): string {
  for (const tag of html.match(/<base\b[^>]*>/gi) ?? []) {
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const hrefValue = href?.[2] ?? href?.[3] ?? href?.[4]
    if (hrefValue === undefined || hrefValue === '') continue
    try {
      return new URL(hrefValue, pageUrl).href
    } catch {
      // Unresolvable base href: browsers fall back to the document URL.
      return pageUrl
    }
  }
  return pageUrl
}

/**
 * Scan HTML for `<link rel="stylesheet" href="…">` references. Attribute
 * order-insensitive; hrefs resolved against the document base URL (first
 * `<base href>`, else the page URL) — matching browser resolution. This is
 * an HTML attribute scan, not a CSS parser — ADR-0002 (no custom CSS
 * *selector* parser) is not implicated.
 */
export function stylesheetLinksOf(html: string, pageUrl: string): string[] {
  const documentBase = baseHrefOf(html, pageUrl)
  const urls: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const relValue = (rel?.[2] ?? rel?.[3] ?? rel?.[4] ?? '').toLowerCase()
    if (!relValue.split(/\s+/).includes('stylesheet')) continue
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const hrefValue = href?.[2] ?? href?.[3] ?? href?.[4]
    if (hrefValue === undefined || hrefValue === '') continue
    try {
      urls.push(new URL(hrefValue, documentBase).href)
    } catch {
      // Unresolvable href: the browser would also fail to load it; skip.
    }
  }
  return urls
}

/**
 * `@import` targets inside inline `<style>` blocks, resolved against the
 * document base URL (first `<base href>`, else the page URL) — the same
 * resolution a browser applies to inline-style imports.
 */
export function inlineStyleImportsOf(html: string, pageUrl: string): string[] {
  const documentBase = baseHrefOf(html, pageUrl)
  const urls: string[] = []
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    urls.push(...importUrlsOf(match[1] ?? '', documentBase))
  }
  return urls
}

/** `@import` targets referenced by a stylesheet (306 recursion, scan level). */
export function importUrlsOf(css: string, sheetUrl: string): string[] {
  const urls: string[] = []
  const pattern = /@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const target = match[1]
    if (target === undefined || target === '') continue
    try {
      urls.push(new URL(target, sheetUrl).href)
    } catch {
      // Unresolvable import target; skip (the browser would fail it too).
    }
  }
  return urls
}

const MAX_IMPORT_DEPTH = 8

/**
 * Read the fingerprint inputs for a page: its HTML plus the content hash of
 * every stylesheet it references (link tags + inline-`<style>` `@import`s +
 * recursive `@import`, cycle-guarded). Throws `InputCollectionError` on any
 * unreadable input OR on an `@import` chain deeper than `MAX_IMPORT_DEPTH` —
 * fail closed, never fingerprint a partial input set (silently dropping the
 * deep tail would be a false-hit vector).
 */
export async function collectFingerprintInputs(
  pageUrl: string,
  fetcher: TextFetcher = fetchText,
): Promise<CollectedInputs> {
  const htmlContent = await fetcher(pageUrl)
  const cssAssets: CssAssetFingerprint[] = []
  const visited = new Set<string>()

  const visit = async (sheetUrl: string, depth: number): Promise<void> => {
    if (visited.has(sheetUrl)) return
    if (depth > MAX_IMPORT_DEPTH) {
      throw new InputCollectionError(
        `@import chain exceeds depth ${MAX_IMPORT_DEPTH} at ${sheetUrl} — refusing to fingerprint a partial input set`,
      )
    }
    visited.add(sheetUrl)
    const content = await fetcher(sheetUrl)
    cssAssets.push({ url: sheetUrl, contentHash: sha256(content) })
    for (const imported of importUrlsOf(content, sheetUrl)) {
      await visit(imported, depth + 1)
    }
  }

  for (const linked of stylesheetLinksOf(htmlContent, pageUrl)) {
    await visit(linked, 0)
  }
  for (const inlineImported of inlineStyleImportsOf(htmlContent, pageUrl)) {
    await visit(inlineImported, 0)
  }
  return { htmlContent, cssAssets }
}
