/**
 * @critical-css/plugins — public API barrel (AT-09).
 */

export { PluginDispatcher, buildPluginRegistry, DEFAULT_DISPATCH_OPTIONS } from './dispatcher.js'
export type { PluginRegistry, PluginDispatchOptions, HookRunResult } from './dispatcher.js'
export type {
  Plugin,
  PluginHooks,
  PluginLogger,
  BaseHookContext,
  BeforeLaunchContext,
  BeforeLaunchPatch,
  AfterNavigationContext,
  AfterNavigationPatch,
  BeforeCollectionContext,
  BeforeCollectionPatch,
  AfterCollectionContext,
  AfterCollectionPatch,
  BeforeSerializeContext,
  BeforeSerializePatch,
  AfterSerializeContext,
  AfterSerializePatch,
  InjectedRule,
  CssRewrite,
} from './types.js'
export {
  ignoreSelectorsPlugin,
  rewriteDeclarationsPlugin,
  injectRulePlugin,
  opacityHiddenVisibilityPlugin,
  forceIncludeSelectorsPlugin,
} from './examples.js'
