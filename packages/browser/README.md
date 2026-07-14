# @critical-css/browser

Browser layer (AT-02): the single seam between the engine and a real browser.
All Playwright usage is confined to this package (ADR-0003); downstream packages
see only the `PageHandle` abstraction.

## Public API

| Export | Purpose | Design authority |
|---|---|---|
| `BrowserManager` | Pool of isolated browser contexts: `acquire(profile?)` / `release(handle)` / `teardown()`, default ceiling 2, health-checked handles, shared in-flight launch, leak-free teardown | 102-Browser-Pool |
| `NavigationEngine` | `navigate(handle, url, options)` — `domcontentloaded`/`networkidle` wait + Stability Window Algorithm (RAF-gated mutation quiescence, fonts gate, readyState gate, 5s deadline). Throws `NavigationTimeoutError` on unreachable targets | 103-Navigation-Engine, 104-Rendering-Stabilization |
| `ViewportManager`, `BUILT_IN_PROFILES` | `desktop` 1920×1080 (DPR 1), `tablet` 768×1024 (DPR 2), `mobile` 375×667 (DPR 2, isMobile+touch); `applyProfile(handle, profile)`, `defaultProfile()` | 105-Viewport-Manager §8.1 |
| `DOMSnapshot` | `capture(handle)` → above-fold `DOMSnapshotResult` in one in-page `evaluate()` round trip; respects `ViewportProfile.foldOffset` (default `window.innerHeight`) | 106-DOM-Snapshot |
| `PageHandle` | Opaque page handle: `navigate() / evaluate() / applyViewport() / captureSnapshot() / startCoverage() / screenshot() / url()` — raw Playwright never escapes | 100-Browser-Abstraction |
| `PageHandle.screenshot(opts?)` | Native PNG screenshot (never a canvas read — cross-origin taint-safe, 703 §12) returning raw bytes; `clip` crops to a CSS-pixel rect, `disableAnimations` (default true) freezes CSS animations/transitions for a phase-independent capture (703 §8.1/§8.2). Consumed by `@critical-css/visual-diff` | 703-Visual-Diff |

## Notes

- Context-creation-time emulation (UA, isMobile, hasTouch, DPR, media features) is fully
  honored via `BrowserManager.acquire(profile)`. `applyViewport()` on a live page covers the
  page-mutable subset (size, emulated media) plus a CDP user-agent override on Chromium
  (105 §8.2's two-category split).
- Integration tests run against real Chromium + `fixtures/{static,async,mobile}`.
  Requires `pnpm exec playwright install chromium` once.
