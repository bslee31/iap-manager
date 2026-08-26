import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same transport stub as the localization suite: assert on the requests that
// actually reach Apple rather than on mocked service functions.
const calls: { method: string; path: string; body?: any }[] = []
let fail: (path: string, body: any) => string | null = () => null

vi.mock('../http-retry', () => ({
  fetchWithRetry: async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.appstoreconnect.apple.com', '')
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method: init.method || 'GET', path, body })

    const message = fail(path, body)
    if (message) {
      return {
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ errors: [{ detail: message }] })
      }
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'AVAIL' } }),
      text: async () => ''
    }
  }
}))
vi.mock('../credential-store', () => ({
  loadCredentials: () => ({ apple: { keyId: 'K', issuerId: 'I', privateKey: 'P', appId: '123' } })
}))
vi.mock('./apple-auth', () => ({ generateAppleJwt: async () => 'jwt', clearTokenCache: vi.fn() }))

import { batchSetAvailability } from './apple-iap'

const writes = () => calls.filter((c) => c.path === '/v1/inAppPurchaseAvailabilities')
const targetOf = (call: { body?: any }) => call.body.data.relationships.inAppPurchase.data.id
const territoriesOf = (call: { body?: any }) =>
  call.body.data.relationships.availableTerritories.data.map((t: { id: string }) => t.id)

beforeEach(() => {
  calls.length = 0
  fail = () => null
})

describe('batchSetAvailability', () => {
  it('writes the same territory set once per product', async () => {
    const result = await batchSetAvailability('p', ['A', 'B', 'C'], ['TWN', 'JPN'], true)

    expect(result.success).toEqual(['A', 'B', 'C'])
    expect(result.failed).toEqual([])
    expect(writes()).toHaveLength(3)
    for (const call of writes()) {
      expect(call.method).toBe('POST')
      expect(territoriesOf(call)).toEqual(['TWN', 'JPN'])
      expect(call.body.data.attributes.availableInNewTerritories).toBe(true)
    }
    expect(writes().map(targetOf).sort()).toEqual(['A', 'B', 'C'])
  })

  it('never reads the current territories first', async () => {
    await batchSetAvailability('p', ['A'], ['TWN'], false)

    // The write is a full replace, so a read-modify-write round trip would be
    // wasted requests.
    expect(calls.every((c) => c.method === 'POST')).toBe(true)
  })

  it('carries availableInNewTerritories through as given', async () => {
    await batchSetAvailability('p', ['A'], ['TWN'], false)
    expect(writes()[0].body.data.attributes.availableInNewTerritories).toBe(false)
  })

  it('accepts an empty territory set, which is how a product is taken down', async () => {
    const result = await batchSetAvailability('p', ['A'], [], false)

    expect(result.success).toEqual(['A'])
    expect(territoriesOf(writes()[0])).toEqual([])
  })

  it('keeps going when one product fails and reports it by id', async () => {
    fail = (path, body) =>
      path === '/v1/inAppPurchaseAvailabilities' &&
      body.data.relationships.inAppPurchase.data.id === 'B'
        ? 'no price for TWN'
        : null

    const result = await batchSetAvailability('p', ['A', 'B', 'C'], ['TWN'], true)

    expect(result.success).toEqual(['A', 'C'])
    expect(result.failed).toEqual([{ id: 'B', error: 'no price for TWN' }])
    expect(writes()).toHaveLength(3)
  })

  it('reports in the order the products were given, not the order Apple answered', async () => {
    fail = (path, body) =>
      ['A', 'C'].includes(body?.data?.relationships?.inAppPurchase?.data?.id) ? 'boom' : null

    const result = await batchSetAvailability('p', ['C', 'B', 'A'], ['TWN'], true)

    expect(result.failed.map((f) => f.id)).toEqual(['C', 'A'])
  })

  it('does nothing when no products are selected', async () => {
    const result = await batchSetAvailability('p', [], ['TWN'], true)

    expect(result).toEqual({ success: [], failed: [] })
    expect(calls).toHaveLength(0)
  })
})
