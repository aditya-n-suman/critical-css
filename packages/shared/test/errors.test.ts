import { describe, expect, it } from 'vitest'
import {
  CacheError,
  DependencyResolutionError,
  ExtractionError,
  NavigationTimeoutError,
  PluginError,
  SelectorMatchError,
  SerializationError,
} from '../src/index.js'

const SUBCLASSES = [
  { ctor: NavigationTimeoutError, code: 'NAVIGATION_TIMEOUT' },
  { ctor: SelectorMatchError, code: 'SELECTOR_MATCH_FAILED' },
  { ctor: SerializationError, code: 'SERIALIZATION_FAILED' },
  { ctor: DependencyResolutionError, code: 'DEPENDENCY_RESOLUTION_FAILED' },
  { ctor: CacheError, code: 'CACHE_FAILED' },
  { ctor: PluginError, code: 'PLUGIN_FAILED' },
] as const

describe('ExtractionError hierarchy', () => {
  it('base error carries code and converts to an error-severity diagnostic', () => {
    const err = new ExtractionError('SOME_CODE', 'boom', {
      source: { url: 'https://example.test/app.css', line: 3 },
      context: { route: '/' },
    })
    expect(err.code).toBe('SOME_CODE')
    expect(err).toBeInstanceOf(Error)
    expect(err.toDiagnostic()).toEqual({
      severity: 'error',
      code: 'SOME_CODE',
      message: 'boom',
      source: { url: 'https://example.test/app.css', line: 3 },
      context: { route: '/' },
    })
  })

  it('omits source/context from the diagnostic when not provided', () => {
    const diag = new ExtractionError('X', 'msg').toDiagnostic()
    expect(diag).toEqual({ severity: 'error', code: 'X', message: 'msg' })
    expect('source' in diag).toBe(false)
    expect('context' in diag).toBe(false)
  })

  it.each(SUBCLASSES)('$code subclass extends ExtractionError with stable code', ({ ctor, code }) => {
    const err = new ctor('failed')
    expect(err).toBeInstanceOf(ExtractionError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(code)
    expect(err.name).toBe(ctor.name)
    expect(err.toDiagnostic().code).toBe(code)
    expect(err.toDiagnostic().severity).toBe('error')
  })

  it('preserves cause', () => {
    const cause = new Error('root')
    const err = new NavigationTimeoutError('nav timed out', { cause })
    expect(err.cause).toBe(cause)
  })

  it('diagnostic is JSON-serializable', () => {
    const diag = new SerializationError('bad output', { context: { rule: 5 } }).toDiagnostic()
    expect(JSON.parse(JSON.stringify(diag))).toEqual(diag)
  })
})
