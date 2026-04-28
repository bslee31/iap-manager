import { describe, it, expect, vi, beforeEach } from 'vitest'

// validateImport only needs fetchSupportedRegions + REGIONS_VERSION +
// parseProblematicRegions; the rest are placeholders for the executeImport
// path and not exercised here.
const fetchSupportedRegions = vi.fn()
vi.mock('./google-product', () => ({
  REGIONS_VERSION: '2022/02',
  parseProblematicRegions: vi.fn(),
  fetchSupportedRegions: (projectId: string) => fetchSupportedRegions(projectId)
}))
vi.mock('./google-auth', () => ({ googleRequest: vi.fn() }))

import { validateImport } from './google-import'
import { GOOGLE_EXPORT_FORMAT_VERSION } from './google-types'

const REGIONS = [{ regionCode: 'US' }, { regionCode: 'JP' }, { regionCode: 'TW' }]

function validProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 'com.example.coins',
    listings: [{ languageCode: 'en-US', title: 'Coins', description: '100 coins' }],
    purchaseOptions: [
      {
        purchaseOptionId: 'default',
        type: 'BUY',
        state: 'ACTIVE',
        legacyCompatible: true,
        regions: [
          {
            regionCode: 'US',
            availability: 'AVAILABLE',
            currencyCode: 'USD',
            units: '0',
            nanos: 990_000_000
          }
        ]
      }
    ],
    ...overrides
  }
}

function wrap(products: unknown[]): string {
  return JSON.stringify({
    formatVersion: GOOGLE_EXPORT_FORMAT_VERSION,
    exportedAt: '2026-04-28T00:00:00Z',
    packageName: 'com.example.app',
    products
  })
}

