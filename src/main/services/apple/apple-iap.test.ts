import { describe, it, expect, vi } from 'vitest'

// apple-iap pulls in the credential store (and through it Electron) at import
// time; the version pickers under test don't touch either.
vi.mock('../credential-store', () => ({ loadCredentials: vi.fn() }))
vi.mock('./apple-auth', () => ({ generateAppleJwt: vi.fn(), clearTokenCache: vi.fn() }))

import { pickEditableVersion, pickDisplayVersion } from './apple-iap'

const v = (id: string, version: number, state: string) => ({ id, version, state })

describe('pickEditableVersion', () => {
  it('returns null when there are no versions', () => {
    expect(pickEditableVersion([])).toBeNull()
  })

  it('returns null when every version is frozen', () => {
    const versions = [v('1', 1, 'REPLACED_WITH_NEW_VERSION'), v('2', 2, 'APPROVED')]
    expect(pickEditableVersion(versions)).toBeNull()
  })

  it('picks the newest editable version', () => {
    const versions = [
      v('1', 1, 'APPROVED'),
      v('2', 2, 'PREPARE_FOR_SUBMISSION'),
      v('3', 3, 'REJECTED')
    ]
    expect(pickEditableVersion(versions)?.id).toBe('3')
  })

  it('treats in-review states as editable so Apple decides, not us', () => {
    expect(pickEditableVersion([v('1', 1, 'IN_REVIEW')])?.id).toBe('1')
  })
})

describe('pickDisplayVersion', () => {
  it('prefers the editable draft over a newer frozen version', () => {
    const versions = [v('1', 1, 'PREPARE_FOR_SUBMISSION'), v('2', 2, 'APPROVED')]
    expect(pickDisplayVersion(versions)?.id).toBe('1')
  })

  it('falls back to the newest shipped version', () => {
    const versions = [v('1', 1, 'REPLACED_WITH_NEW_VERSION'), v('2', 2, 'APPROVED')]
    expect(pickDisplayVersion(versions)?.id).toBe('2')
  })

  it('returns null when there are no versions', () => {
    expect(pickDisplayVersion([])).toBeNull()
  })
})
