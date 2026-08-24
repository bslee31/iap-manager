import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchSupportedRegions = vi.fn()
const convertRegionPrices = vi.fn()
vi.mock('./google-product', () => ({
  REGIONS_VERSION: '2022/02',
  parseProblematicRegions: () => [],
  fetchSupportedRegions: (projectId: string) => fetchSupportedRegions(projectId),
  convertRegionPrices: (projectId: string, price: unknown) => convertRegionPrices(projectId, price)
}))
const googleRequest = vi.fn()
vi.mock('./google-auth', () => ({
  googleRequest: (projectId: string, path: string, init?: unknown) =>
    googleRequest(projectId, path, init)
}))

import { validateImport, executeImport } from './google-import'
import { GOOGLE_EXPORT_FORMAT_VERSION, type ExportedGoogleProduct } from './google-types'

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

describe('executeImport region auto-conversion (google)', () => {
  function product(productId: string, regions: Record<string, unknown>[]): ExportedGoogleProduct {
    return {
      productId,
      listings: [{ languageCode: 'zh-TW', title: 'T', description: 'D' }],
      purchaseOptions: [
        {
          purchaseOptionId: 'base',
          state: 'ACTIVE',
          type: 'BUY',
          legacyCompatible: true,
          regions: regions as never
        }
      ]
    }
  }

  const TW_990 = {
    regionCode: 'TW',
    availability: 'AVAILABLE',
    currencyCode: 'TWD',
    units: '990',
    nanos: 0
  }

  // Note TW comes back rounded to 1000 — Google's market-optimized price. The
  // file's 990 must survive.
  const CONVERTED = [
    { regionCode: 'TW', currencyCode: 'TWD', units: '1000', nanos: 0 },
    { regionCode: 'JP', currencyCode: 'JPY', units: '4800', nanos: 0 },
    { regionCode: 'US', currencyCode: 'USD', units: '29', nanos: 990_000_000 }
  ]

  function sentRegions(callIndex = 0): Record<string, any>[] {
    const body = googleRequest.mock.calls[callIndex][2].body
    return body.purchaseOptions[0].regionalPricingAndAvailabilityConfigs
  }

  beforeEach(() => {
    googleRequest.mockReset()
    googleRequest.mockResolvedValue({})
    convertRegionPrices.mockReset()
    convertRegionPrices.mockResolvedValue(CONVERTED)
  })

  it('sends only the file regions when auto-convert is off', async () => {
    const { results } = await executeImport('p1', [product('a', [TW_990])], {
      autoConvertRegions: false
    })
    expect(results[0].created).toBe(true)
    expect(convertRegionPrices).not.toHaveBeenCalled()
    expect(sentRegions().map((r) => r.regionCode)).toEqual(['TW'])
  })

  it('fills the remaining regions from the base-region price', async () => {
    await executeImport('p1', [product('a', [TW_990])], {
      autoConvertRegions: true,
      baseRegionCode: 'TW'
    })
    expect(convertRegionPrices).toHaveBeenCalledWith('p1', {
      currencyCode: 'TWD',
      units: '990',
      nanos: 0
    })
    const sent = sentRegions()
    expect(sent.map((r) => r.regionCode).sort()).toEqual(['JP', 'TW', 'US'])
    // File value wins over Google's rounded 1000.
    expect(sent.find((r) => r.regionCode === 'TW')!.price.units).toBe('990')
    expect(sent.find((r) => r.regionCode === 'US')!.price).toEqual({
      currencyCode: 'USD',
      units: '29',
      nanos: 990_000_000
    })
  })

  it('never overwrites a region the file already defines', async () => {
    const jpDisabled = {
      regionCode: 'JP',
      availability: 'NO_LONGER_AVAILABLE',
      currencyCode: 'JPY',
      units: '3000',
      nanos: 0
    }
    await executeImport('p1', [product('a', [TW_990, jpDisabled])], {
      autoConvertRegions: true,
      baseRegionCode: 'TW'
    })
    const jp = sentRegions().find((r) => r.regionCode === 'JP')!
    expect(jp.availability).toBe('NO_LONGER_AVAILABLE')
    expect(jp.price.units).toBe('3000')
  })

  it('fails the product (without creating it) when the PO has no base-region price', async () => {
    const usOnly = {
      regionCode: 'US',
      availability: 'AVAILABLE',
      currencyCode: 'USD',
      units: '30',
      nanos: 0
    }
    const { results } = await executeImport('p1', [product('a', [usOnly])], {
      autoConvertRegions: true,
      baseRegionCode: 'TW'
    })
    expect(results[0].created).toBe(false)
    expect(results[0].stepErrors[0].step).toBe('convert')
    expect(googleRequest).not.toHaveBeenCalled()
  })

  it('throws when auto-convert is on but no base region is configured', async () => {
    await expect(
      executeImport('p1', [product('a', [TW_990])], { autoConvertRegions: true })
    ).rejects.toThrow()
    expect(googleRequest).not.toHaveBeenCalled()
  })

  it('converts once for products sharing the same base price', async () => {
    await executeImport(
      'p1',
      [product('a', [TW_990]), product('b', [TW_990]), product('c', [{ ...TW_990, units: '340' }])],
      { autoConvertRegions: true, baseRegionCode: 'TW' }
    )
    expect(convertRegionPrices).toHaveBeenCalledTimes(2)
  })
})
