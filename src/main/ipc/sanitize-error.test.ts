import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock @electron-toolkit/utils so we can flip is.dev per test without
// loading Electron itself in the test environment.
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { sanitizeError } from './sanitize-error'
import { is } from '@electron-toolkit/utils'

describe('sanitizeError', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(is as { dev: boolean }).dev = true
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('returns the raw Error message in dev', () => {
    ;(is as { dev: boolean }).dev = true
    const err = new Error('apple API rejected /Users/alice/secret.json')
    expect(sanitizeError(err)).toBe('apple API rejected /Users/alice/secret.json')
  })

  it('scrubs macOS user paths in production', () => {
    ;(is as { dev: boolean }).dev = false
    const err = new Error('failed to read /Users/alice/Library/creds.json file')
    expect(sanitizeError(err)).toBe('failed to read <path> file')
  })

  it('scrubs Linux home paths in production', () => {
    ;(is as { dev: boolean }).dev = false
    const err = new Error('cannot access /home/bob/.config/app.db here')
    expect(sanitizeError(err)).toBe('cannot access <path> here')
  })

  it('scrubs Windows paths in production', () => {
    ;(is as { dev: boolean }).dev = false
    const err = new Error('open C:\\Users\\carol\\AppData\\creds.json failed')
    expect(sanitizeError(err)).toBe('open <path> failed')
  })

  it('scrubs multiple paths in a single message', () => {
    ;(is as { dev: boolean }).dev = false
    const err = new Error('copy /Users/a/x.txt to /home/b/y.txt')
    expect(sanitizeError(err)).toBe('copy <path> to <path>')
  })

  it('handles non-Error thrown values by stringifying them', () => {
    expect(sanitizeError('plain string failure')).toBe('plain string failure')
    expect(sanitizeError(42)).toBe('42')
    expect(sanitizeError(null)).toBe('null')
  })

  it('scrubs paths even when a non-Error value is thrown in production', () => {
    // Regression guard: previously the non-Error branch returned String(e)
    // unconditionally, leaking absolute paths in shipped builds whenever a
    // string was thrown directly (e.g. `throw '/Users/x/secret.json'`).
    ;(is as { dev: boolean }).dev = false
    expect(sanitizeError('open /Users/alice/secret.json failed')).toBe('open <path> failed')
  })

  it('preserves non-Error values verbatim in dev', () => {
    ;(is as { dev: boolean }).dev = true
    expect(sanitizeError('open /Users/alice/secret.json failed')).toBe(
      'open /Users/alice/secret.json failed'
    )
  })

  it('logs the original Error to console.error', () => {
    const err = new Error('boom')
    sanitizeError(err)
    expect(consoleSpy).toHaveBeenCalledWith(err)
  })

  it('logs non-Error values with a marker prefix', () => {
    sanitizeError({ weird: true })
    expect(consoleSpy).toHaveBeenCalledWith('Non-Error thrown:', { weird: true })
  })
})
