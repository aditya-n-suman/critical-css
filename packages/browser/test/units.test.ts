import { describe, expect, it } from 'vitest'
import { BUILT_IN_PROFILES, ViewportManager, buildLaunchArgs, DEFAULT_STABILIZATION_POLICY } from '../src/index.js'

describe('buildLaunchArgs (101 §8.8)', () => {
  it('chromium sandbox policies map to the documented args', () => {
    expect(buildLaunchArgs('chromium', 'full')).toEqual([])
    expect(buildLaunchArgs('chromium', 'ci-container')).toEqual(['--disable-dev-shm-usage'])
    expect(buildLaunchArgs('chromium', 'unsafe-no-sandbox')).toEqual(['--no-sandbox', '--disable-dev-shm-usage'])
  })

  it('non-chromium engines get no sandbox args', () => {
    expect(buildLaunchArgs('firefox', 'unsafe-no-sandbox')).toEqual([])
    expect(buildLaunchArgs('webkit', 'ci-container')).toEqual([])
  })
})

describe('ViewportManager built-in profiles (AGENT_IMPL_BRIEF M0)', () => {
  it('ships desktop 1280×800, tablet 768×1024, mobile 375×812', () => {
    expect(BUILT_IN_PROFILES.desktop).toMatchObject({ width: 1280, height: 800, isMobile: false })
    expect(BUILT_IN_PROFILES.tablet).toMatchObject({ width: 768, height: 1024 })
    expect(BUILT_IN_PROFILES.mobile).toMatchObject({ width: 375, height: 812, isMobile: true, hasTouch: true })
  })

  it('defaultProfile() is desktop', () => {
    expect(new ViewportManager().defaultProfile().name).toBe('desktop')
  })
})

describe('DEFAULT_STABILIZATION_POLICY (104 §10.1 defaults)', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_STABILIZATION_POLICY).toMatchObject({
      requiredQuietFrames: 6,
      stabilizationTimeoutMs: 5000,
      maxAnimationSettleFrames: 120,
      strictStabilization: false,
    })
  })
})
