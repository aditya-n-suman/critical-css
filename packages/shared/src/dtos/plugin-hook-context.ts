/**
 * PluginHookContext — per docs/architecture/005-Glossary.md's six lifecycle
 * hooks and Design Principle 7 (Plugin Sandboxing): hooks receive an
 * immutable-by-default context plus an attributable diagnostic emitter.
 */

import type { Diagnostic } from './diagnostic.js'

export type PluginHookName =
  | 'beforeLaunch'
  | 'afterNavigation'
  | 'beforeCollection'
  | 'afterCollection'
  | 'beforeSerialize'
  | 'afterSerialize'

export interface PluginHookContext<TState = Record<string, unknown>> {
  readonly hookName: PluginHookName
  /** Mutable, hook-specific state payload the plugin may patch. */
  readonly state: TState
  /** Emit a diagnostic attributed to the current plugin (Principle 6/7). */
  readonly emitDiagnostic: (diagnostic: Diagnostic) => void
}
