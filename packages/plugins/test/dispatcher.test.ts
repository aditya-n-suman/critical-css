/**
 * Plugin dispatcher tests (task 008): loader/validator, deterministic order,
 * patch threading, error isolation, timeouts, frozen contexts.
 */

import { describe, expect, it } from 'vitest'
import { PluginError } from '@critical-css/shared'
import {
  buildPluginRegistry,
  ignoreSelectorsPlugin,
  injectRulePlugin,
  opacityHiddenVisibilityPlugin,
  PluginDispatcher,
} from '../src/index.js'
import type { BeforeCollectionContext, BeforeCollectionPatch, Plugin } from '../src/index.js'

function makePlugin(name: string, hooks: Plugin['hooks']): Plugin {
  return { name, version: '1.0.0', hooks }
}

const baseContext = (
  hookBase: { logger: unknown; pluginOptions: unknown; deadline: Date },
  earlier: ReadonlyArray<{ pluginName: string; patch: BeforeCollectionPatch }>,
): BeforeCollectionContext =>
  ({
    ...hookBase,
    route: '/',
    viewport: { name: 'desktop' },
    runId: 'r1',
    currentVisibilityPolicy: {},
    currentIgnoredSelectors: earlier.flatMap((e) => e.patch.ignoredSelectors ?? []),
  }) as never

describe('buildPluginRegistry (loader/validator)', () => {
  it('rejects malformed plugins with diagnostics, never silently', () => {
    const registry = buildPluginRegistry([
      { version: '1.0.0', hooks: {} }, // missing name
      { name: 'no-hooks', version: '1.0.0' }, // missing hooks
      makePlugin('ok', {}),
      makePlugin('ok', {}), // duplicate name
    ])
    expect(registry.plugins.map((p) => p.name)).toEqual(['ok'])
    expect(registry.diagnostics.map((d) => d.code)).toEqual([
      'PLUGIN_INVALID',
      'PLUGIN_INVALID',
      'PLUGIN_DUPLICATE_NAME',
    ])
  })
})

describe('PluginDispatcher', () => {
  it('executes plugins sequentially in declared order; later plugins see earlier patches', async () => {
    const order: string[] = []
    const p1 = makePlugin('first', {
      beforeCollection: async (ctx) => {
        order.push(`first:${(ctx as BeforeCollectionContext).currentIgnoredSelectors.length}`)
        return { ignoredSelectors: ['.a'] }
      },
    })
    const p2 = makePlugin('second', {
      beforeCollection: async (ctx) => {
        order.push(`second:${(ctx as BeforeCollectionContext).currentIgnoredSelectors.length}`)
        return { ignoredSelectors: ['.b'] }
      },
    })
    const dispatcher = new PluginDispatcher(buildPluginRegistry([p1, p2]))
    const result = await dispatcher.runHook<BeforeCollectionContext, BeforeCollectionPatch>(
      'beforeCollection',
      baseContext,
    )
    expect(order).toEqual(['first:0', 'second:1'])
    expect(result.patches.map((p) => p.pluginName)).toEqual(['first', 'second'])
  })

  it('isolates a throwing plugin: attributed diagnostic, later plugins still run', async () => {
    const ran: string[] = []
    const bad = makePlugin('bad', {
      beforeCollection: async () => {
        throw new Error('boom')
      },
    })
    const good = makePlugin('good', {
      beforeCollection: async () => {
        ran.push('good')
        return { ignoredSelectors: ['.x'] }
      },
    })
    const dispatcher = new PluginDispatcher(buildPluginRegistry([bad, good]))
    const result = await dispatcher.runHook<BeforeCollectionContext, BeforeCollectionPatch>(
      'beforeCollection',
      baseContext,
    )
    expect(ran).toEqual(['good'])
    const failure = result.diagnostics.find((d) => d.code === 'PLUGIN_FAILED')
    expect(failure?.message).toContain('"bad"')
    expect(result.patches).toHaveLength(1)
  })

  it('failFast escalates a plugin failure to a thrown PluginError', async () => {
    const bad = makePlugin('bad', {
      beforeCollection: async () => {
        throw new Error('boom')
      },
    })
    const dispatcher = new PluginDispatcher(buildPluginRegistry([bad]), { failFast: true })
    await expect(
      dispatcher.runHook<BeforeCollectionContext, BeforeCollectionPatch>('beforeCollection', baseContext),
    ).rejects.toBeInstanceOf(PluginError)
  })

  it('enforces the per-invocation timeout (ADR-0004 budget)', async () => {
    const slow = makePlugin('slow', {
      beforeCollection: () => new Promise(() => undefined), // never resolves
    })
    const dispatcher = new PluginDispatcher(buildPluginRegistry([slow]), { hookTimeoutMs: 50 })
    const result = await dispatcher.runHook<BeforeCollectionContext, BeforeCollectionPatch>(
      'beforeCollection',
      baseContext,
    )
    const timeoutDiag = result.diagnostics.find((d) => d.code === 'PLUGIN_FAILED')
    expect(timeoutDiag?.message).toContain('exceeded 50ms')
  })

  it('hands plugins a frozen context (Principle 7)', async () => {
    let frozen = false
    const probe = makePlugin('probe', {
      beforeCollection: async (ctx) => {
        frozen = Object.isFrozen(ctx)
        return undefined
      },
    })
    await new PluginDispatcher(buildPluginRegistry([probe])).runHook<BeforeCollectionContext, BeforeCollectionPatch>(
      'beforeCollection',
      baseContext,
    )
    expect(frozen).toBe(true)
  })

  it('unimplemented hooks are silent no-ops', async () => {
    const noHook = makePlugin('none', {})
    const dispatcher = new PluginDispatcher(buildPluginRegistry([noHook]))
    const result = await dispatcher.runHook<BeforeCollectionContext, BeforeCollectionPatch>(
      'beforeCollection',
      baseContext,
    )
    expect(result.patches).toHaveLength(0)
    expect(result.diagnostics).toHaveLength(0)
  })
})

describe('reference plugins (003 / BI-09.4)', () => {
  it('expose the five BRIEF §2.13 capabilities as valid plugins', () => {
    const registry = buildPluginRegistry([
      ignoreSelectorsPlugin(['.ad']),
      injectRulePlugin('.injected', 'color: red;'),
      opacityHiddenVisibilityPlugin(),
    ])
    expect(registry.plugins).toHaveLength(3)
    expect(registry.diagnostics).toHaveLength(0)
  })
})
