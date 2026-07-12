/**
 * Plugin registry + dispatcher (docs/plugins/000/001/004, ADR-0004,
 * docs/tasks/008).
 *
 * - Registration: validated, ordered registry; malformed plugins rejected
 *   with a diagnostic, never silently ignored.
 * - Dispatch: declared configuration order, sequential (never concurrent
 *   racing writes); each invocation gets a frozen context, its own timeout,
 *   and error isolation — a throwing plugin fails ITS invocation with an
 *   attributed diagnostic, not the orchestrator (unless failFast).
 * - The six named hooks are the ENTIRE extension surface — no event bus,
 *   no wildcard listeners (task 008 scope boundary).
 */

import { PluginError } from '@critical-css/shared'
import type { Diagnostic } from '@critical-css/shared'
import type { BaseHookContext, Plugin, PluginHooks, PluginLogger } from './types.js'

export interface PluginDispatchOptions {
  /** Per-hook-invocation timeout. Default 5000ms (ADR-0004 per-plugin budget). */
  readonly hookTimeoutMs: number
  /** Escalate a plugin failure to a thrown PluginError. Default false. */
  readonly failFast: boolean
}

export const DEFAULT_DISPATCH_OPTIONS: PluginDispatchOptions = {
  hookTimeoutMs: 5_000,
  failFast: false,
}

export interface PluginRegistry {
  readonly plugins: readonly Plugin<unknown>[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Loader/validator: config order preserved; rejects malformed definitions. */
export function buildPluginRegistry(candidates: readonly unknown[]): PluginRegistry {
  const plugins: Plugin<unknown>[] = []
  const diagnostics: Diagnostic[] = []
  const seenNames = new Set<string>()
  for (const [index, candidate] of candidates.entries()) {
    const p = candidate as Partial<Plugin<unknown>>
    if (typeof p !== 'object' || p === null || typeof p.name !== 'string' || p.name.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'PLUGIN_INVALID',
        message: `Plugin at index ${index} rejected: missing/invalid "name"`,
      })
      continue
    }
    if (typeof p.version !== 'string' || typeof p.hooks !== 'object' || p.hooks === null) {
      diagnostics.push({
        severity: 'error',
        code: 'PLUGIN_INVALID',
        message: `Plugin "${p.name}" rejected: missing "version" or "hooks"`,
      })
      continue
    }
    if (seenNames.has(p.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'PLUGIN_DUPLICATE_NAME',
        message: `Plugin "${p.name}" rejected: duplicate name (names attribute diagnostics; they must be unique)`,
      })
      continue
    }
    seenNames.add(p.name)
    plugins.push(p as Plugin<unknown>)
  }
  return { plugins, diagnostics }
}

export interface HookRunResult<TPatch> {
  /** One entry per plugin that returned a patch, in declared order. */
  readonly patches: ReadonlyArray<{ pluginName: string; patch: TPatch }>
  readonly diagnostics: readonly Diagnostic[]
}

type HookName = keyof PluginHooks<unknown>

export class PluginDispatcher {
  private readonly options: PluginDispatchOptions

  constructor(
    private readonly registry: PluginRegistry,
    options: Partial<PluginDispatchOptions> = {},
  ) {
    this.options = { ...DEFAULT_DISPATCH_OPTIONS, ...options }
  }

  get hasPlugins(): boolean {
    return this.registry.plugins.length > 0
  }

  /**
   * Run one hook across every registered plugin, sequentially in declared
   * order. `makeContext` receives the per-plugin base fields plus the
   * previous plugins' patches (so later plugins see earlier contributions —
   * ADR-0004's mergedContextView).
   */
  async runHook<TContext extends BaseHookContext<unknown>, TPatch>(
    hookName: HookName,
    makeContext: (
      base: Pick<BaseHookContext<unknown>, 'logger' | 'pluginOptions' | 'deadline'>,
      earlierPatches: ReadonlyArray<{ pluginName: string; patch: TPatch }>,
    ) => TContext,
  ): Promise<HookRunResult<TPatch>> {
    const patches: Array<{ pluginName: string; patch: TPatch }> = []
    const diagnostics: Diagnostic[] = []

    for (const plugin of this.registry.plugins) {
      const hook = plugin.hooks[hookName] as ((ctx: TContext) => Promise<TPatch | void>) | undefined
      if (hook === undefined) continue // unimplemented hooks are silent no-ops

      const logger: PluginLogger = {
        info: (message) =>
          diagnostics.push({ severity: 'info', code: 'PLUGIN_LOG', message: `[${plugin.name}#${hookName}] ${message}` }),
        warn: (message) =>
          diagnostics.push({ severity: 'warning', code: 'PLUGIN_LOG', message: `[${plugin.name}#${hookName}] ${message}` }),
      }
      const deadline = new Date(Date.now() + this.options.hookTimeoutMs)
      // Frozen context: plugins receive read-only DTOs, never mutable
      // pipeline references (Principle 7 / 004-Sandboxing).
      const context = Object.freeze(
        makeContext({ logger, pluginOptions: (plugin.options ?? {}) as Readonly<unknown>, deadline }, patches),
      )

      try {
        const patch = await this.withTimeout(hook(context), plugin.name, hookName)
        if (patch !== undefined && patch !== null) {
          patches.push({ pluginName: plugin.name, patch: patch as TPatch })
        }
      } catch (err) {
        const failure = new PluginError(
          `Plugin "${plugin.name}"@${plugin.version} failed at ${hookName}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err, context: { plugin: plugin.name, hook: hookName } },
        )
        if (this.options.failFast) throw failure
        // Isolated failure: attributed diagnostic, pipeline continues (004).
        diagnostics.push(failure.toDiagnostic())
      }
    }
    return { patches, diagnostics }
  }

  private withTimeout<T>(promise: Promise<T>, pluginName: string, hookName: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new PluginError(`Plugin "${pluginName}" exceeded ${this.options.hookTimeoutMs}ms at ${hookName}`, {
              context: { plugin: pluginName, hook: hookName, timeoutMs: this.options.hookTimeoutMs },
            }),
          ),
        this.options.hookTimeoutMs,
      )
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err instanceof Error ? err : new Error(String(err)))
        },
      )
    })
  }
}
