import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the Apple IAP API. validateImport only needs getAllTerritories;
// the rest are placeholders so the module imports cleanly.
const getAllTerritories = vi.fn()
vi.mock('./apple-iap', () => ({
  createInAppPurchase: vi.fn(),
  updateIapAvailability: vi.fn(),
  getAllTerritories: (projectId: string) => getAllTerritories(projectId),
  getIapPricePoints: vi.fn(),
  setIapPriceScheduleBatch: vi.fn(),
  createIapLocalization: vi.fn()
}))
vi.mock('../credential-store', () => ({ loadCredentials: vi.fn() }))

import { validateImport } from './apple-import'
import { EXPORT_FORMAT_VERSION } from './apple-types'

const TERRITORIES = [
  { id: 'USA', currency: 'USD' },
  { id: 'JPN', currency: 'JPY' },
  { id: 'TWN', currency: 'TWD' }
]

// Minimal valid product — individual tests mutate one field to assert
// only the failure they care about.
function validProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 'com.example.coins',
    referenceName: 'Coins 100',
    type: 'CONSUMABLE',
    availability: { territories: ['USA', 'JPN'], availableInNewTerritories: true },
    priceSchedule: {
      baseTerritory: 'USA',
      basePrice: '0.99',
      customPrices: [{ territory: 'JPN', price: '120' }]
    },
    localizations: [{ locale: 'en-US', name: 'Coins', description: '100 coins' }],
    ...overrides
  }
}

function wrap(products: unknown[]): string {
  return JSON.stringify({
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: '2026-04-28T00:00:00Z',
    appId: 'app-1',
    products
  })
}

