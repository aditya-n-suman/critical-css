/**
 * Plugin SDK surface (docs/plugins/002-Plugin-API.md, ADR-0004).
 *
 * A plugin is a PLAIN OBJECT — statically inspectable without executing
 * plugin code. Contributions are strictly patch-based: hooks receive frozen
 * context DTOs and return typed patches; they never touch mutable pipeline
 * internals (Design Principle 7).
 */

import type { Diagnostic, PluginHookName, ViewportProfile, VisibilityConfig } from '@critical-css/shared'

export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
}

/** Common facts available at every hook firing (002 §8.2). */
export interface BaseHookContext<TOptions = void> {
  readonly logger: PluginLogger
  readonly pluginOptions: Readonly<TOptions>
  readonly route: string
  readonly viewport: Readonly<ViewportProfile>
  /** Stable across all six hooks of one extraction run. */
  readonly runId: string
  /** Wall-clock deadline this hook invocation must complete before. */
  readonly deadline: Date
}

export interface BeforeLaunchContext<TOptions = void> extends BaseHookContext<TOptions> {
  readonly proposedLaunchOptions: Readonly<{ headless: boolean; userAgent: string | null }>
}
export interface BeforeLaunchPatch {
  /** Allow-listed subset only — sandbox-relevant flags are NOT patchable (002 §8.3). */
  readonly launchOptionsOverride?: Partial<{ userAgent: string; extraHTTPHeaders: Record<string, string> }>
}

export interface AfterNavigationContext<TOptions = void> extends BaseHookContext<TOptions> {
  readonly navigationResult: Readonly<{ finalUrl: string; statusCode: number | null; stable: boolean }>
}
export interface AfterNavigationPatch {
  readonly diagnostics?: readonly Diagnostic[]
}

export interface BeforeCollectionContext<TOptions = void> extends BaseHookContext<TOptions> {
  /** Threaded through earlier plugins' patches in declared order (ADR-0004). */
  readonly currentVisibilityPolicy: Readonly<VisibilityConfig>
  readonly currentIgnoredSelectors: readonly string[]
}
export interface BeforeCollectionPatch {
  /** Selector ignore-list additions (BRIEF §2.13 capability 1). */
  readonly ignoredSelectors?: readonly string[]
  /** Custom visibility policy override (capability 4). */
  readonly visibilityPolicyOverride?: Partial<VisibilityConfig>
}

export interface AfterCollectionContext<TOptions = void> extends BaseHookContext<TOptions> {
  readonly matchedSelectors: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}
export interface AfterCollectionPatch {
  /** Force-exclude matched rules by exact selector text (capability 1/5). */
  readonly excludeSelectors?: readonly string[]
  /** Force-include selectors the matcher missed (matching augmentation, capability 5). */
  readonly forceIncludeSelectors?: readonly string[]
}

export interface InjectedRule {
  readonly selectorText: string
  readonly declarationText: string
}
export interface CssRewrite {
  /** Exact selector text of the rule whose declarations are replaced. */
  readonly selectorText: string
  readonly newDeclarationText: string
}
export interface BeforeSerializeContext<TOptions = void> extends BaseHookContext<TOptions> {
  readonly currentIncludedRules: ReadonlyArray<Readonly<{ selectorText: string; declarationText: string }>>
}
export interface BeforeSerializePatch {
  /** Rule injection (capability 3). Injected rules get stable synthetic order. */
  readonly injectRules?: readonly InjectedRule[]
  /** CSS rewriting (capability 2). */
  readonly rewriteRules?: readonly CssRewrite[]
  readonly excludeSelectors?: readonly string[]
}

export interface AfterSerializeContext<TOptions = void> extends BaseHookContext<TOptions> {
  readonly css: string
  readonly stats: Readonly<{ ruleCount: number; byteLength: number }>
}
/** Observation-only by strong convention (002 §8.2); annotation only. */
export interface AfterSerializePatch {
  readonly diagnostics?: readonly Diagnostic[]
}

export interface PluginHooks<TOptions = void> {
  beforeLaunch(ctx: BeforeLaunchContext<TOptions>): Promise<BeforeLaunchPatch | void>
  afterNavigation(ctx: AfterNavigationContext<TOptions>): Promise<AfterNavigationPatch | void>
  beforeCollection(ctx: BeforeCollectionContext<TOptions>): Promise<BeforeCollectionPatch | void>
  afterCollection(ctx: AfterCollectionContext<TOptions>): Promise<AfterCollectionPatch | void>
  beforeSerialize(ctx: BeforeSerializeContext<TOptions>): Promise<BeforeSerializePatch | void>
  afterSerialize(ctx: AfterSerializeContext<TOptions>): Promise<AfterSerializePatch | void>
}

export interface Plugin<TOptions = void> {
  /** Stable, unique identifier — diagnostics name plugins, never array indices. */
  readonly name: string
  /** SemVer of the plugin itself, for regression attribution. */
  readonly version: string
  readonly description?: string
  /** Unimplemented hooks are silent no-ops (ADR-0004). */
  readonly hooks: Partial<PluginHooks<TOptions>>
  readonly options?: TOptions
}

export type { PluginHookName }
