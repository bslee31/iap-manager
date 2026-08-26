import { describe, it, expect, vi, beforeEach } from 'vitest'

// Drive the localization flow through a stubbed transport so the version
// resolution (which version is read, when a draft gets created) is asserted
// against the requests actually sent to Apple.
const calls: { method: string; path: string; body?: any }[] = []
let routes: Record<string, () => unknown> = {}

vi.mock('../http-retry', () => ({
  fetchWithRetry: async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.appstoreconnect.apple.com', '')
    const method = init.method || 'GET'
    calls.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    })
    const route = routes[`${method} ${path.split('?')[0]}`]
    if (!route) throw new Error(`unrouted request: ${method} ${path}`)
    const payload = route()
    if (payload instanceof Error) {
      return { ok: false, status: 409, text: async () => JSON.stringify({ errors: [] }) }
    }
    return { ok: true, status: 200, json: async () => payload, text: async () => '' }
  }
}))
vi.mock('../credential-store', () => ({
  loadCredentials: () => ({
    apple: { keyId: 'K', issuerId: 'I', privateKey: 'P', appId: '123' }
  })
}))
vi.mock('./apple-auth', () => ({
  generateAppleJwt: async () => 'jwt',
  clearTokenCache: vi.fn()
}))

import {
  getIapLocalizations,
  createIapLocalization,
  updateIapLocalization,
  deleteIapLocalization
} from './apple-iap'

const version = (id: string, v: number, state: string) => ({
  id,
  attributes: { version: v, state }
})
const localization = (id: string, locale: string, name = 'Name') => ({
  id,
  attributes: { locale, name, description: '' }
})
const versionsRoute = (...data: unknown[]) => ({ data })
const requestsTo = (path: string) => calls.filter((c) => c.path.split('?')[0] === path)

beforeEach(() => {
  calls.length = 0
  routes = {}
})

describe('getIapLocalizations', () => {
  it('reads the editable draft and never creates a version', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V1', 1, 'APPROVED'), version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () =>
      versionsRoute(localization('L2', 'en-US', 'Draft name'))

    const locs = await getIapLocalizations('p', 'IAP')

    expect(locs).toEqual([{ id: 'L2', locale: 'en-US', name: 'Draft name', description: '' }])
    expect(requestsTo('/v1/inAppPurchaseVersions')).toHaveLength(0)
  })

  it('falls back to the newest shipped version when nothing is editable', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V1', 1, 'REPLACED_WITH_NEW_VERSION'), version('V2', 2, 'APPROVED'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () =>
      versionsRoute(localization('L2', 'ja'))

    expect(await getIapLocalizations('p', 'IAP')).toHaveLength(1)
    expect(requestsTo('/v1/inAppPurchaseVersions')).toHaveLength(0)
  })

  it('fails loudly when the product has no versions at all', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () => versionsRoute()

    // Returning [] would be indistinguishable from "no locales configured" and
    // would let export write the product out with its localizations missing.
    await expect(getIapLocalizations('p', 'IAP')).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })
})

describe('createIapLocalization', () => {
  it('creates a draft version first when every version is frozen', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V1', 1, 'APPROVED'))
    routes['POST /v1/inAppPurchaseVersions'] = () => ({ data: { id: 'V2' } })
    routes['POST /v2/inAppPurchaseLocalizations'] = () => ({ data: localization('L9', 'de') })

    await createIapLocalization('p', 'IAP', { locale: 'de', name: 'Neu' })

    const [created] = requestsTo('/v1/inAppPurchaseVersions')
    expect(created.body.data.relationships.inAppPurchase.data).toEqual({
      type: 'inAppPurchases',
      id: 'IAP'
    })
    const [loc] = requestsTo('/v2/inAppPurchaseLocalizations')
    expect(loc.body.data.relationships.version.data).toEqual({
      type: 'inAppPurchaseVersions',
      id: 'V2'
    })
  })

  it('reuses a version that already exists when the create loses a race', async () => {
    let listed = 0
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      ++listed === 1
        ? versionsRoute(version('V1', 1, 'APPROVED'))
        : versionsRoute(version('V1', 1, 'APPROVED'), version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['POST /v1/inAppPurchaseVersions'] = () => new Error('409')
    routes['POST /v2/inAppPurchaseLocalizations'] = () => ({ data: localization('L9', 'de') })

    await createIapLocalization('p', 'IAP', { locale: 'de', name: 'Neu' })

    const [loc] = requestsTo('/v2/inAppPurchaseLocalizations')
    expect(loc.body.data.relationships.version.data.id).toBe('V2')
  })
})

describe('updateIapLocalization', () => {
  it('patches the draft copy of the locale, not the ID the caller was shown', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    // The locale under edit is deliberately not first in the list, so picking by
    // locale is distinguishable from picking whatever came back first.
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () =>
      versionsRoute(localization('DRAFT-JA', 'ja'), localization('DRAFT-L', 'en-US'))
    routes['PATCH /v2/inAppPurchaseLocalizations/DRAFT-L'] = () => ({
      data: localization('DRAFT-L', 'en-US', 'Renamed')
    })

    // The detail modal would be holding the ID from the shipped version, not this one.
    const updated = await updateIapLocalization('p', 'IAP', 'en-US', { name: 'Renamed' })

    expect(updated.name).toBe('Renamed')
    expect(requestsTo('/v2/inAppPurchaseLocalizations/DRAFT-L')[0].method).toBe('PATCH')
    expect(requestsTo('/v2/inAppPurchaseLocalizations/DRAFT-JA')).toHaveLength(0)
  })

  it('creates the locale when the editable version does not carry it yet', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () => versionsRoute()
    routes['POST /v2/inAppPurchaseLocalizations'] = () => ({ data: localization('NEW', 'fr') })

    await updateIapLocalization('p', 'IAP', 'fr', { name: 'Nouveau' })

    expect(requestsTo('/v2/inAppPurchaseLocalizations')).toHaveLength(1)
  })

  it('refuses to create a missing locale without a name', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () => versionsRoute()

    await expect(updateIapLocalization('p', 'IAP', 'fr', { description: 'x' })).rejects.toThrow()
    expect(requestsTo('/v2/inAppPurchaseLocalizations')).toHaveLength(0)
  })
})

describe('deleteIapLocalization', () => {
  it('deletes the draft copy of the locale', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () =>
      versionsRoute(localization('DRAFT-JA', 'ja'), localization('DRAFT-L', 'en-US'))
    routes['DELETE /v2/inAppPurchaseLocalizations/DRAFT-L'] = () => ({})

    await deleteIapLocalization('p', 'IAP', 'en-US')

    expect(requestsTo('/v2/inAppPurchaseLocalizations/DRAFT-L')[0].method).toBe('DELETE')
    expect(requestsTo('/v2/inAppPurchaseLocalizations/DRAFT-JA')).toHaveLength(0)
  })

  it('fails loudly when the locale is absent from the editable version', async () => {
    routes['GET /v2/inAppPurchases/IAP/versions'] = () =>
      versionsRoute(version('V2', 2, 'PREPARE_FOR_SUBMISSION'))
    routes['GET /v1/inAppPurchaseVersions/V2/localizations'] = () => versionsRoute()

    await expect(deleteIapLocalization('p', 'IAP', 'en-US')).rejects.toThrow()
  })
})