describe('validateImport', () => {
  beforeEach(() => {
    getAllTerritories.mockReset()
    getAllTerritories.mockResolvedValue(TERRITORIES)
  })

  // ── File-level checks ──

  it('rejects malformed JSON', async () => {
    const r = await validateImport('p1', '{not json', [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('(file)')
  })

  it('rejects non-object root', async () => {
    const r = await validateImport('p1', '"a string"', [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('(root)')
  })

  it('rejects incompatible formatVersion', async () => {
    const r = await validateImport('p1', JSON.stringify({ formatVersion: 999, products: [] }), [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('formatVersion')
  })

  it('rejects empty products array', async () => {
    const r = await validateImport('p1', wrap([]), [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('products')
  })

  it('reports failure when territory fetch errors out', async () => {
    getAllTerritories.mockRejectedValueOnce(new Error('apple down'))
    const r = await validateImport('p1', wrap([validProduct()]), [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('(territories)')
    expect(r.issues[0].message).toContain('apple down')
  })

  // ── Happy path ──

  it('accepts a fully-valid product', async () => {
    const r = await validateImport('p1', wrap([validProduct()]), [])
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.territoryCurrencyMap).toEqual({ USA: 'USD', JPN: 'JPY', TWN: 'TWD' })
  })

  // ── productId ──

  it('rejects empty productId', async () => {
    const r = await validateImport('p1', wrap([validProduct({ productId: '' })]), [])
    expect(r.issues.some((i) => i.field === 'productId' && i.message.includes('不可為空'))).toBe(
      true
    )
  })

  it('rejects productId with disallowed characters', async () => {
    const r = await validateImport('p1', wrap([validProduct({ productId: 'has space' })]), [])
    expect(r.issues.some((i) => i.field === 'productId' && i.message.includes('英數'))).toBe(true)
  })

  it('rejects productId longer than 100 chars', async () => {
    const long = 'a'.repeat(101)
    const r = await validateImport('p1', wrap([validProduct({ productId: long })]), [])
    expect(r.issues.some((i) => i.field === 'productId' && i.message.includes('100'))).toBe(true)
  })

  it('flags duplicate productId within the same file', async () => {
    const r = await validateImport(
      'p1',
      wrap([validProduct({ productId: 'dup.id' }), validProduct({ productId: 'dup.id' })]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('檔案內有重複'))).toBe(true)
  })

  it('flags productId already present in the project', async () => {
    const r = await validateImport('p1', wrap([validProduct({ productId: 'existing.id' })]), [
      'existing.id'
    ])
    expect(r.issues.some((i) => i.message.includes('已存在於目前專案中'))).toBe(true)
  })

  // ── referenceName ──

  it('rejects empty referenceName', async () => {
    const r = await validateImport('p1', wrap([validProduct({ referenceName: '' })]), [])
    expect(r.issues.some((i) => i.field === 'referenceName')).toBe(true)
  })

  it('rejects referenceName longer than 64 chars', async () => {
    const long = 'a'.repeat(65)
    const r = await validateImport('p1', wrap([validProduct({ referenceName: long })]), [])
    expect(r.issues.some((i) => i.field === 'referenceName' && i.message.includes('64'))).toBe(true)
  })

  // ── type ──

  it('rejects unknown product type', async () => {
    const r = await validateImport('p1', wrap([validProduct({ type: 'BOGUS' })]), [])
    expect(r.issues.some((i) => i.field === 'type')).toBe(true)
  })

  // ── availability ──

  it('rejects unknown territory in availability', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          availability: { territories: ['USA', 'XXX'], availableInNewTerritories: true }
        })
      ]),
      []
    )
    expect(
      r.issues.some((i) => i.field === 'availability.territories' && i.message.includes('XXX'))
    ).toBe(true)
  })

  it('rejects non-boolean availableInNewTerritories', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({ availability: { territories: ['USA'], availableInNewTerritories: 'yes' } })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field === 'availability.availableInNewTerritories')).toBe(true)
  })

  // ── priceSchedule ──

  it('rejects non-numeric basePrice', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          priceSchedule: { baseTerritory: 'USA', basePrice: 'free' }
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field === 'priceSchedule.basePrice')).toBe(true)
  })

  it('rejects unknown baseTerritory', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          priceSchedule: { baseTerritory: 'XXX', basePrice: '0.99' }
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field === 'priceSchedule.baseTerritory')).toBe(true)
  })

  it('rejects customPrices that include the baseTerritory', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          priceSchedule: {
            baseTerritory: 'USA',
            basePrice: '0.99',
            customPrices: [{ territory: 'USA', price: '0.99' }]
          }
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('不可包含 baseTerritory'))).toBe(true)
  })

  it('rejects duplicate territories in customPrices', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          priceSchedule: {
            baseTerritory: 'USA',
            basePrice: '0.99',
            customPrices: [
              { territory: 'JPN', price: '120' },
              { territory: 'JPN', price: '130' }
            ]
          }
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('重複地區'))).toBe(true)
  })

  it('rejects unknown territory in customPrices', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          priceSchedule: {
            baseTerritory: 'USA',
            basePrice: '0.99',
            customPrices: [{ territory: 'XXX', price: '100' }]
          }
        })
      ]),
      []
    )
    expect(
      r.issues.some(
        (i) => i.field.includes('customPrices') && i.message.includes('無效的地區代碼: XXX')
      )
    ).toBe(true)
  })

  // ── Structural / null guards ──

  it('rejects a null product entry', async () => {
    const r = await validateImport('p1', wrap([null]), [])
    expect(r.valid).toBe(false)
    expect(r.issues.some((i) => i.field === '(root)')).toBe(true)
  })

  it('rejects null availability', async () => {
    const r = await validateImport('p1', wrap([validProduct({ availability: null })]), [])
    expect(r.issues.some((i) => i.field === 'availability')).toBe(true)
  })

  // ── localizations ──

  it('rejects duplicate locales', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          localizations: [
            { locale: 'en-US', name: 'A', description: 'a' },
            { locale: 'en-US', name: 'B', description: 'b' }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('重複的 locale'))).toBe(true)
  })

  it('rejects localization name over 35 chars', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          localizations: [{ locale: 'en-US', name: 'a'.repeat(36) }]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.name') && i.message.includes('35'))).toBe(true)
  })

  it('rejects localization description over 55 chars', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          localizations: [{ locale: 'en-US', name: 'OK', description: 'a'.repeat(56) }]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.description') && i.message.includes('55'))).toBe(
      true
    )
  })
})
