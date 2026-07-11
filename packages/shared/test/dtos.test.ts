import { describe, expect, expectTypeOf, it } from 'vitest'
import { computeFold } from '../src/index.js'
import type {
  CacheFingerprint,
  DependencyNode,
  Diagnostic,
  ExtractionOptions,
  ExtractionResult,
  MatchedRule,
  PluginHookContext,
  PluginHookName,
  RouteManifestEntry,
  ViewportProfile,
} from '../src/index.js'

describe('DTO shapes (type-level, per design docs)', () => {
  it('Diagnostic carries severity/code/message plus optional source and context', () => {
    expectTypeOf<Diagnostic['severity']>().toEqualTypeOf<'info' | 'warning' | 'error'>()
    expectTypeOf<Diagnostic['code']>().toBeString()
    expectTypeOf<Diagnostic['message']>().toBeString()
  })

  it('ViewportProfile matches 105-Viewport-Manager §8.1', () => {
    expectTypeOf<ViewportProfile['width']>().toBeNumber()
    expectTypeOf<ViewportProfile['deviceScaleFactor']>().toBeNumber()
    expectTypeOf<ViewportProfile['isMobile']>().toBeBoolean()
    expectTypeOf<ViewportProfile['userAgent']>().toEqualTypeOf<string | null>()
    expectTypeOf<ViewportProfile['colorScheme']>().toEqualTypeOf<'light' | 'dark' | 'no-preference'>()
    expectTypeOf<ViewportProfile['foldOffset']>().toEqualTypeOf<number | null>()
  })

  it('MatchedRule identity is (stylesheetUrl, rule index path) with at-rule chain', () => {
    expectTypeOf<MatchedRule['stylesheetUrl']>().toEqualTypeOf<string | null>()
    expectTypeOf<MatchedRule['sourceRuleIndex']>().toEqualTypeOf<readonly number[]>()
    expectTypeOf<MatchedRule['origin']>().toEqualTypeOf<'user-agent' | 'user' | 'author'>()
    expectTypeOf<MatchedRule['atRuleChain']>().toEqualTypeOf<readonly string[]>()
  })

  it('DependencyNode covers the full construct taxonomy (REQ-200)', () => {
    expectTypeOf<DependencyNode['type']>().toEqualTypeOf<
      | 'variable'
      | 'keyframes'
      | 'font-face'
      | 'property'
      | 'counter-style'
      | 'layer'
      | 'media'
      | 'container'
      | 'supports'
      | 'import'
    >()
  })

  it('ExtractionResult bundles css, diagnostics, matched rules and timing', () => {
    expectTypeOf<ExtractionResult['css']>().toBeString()
    expectTypeOf<ExtractionResult['diagnostics']>().toEqualTypeOf<readonly Diagnostic[]>()
    expectTypeOf<ExtractionResult['matchedRules']>().toEqualTypeOf<readonly MatchedRule[]>()
  })

  it('ExtractionOptions mode is the three-strategy union (REQ-150)', () => {
    expectTypeOf<ExtractionOptions['mode']>().toEqualTypeOf<'cssom' | 'coverage' | 'hybrid'>()
  })

  it('PluginHookContext names the six lifecycle hooks (REQ-470)', () => {
    expectTypeOf<PluginHookName>().toEqualTypeOf<
      | 'beforeLaunch'
      | 'afterNavigation'
      | 'beforeCollection'
      | 'afterCollection'
      | 'beforeSerialize'
      | 'afterSerialize'
    >()
    expectTypeOf<PluginHookContext['emitDiagnostic']>().toBeFunction()
  })

  it('RouteManifestEntry and CacheFingerprint expose their documented fields', () => {
    expectTypeOf<RouteManifestEntry['routePattern']>().toBeString()
    expectTypeOf<CacheFingerprint['hash']>().toBeString()
  })
})

describe('computeFold (105 §8.3)', () => {
  const base: ViewportProfile = {
    name: 'mobile',
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: null,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    foldOffset: null,
  }

  it('defaults the fold to viewport height', () => {
    expect(computeFold(base)).toBe(812)
  })

  it('foldOffset replaces (not offsets) the default', () => {
    expect(computeFold({ ...base, foldOffset: 600 })).toBe(600)
  })
})
