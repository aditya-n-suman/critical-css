/**
 * Fail-fast error taxonomy (Design Principle 6), per BI-01.3: an
 * `ExtractionError` base with a stable, serializable `toDiagnostic()` every
 * downstream package's error handling relies on.
 *
 * Must remain free of Node.js built-ins — safe inside browser-injected code.
 */

import type { Diagnostic, DiagnosticSourceLocation } from '../dtos/diagnostic.js'

export interface ExtractionErrorOptions {
  readonly source?: DiagnosticSourceLocation
  readonly context?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

export class ExtractionError extends Error {
  readonly code: string
  readonly source: DiagnosticSourceLocation | undefined
  readonly context: Readonly<Record<string, unknown>> | undefined

  constructor(code: string, message: string, options: ExtractionErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.source = options.source
    this.context = options.context
  }

  toDiagnostic(): Diagnostic {
    return {
      severity: 'error',
      code: this.code,
      message: this.message,
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.context !== undefined ? { context: this.context } : {}),
    }
  }
}

export class NavigationTimeoutError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('NAVIGATION_TIMEOUT', message, options)
  }
}

export class SelectorMatchError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('SELECTOR_MATCH_FAILED', message, options)
  }
}

export class SerializationError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('SERIALIZATION_FAILED', message, options)
  }
}

export class DependencyResolutionError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('DEPENDENCY_RESOLUTION_FAILED', message, options)
  }
}

export class CacheError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('CACHE_FAILED', message, options)
  }
}

export class PluginError extends ExtractionError {
  constructor(message: string, options: ExtractionErrorOptions = {}) {
    super('PLUGIN_FAILED', message, options)
  }
}
