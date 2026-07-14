/**
 * Dual-render setup (docs/design/703-Visual-Diff.md §8.1, §8.2, §11).
 *
 * Produces the two screenshots the pixel diff compares:
 *  - Reference render (R_full): the page with its original CSS intact.
 *  - Candidate render (R_crit): the same page with the original CSS stripped
 *    and the extracted critical CSS inlined in a <head> <style>, exactly as
 *    the SSR adapter would inject it (703 §11).
 *
 * Controlled-variable discipline (703 §8.2): both renders navigate the same
 * URL through the same NavigationEngine at the same DeviceProfile, both have
 * the identical determinism layer applied (animations/transitions frozen,
 * caret hidden, scrollbar gutter stabilized, dynamic regions stubbed), and
 * both screenshot only after stabilization (network idle + fonts.ready + no
 * pending layout) reports settled. The *only* independent variable is the
 * stylesheet set. Everything crosses the boundary through `PageHandle`
 * (evaluate/screenshot) — raw Playwright never leaks (ADR-0003).
 */

import type { PageHandle } from '@critical-css/browser'
import { computeFold, type ViewportProfile } from '@critical-css/shared'

export interface RenderOptions {
  /**
   * Selectors whose regions are inherently nondeterministic (ads, clocks).
   * Painted as opaque blocks in BOTH renders identically (703 §8.5), so they
   * cannot hide a real CSS difference — they only remove a shared confound.
   */
  readonly stubSelectors?: readonly string[]
}

/** Applied identically to R_full and R_crit — a shared, non-semantic freeze. */
function installDeterminismLayer(payload: { stubSelectors: readonly string[] }): void {
  const existing = document.getElementById('__ccss_freeze')
  if (existing !== null) existing.remove()
  const style = document.createElement('style')
  style.id = '__ccss_freeze'
  const stubRule =
    payload.stubSelectors.length > 0
      ? `${payload.stubSelectors.join(',')}{background:#000 !important;color:transparent !important;background-image:none !important}`
      : ''
  style.textContent =
    '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}' +
    'html{scrollbar-gutter:stable}' +
    stubRule
  // Appended last so a later critical-CSS injection cannot strip it.
  document.documentElement.appendChild(style)
}

/**
 * Strip the page's own CSS and inline the critical CSS in its place, matching
 * the production first-paint state (703 §8.1 candidate render, §11).
 */
function stripAndInlineCritical(criticalCss: string): void {
  // Disable every existing author stylesheet (covers <link> and <style>).
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      sheet.disabled = true
    } catch {
      /* cross-origin sheet: .disabled may throw — ignore, the node removal below still applies */
    }
  }
  // Remove the owner nodes so no rule can re-apply.
  const owners = document.querySelectorAll('link[rel~="stylesheet"], style:not(#__ccss_freeze):not(#__ccss_critical)')
  for (const node of Array.from(owners)) node.remove()
  const critical = document.createElement('style')
  critical.id = '__ccss_critical'
  critical.textContent = criticalCss
  document.head.appendChild(critical)
}

/** Settle after a DOM/style mutation: two RAFs + fonts.ready (703 §8.2). */
function awaitSettle(): Promise<void> {
  return new Promise<void>((resolveSettle) => {
    const done = (): void => {
      const fonts = (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts
      if (fonts !== undefined) {
        void fonts.ready.then(() => resolveSettle())
      } else {
        resolveSettle()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(done))
  })
}

function foldClip(profile: ViewportProfile): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: profile.width, height: computeFold(profile) }
}

/**
 * Reference render: navigate, freeze, screenshot the fold region. The handle
 * must already have been acquired with `profile` so viewport/DPR/media
 * emulation is context-native (703 §8.2).
 */
export async function renderReference(
  handle: PageHandle,
  url: string,
  profile: ViewportProfile,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  await handle.navigate(url)
  await handle.evaluate(installDeterminismLayer, { stubSelectors: options.stubSelectors ?? [] })
  await handle.evaluate(awaitSettle, undefined as never)
  return handle.screenshot({ clip: foldClip(profile) })
}

/**
 * Candidate render: navigate, strip the original CSS, inline the critical CSS,
 * freeze, screenshot the SAME fold region (703 §8.1 / §8.3 — same rect, so no
 * misalignment). Determinism layer is applied identically to the reference.
 */
export async function renderCandidate(
  handle: PageHandle,
  url: string,
  profile: ViewportProfile,
  criticalCss: string,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  await handle.navigate(url)
  await handle.evaluate(stripAndInlineCritical, criticalCss)
  await handle.evaluate(installDeterminismLayer, { stubSelectors: options.stubSelectors ?? [] })
  await handle.evaluate(awaitSettle, undefined as never)
  return handle.screenshot({ clip: foldClip(profile) })
}
