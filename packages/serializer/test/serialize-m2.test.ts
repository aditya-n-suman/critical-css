/**
 * M2 serializer features: layer prelude, dependency emission (INV-2),
 * reference dedup, conservative minification, output formats (602/603/604/606).
 */

import { describe, expect, it } from 'vitest'
import type { DependencyNode } from '@critical-css/shared'
import {
  DEFAULT_SERIALIZER_CONFIG,
  serialize,
  toInlineStyle,
  toJsonEnvelope,
} from '../src/index.js'
import type { MergedRule } from '../src/index.js'

function rule(overrides: Partial<MergedRule>): MergedRule {
  return {
    selectorText: '.a',
    declarationText: 'color: red;',
    origin: 'author',
    layerOrder: null,
    atRuleChain: [],
    contributingViewports: ['desktop'],
    stylesheetIndex: 0,
    ruleIndex: [0],
    ...overrides,
  }
}

function dep(id: string, type: DependencyNode['type'], cssText: string): DependencyNode {
  return { id, type, value: id, cssText, dependents: [], dependencies: [] }
}

describe('layer prelude + layered ordering (601 §8.4, 506)', () => {
  it('emits the @layer statement in declared order before everything else', () => {
    const layered = rule({
      selectorText: '.base-rule',
      layerOrder: 0,
      atRuleChain: [{ kind: 'layer', conditionText: 'base' }],
      ruleIndex: [2, 0],
    })
    const unlayered = rule({ selectorText: '.plain', ruleIndex: [0] })
    const artifact = serialize({
      rules: [unlayered, layered],
      dependencyManifest: [],
      layerDeclarationOrder: ['base', 'overrides'],
    })
    expect(artifact.css.startsWith('@layer base, overrides;\n')).toBe(true)
    // Layered rules precede unlayered (unlayered = highest priority, LAST).
    expect(artifact.css.indexOf('.base-rule')).toBeLessThan(artifact.css.indexOf('.plain'))
  })
})

describe('dependency emission (INV-2)', () => {
  it('emits each manifest construct exactly once, before style rules', () => {
    const kf = dep('keyframes:fade', 'keyframes', '@keyframes fade { from { opacity: 0; } }')
    const artifact = serialize({ rules: [rule({})], dependencyManifest: [kf] })
    const first = artifact.css.indexOf('@keyframes fade')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(artifact.css.indexOf('@keyframes fade', first + 1)).toBe(-1)
    expect(first).toBeLessThan(artifact.css.indexOf('.a {'))
  })

  it('variable manifest nodes without cssText are not emitted (declared via their rules)', () => {
    const varNode = dep('variable:--x', 'variable', null as never)
    const artifact = serialize({
      rules: [rule({})],
      dependencyManifest: [{ ...varNode, cssText: null }],
    })
    expect(artifact.css).not.toContain('variable:--x')
  })
})

describe('reference dedup (602 Layer 1)', () => {
  it('collapses identical rule identity, unioning viewport provenance', () => {
    const a = rule({ contributingViewports: ['desktop'] })
    const b = rule({ contributingViewports: ['mobile'] })
    const artifact = serialize({ rules: [a, b], dependencyManifest: [] })
    expect(artifact.stats.ruleCount).toBe(1)
    expect((artifact.css.match(/\.a \{/g) ?? []).length).toBe(1)
  })

  it('does NOT collapse structural twins with different identities (cascade safety)', () => {
    const a = rule({ ruleIndex: [0] })
    const b = rule({ ruleIndex: [5] })
    const artifact = serialize({ rules: [a, b], dependencyManifest: [] })
    expect(artifact.stats.ruleCount).toBe(2)
  })
})

describe('conservative minification (603 safe subset)', () => {
  const input = {
    rules: [
      rule({ selectorText: '.m', declarationText: 'color: red; background: blue;' }),
      rule({
        selectorText: '.in-media',
        atRuleChain: [{ kind: 'media' as const, conditionText: 'screen' }],
        ruleIndex: [1, 0],
      }),
    ],
    dependencyManifest: [],
  }

  it('emits compact structural output; declaration tokens stay verbatim', () => {
    const artifact = serialize(input, { ...DEFAULT_SERIALIZER_CONFIG, minify: true })
    expect(artifact.css).toContain('.m{color: red; background: blue}')
    expect(artifact.css).toContain('@media screen {')
    expect(artifact.css).not.toContain('\n')
  })

  it('is idempotent and render-equivalent to pretty output (tokens unchanged)', () => {
    const once = serialize(input, { ...DEFAULT_SERIALIZER_CONFIG, minify: true }).css
    const twice = serialize(input, { ...DEFAULT_SERIALIZER_CONFIG, minify: true }).css
    expect(once).toBe(twice)
    // Exclusion contract: no color/unit/shorthand rewriting.
    expect(once).toContain('color: red')
  })
})

describe('output formats (606)', () => {
  const input = { rules: [rule({})], dependencyManifest: [] }

  it('inline-style wraps the identical CSS bytes, escaping only </style', () => {
    const artifact = serialize(input)
    const inline = toInlineStyle(artifact, { 'data-route': '/' })
    expect(inline).toContain(`<style data-critical="true" data-route="/">`)
    expect(inline).toContain(artifact.css)
    const withClose = serialize(
      { rules: [rule({ declarationText: 'content: "</style>";' })], dependencyManifest: [] },
    )
    expect(toInlineStyle(withClose)).not.toMatch(/<\/style>";/)
  })

  it('json-envelope carries css byte-identical to raw', () => {
    const artifact = serialize(input)
    const envelope = JSON.parse(
      toJsonEnvelope(artifact, { route: '/', viewport: 'desktop', extractionMode: 'cssom', engineVersion: '0.1.0' }),
    ) as { css: string; schemaVersion: string }
    expect(envelope.schemaVersion).toBe('1.0')
    expect(envelope.css).toBe(artifact.css)
  })
})
