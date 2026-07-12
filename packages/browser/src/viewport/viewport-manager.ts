/**
 * ViewportManager — device-profile definition, application, and fold
 * computation (docs/design/105-Viewport-Manager.md, BI-02.4).
 */

import type { ViewportProfile } from '@critical-css/shared'
import { getRaw } from '../internal/raw.js'
import type { PageHandle } from '../types/page-handle.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const TABLET_UA =
  'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

/** Built-in profiles, per docs/design/105-Viewport-Manager.md §8.1 (design authority). */
export const BUILT_IN_PROFILES: Readonly<Record<'desktop' | 'tablet' | 'mobile', ViewportProfile>> = {
  desktop: {
    name: 'desktop',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: null,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    foldOffset: null,
  },
  tablet: {
    name: 'tablet',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: TABLET_UA,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    foldOffset: null,
  },
  mobile: {
    name: 'mobile',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    foldOffset: null,
  },
}

export class ViewportManager {
  /** The default profile is desktop (AGENT_IMPL_BRIEF). */
  defaultProfile(): ViewportProfile {
    return BUILT_IN_PROFILES.desktop
  }

  builtInProfile(name: 'desktop' | 'tablet' | 'mobile'): ViewportProfile {
    return BUILT_IN_PROFILES[name]
  }

  /**
   * Apply a profile to a live page.
   *
   * Per 105 §8.2, emulation splits into context-creation-time settings and
   * page-mutable settings. Context-time settings (isMobile/hasTouch/
   * deviceScaleFactor) are fully honored when the context is created via
   * `BrowserManager.acquire(profile)`. On an already-open page this method
   * applies everything that is page-mutable or CDP-overridable:
   *  - viewport size (`page.setViewportSize`, always — idempotent, 105 §8.2)
   *  - emulated media features (`page.emulateMedia` — real browser-level
   *    emulation, never a JS shim, per Principle 1)
   *  - user agent, via a CDP `Emulation.setUserAgentOverride` on Chromium.
   */
  async applyProfile(handle: PageHandle, profile: ViewportProfile): Promise<void> {
    const raw = getRaw(handle)
    await raw.page.setViewportSize({ width: profile.width, height: profile.height })
    await raw.page.emulateMedia({
      colorScheme: profile.colorScheme,
      reducedMotion: profile.reducedMotion,
      forcedColors: profile.forcedColors === 'active' ? 'active' : 'none',
    })
    if (profile.userAgent !== null && raw.engine === 'chromium') {
      const session = await raw.context.newCDPSession(raw.page)
      try {
        await session.send('Emulation.setUserAgentOverride', { userAgent: profile.userAgent })
      } finally {
        await session.detach().catch(() => undefined)
      }
    }
    raw.appliedProfile = profile
  }
}