describe('validateImport (google)', () => {
  beforeEach(() => {
    fetchSupportedRegions.mockReset()
    fetchSupportedRegions.mockResolvedValue(REGIONS)
  })

  // ── File-level checks ──

  it('rejects malformed JSON', async () => {
    const r = await validateImport('p1', '{not json', [])
    expect(r.valid).toBe(false)
    expect(r.issues[0].field).toBe('(file)')
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

  it('throws when supported-regions fetch fails (fail-closed)', async () => {
    fetchSupportedRegions.mockRejectedValueOnce(new Error('google down'))
    await expect(validateImport('p1', wrap([validProduct()]), [])).rejects.toThrow('google down')
  })

  // ── Happy path ──

  it('accepts a fully-valid product', async () => {
    const r = await validateImport('p1', wrap([validProduct()]), [])
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
  })

  // ── productId ──

  it('rejects productId starting with uppercase', async () => {
    const r = await validateImport('p1', wrap([validProduct({ productId: 'Coins' })]), [])
    expect(r.issues.some((i) => i.field === 'productId')).toBe(true)
  })

  it('rejects productId with hyphen (allowed for purchaseOptionId, not productId)', async () => {
    const r = await validateImport('p1', wrap([validProduct({ productId: 'a-b' })]), [])
    expect(r.issues.some((i) => i.field === 'productId')).toBe(true)
  })

  it('rejects productId longer than 139 chars', async () => {
    const long = 'a' + '1'.repeat(139)
    const r = await validateImport('p1', wrap([validProduct({ productId: long })]), [])
    expect(r.issues.some((i) => i.field === 'productId' && i.message.includes('139'))).toBe(true)
  })

  it('flags duplicate productId within file and pre-existing in project', async () => {
    const r = await validateImport(
      'p1',
      wrap([validProduct({ productId: 'dup.id' }), validProduct({ productId: 'dup.id' })]),
      ['dup.id']
    )
    expect(r.issues.some((i) => i.message.includes('檔案內有重複'))).toBe(true)
    expect(r.issues.some((i) => i.message.includes('已存在於目前專案中'))).toBe(true)
  })

  // ── listings ──

  it('rejects empty listings', async () => {
    const r = await validateImport('p1', wrap([validProduct({ listings: [] })]), [])
    expect(r.issues.some((i) => i.field === 'listings')).toBe(true)
  })

  it('rejects duplicate languageCode', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          listings: [
            { languageCode: 'en-US', title: 'A', description: 'a' },
            { languageCode: 'en-US', title: 'B', description: 'b' }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('重複的 languageCode'))).toBe(true)
  })

  it('rejects title over 55 chars', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          listings: [{ languageCode: 'en-US', title: 'a'.repeat(56), description: 'ok' }]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.title') && i.message.includes('55'))).toBe(true)
  })

  it('rejects description over 200 chars', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          listings: [{ languageCode: 'en-US', title: 'OK', description: 'a'.repeat(201) }]
        })
      ]),
      []
    )
    expect(
      r.issues.some((i) => i.field.endsWith('.description') && i.message.includes('200'))
    ).toBe(true)
  })

  // ── purchaseOptions ──

  it('rejects purchaseOptionId with underscore', async () => {
    // PO ID rules are stricter than product ID — no underscore or dot.
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              purchaseOptionId: 'bad_id'
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.purchaseOptionId'))).toBe(true)
  })

  it('rejects unsupported purchase option type (e.g. RENT)', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              type: 'RENT'
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.type'))).toBe(true)
  })

  it('rejects unknown PO state', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              state: 'BOGUS'
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.state'))).toBe(true)
  })

  it('rejects more than one legacyCompatible=true PO', async () => {
    const baseRegion = {
      regionCode: 'US',
      availability: 'AVAILABLE',
      currencyCode: 'USD',
      units: '0',
      nanos: 990_000_000
    }
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              purchaseOptionId: 'one',
              type: 'BUY',
              state: 'ACTIVE',
              legacyCompatible: true,
              regions: [baseRegion]
            },
            {
              purchaseOptionId: 'two',
              type: 'BUY',
              state: 'ACTIVE',
              legacyCompatible: true,
              regions: [baseRegion]
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('legacyCompatible=true'))).toBe(true)
  })

  // ── regions ──

  it('rejects unknown regionCode', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              regions: [
                {
                  regionCode: 'XX',
                  availability: 'AVAILABLE',
                  currencyCode: 'USD',
                  units: '0',
                  nanos: 0
                }
              ]
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.message.includes('Google 不支援的地區代碼'))).toBe(true)
  })

  it('rejects nanos out of [0, 1e9)', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              regions: [
                {
                  regionCode: 'US',
                  availability: 'AVAILABLE',
                  currencyCode: 'USD',
                  units: '0',
                  nanos: 1_000_000_000
                }
              ]
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.nanos'))).toBe(true)
  })

  it('rejects unknown availability value', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              regions: [
                {
                  regionCode: 'US',
                  availability: 'MAYBE',
                  currencyCode: 'USD',
                  units: '0',
                  nanos: 0
                }
              ]
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.availability'))).toBe(true)
  })

  it('rejects empty regions array', async () => {
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              ...(validProduct().purchaseOptions as Record<string, unknown>[])[0],
              regions: []
            }
          ]
        })
      ]),
      []
    )
    expect(r.issues.some((i) => i.field.endsWith('.regions'))).toBe(true)
  })

  it('rejects duplicate purchaseOptionId within the same product', async () => {
    const baseRegion = {
      regionCode: 'US',
      availability: 'AVAILABLE',
      currencyCode: 'USD',
      units: '0',
      nanos: 0
    }
    const r = await validateImport(
      'p1',
      wrap([
        validProduct({
          purchaseOptions: [
            {
              purchaseOptionId: 'dup',
              type: 'BUY',
              state: 'ACTIVE',
              legacyCompatible: true,
              regions: [baseRegion]
            },
            {
              purchaseOptionId: 'dup',
              type: 'BUY',
              state: 'ACTIVE',
              legacyCompatible: false,
              regions: [baseRegion]
            }
          ]
        })
      ]),
      []
    )
    expect(
      r.issues.some(
        (i) =>
          i.field.endsWith('.purchaseOptionId') && i.message.includes('重複的 purchaseOptionId')
      )
    ).toBe(true)
  })
})
