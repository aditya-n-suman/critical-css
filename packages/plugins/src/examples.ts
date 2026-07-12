/**
 * Reference plugins (docs/plugins/003, BI-09.4) — one per BRIEF §2.13
 * capability. These double as the SDK's own integration-style tests: a
 * plugin author's first real usage of the surface.
 */

import type { Plugin } from './types.js'

/** Capability 1 — selector ignore-list. */
export function ignoreSelectorsPlugin(selectors: readonly string[]): Plugin {
  return {
    name: 'reference/ignore-selectors',
    version: '0.1.0',
    description: 'Excludes configured selectors from the critical set',
    hooks: {
      afterCollection: async () => ({ excludeSelectors: selectors }),
    },
  }
}

/** Capability 2 — CSS rewriting. */
export function rewriteDeclarationsPlugin(
  rewrites: ReadonlyArray<{ selectorText: string; newDeclarationText: string }>,
): Plugin {
  return {
    name: 'reference/rewrite-declarations',
    version: '0.1.0',
    description: 'Replaces declaration blocks for configured selectors',
    hooks: {
      beforeSerialize: async () => ({ rewriteRules: rewrites }),
    },
  }
}

/** Capability 3 — rule injection. */
export function injectRulePlugin(selectorText: string, declarationText: string): Plugin {
  return {
    name: 'reference/inject-rule',
    version: '0.1.0',
    description: 'Injects a synthetic rule into the serialized output',
    hooks: {
      beforeSerialize: async () => ({ injectRules: [{ selectorText, declarationText }] }),
    },
  }
}

/** Capability 4 — custom visibility policy. */
export function opacityHiddenVisibilityPlugin(): Plugin {
  return {
    name: 'reference/opacity-hidden-visibility',
    version: '0.1.0',
    description: 'Treats opacity:0 elements as hidden (REQ-102)',
    hooks: {
      beforeCollection: async () => ({
        visibilityPolicyOverride: { opacityMode: 'treatZeroAsHidden' as const },
      }),
    },
  }
}

/** Capability 5 — selector-matching augmentation. */
export function forceIncludeSelectorsPlugin(selectors: readonly string[]): Plugin {
  return {
    name: 'reference/force-include-selectors',
    version: '0.1.0',
    description: 'Forces configured selectors into the matched set',
    hooks: {
      afterCollection: async () => ({ forceIncludeSelectors: selectors }),
    },
  }
}
