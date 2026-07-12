/**
 * M2 end-to-end: dependency resolution, visibility classification, layer
 * ordering, plugins, minify/format — against real Chromium fixtures.
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ignoreSelectorsPlugin, injectRulePlugin } from '@critical-css/plugins'
import { extract } from '../src/index.js'

const ROOT = resolve(import.meta.dirname, '../../..')
const fixtureUrl = (name: string): string =>
  pathToFileURL(resolve(ROOT, 'fixtures', name, 'index.html')).href

describe('M2: dependency resolution (exit criteria 1–2)', () => {
  it('includes variables, keyframes, @font-face, @property, @counter-style used by matched rules', async () => {
    const outcome = await extract({ url: fixtureUrl('deps'), viewport: 'desktop' })
    // Variable chain: .card uses --chained → :root (declaring --chained via --base) pulled in.
    expect(outcome.css).toContain(':root {')
    expect(outcome.css).toContain('--chained:')
    // Keyframes (last-wins duplicate) exactly once.
    expect((outcome.css.match(/@keyframes fade-in/g) ?? []).length).toBe(1)
    expect(outcome.css).toContain('0.5')
    // Font-face + @property + @counter-style.
    expect(outcome.css).toContain('font-family: FixtureFont')
    expect(outcome.css).toContain('@property --accent')
    expect(outcome.css).toContain('@counter-style dots')
    expect(outcome.stats.dependencies).toBeGreaterThan(0)
  })

  it('reaches fixed point on the variable cycle with a CYCLIC_DEPENDENCY diagnostic', async () => {
    const outcome = await extract({ url: fixtureUrl('deps'), viewport: 'desktop' })
    expect(outcome.diagnostics.some((d) => d.code === 'CYCLIC_DEPENDENCY')).toBe(true)
  })

  it('emits the @layer statement prelude in declared order (601 §8.4)', async () => {
    const outcome = await extract({ url: fixtureUrl('deps'), viewport: 'desktop' })
    expect(outcome.css.startsWith('@layer base, overrides;')).toBe(true)
    // Layered rules precede unlayered; base precedes overrides.
    const base = outcome.css.indexOf('@layer base {')
    const overrides = outcome.css.indexOf('@layer overrides {')
    expect(base).toBeGreaterThan(-1)
    expect(overrides).toBeGreaterThan(base)
  })
})

describe('M2: visibility classification (exit criterion 4)', () => {
  it('sticky and viewport-fixed rules are always-critical; clipped and below-fold excluded', async () => {
    const outcome = await extract({ url: fixtureUrl('layout'), viewport: 'desktop' })
    expect(outcome.css).toContain('.sticky-header {')
    expect(outcome.css).toContain('.fixed-cta {')
    expect(outcome.css).toContain('.inside-child {')
    // Clipped by ancestor overflow:hidden → excluded (203).
    expect(outcome.css).not.toContain('.clipped-child')
    // Below-fold-only selector → excluded.
    expect(outcome.css).not.toContain('.below-only')
    expect(outcome.stats.visibleNodes).toBeGreaterThan(0)
    expect(outcome.stats.visibleNodes).toBeLessThan(outcome.stats.totalNodes)
  })
})

describe('M2: plugins (exit criterion 3)', () => {
  it('ignore-selectors plugin excludes rules; inject plugin appends synthetic rules', async () => {
    const outcome = await extract({
      url: fixtureUrl('static'),
      viewport: 'desktop',
      plugins: [ignoreSelectorsPlugin(['.subtitle']), injectRulePlugin('.injected', 'outline: 1px solid;')],
    })
    expect(outcome.css).not.toContain('.subtitle')
    expect(outcome.css).toContain('.injected {')
    // Injected rules sort last (stable synthetic index).
    expect(outcome.css.trimEnd().endsWith('}')).toBe(true)
    expect(outcome.css.lastIndexOf('.injected')).toBeGreaterThan(outcome.css.lastIndexOf('.hero'))
  })

  it('a crashing plugin is isolated with an attributed diagnostic', async () => {
    const outcome = await extract({
      url: fixtureUrl('static'),
      viewport: 'desktop',
      plugins: [
        {
          name: 'crashy',
          version: '1.0.0',
          hooks: {
            afterCollection: async () => {
              throw new Error('kaboom')
            },
          },
        },
      ],
    })
    const failure = outcome.diagnostics.find((d) => d.code === 'PLUGIN_FAILED')
    expect(failure?.message).toContain('"crashy"')
    expect(outcome.css.length).toBeGreaterThan(0) // pipeline survived
  })
})

describe('M2: minify + formats', () => {
  it('--minify emits compact, deterministic output', async () => {
    const first = await extract({ url: fixtureUrl('static'), viewport: 'desktop', minify: true })
    const second = await extract({ url: fixtureUrl('static'), viewport: 'desktop', minify: true })
    expect(first.css).toBe(second.css)
    expect(first.css).not.toContain('\n')
  })

  it('json-envelope output carries the identical css', async () => {
    const outcome = await extract({ url: fixtureUrl('static'), viewport: 'desktop', format: 'json-envelope' })
    const envelope = JSON.parse(outcome.output) as { css: string }
    expect(envelope.css).toBe(outcome.css)
  })
})
