import { googleRequest, getPackageName } from './google-auth'

export interface GoogleProductItem {
  productId: string
  name: string
  description: string
  status: string
  purchaseOptionId?: string
  purchaseOptionCount?: number
  defaultPrice?: string
}

// List one-time products (uses camelCase: oneTimeProducts)
export async function listOneTimeProducts(
  projectId: string
): Promise<GoogleProductItem[]> {
  const allProducts: GoogleProductItem[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (pageToken) params.set('pageToken', pageToken)
    params.set('pageSize', '100')
    const query = params.toString() ? `?${params}` : ''
    const resp = await googleRequest(projectId, `/oneTimeProducts${query}`)

    const products = resp.oneTimeProducts || []
    for (const p of products) {
      // Get listing: prefer zh-TW, then en-US, then first available
      let listing: any = {}
      if (Array.isArray(p.listings)) {
        listing = p.listings.find((l: any) => l.languageCode === 'zh-TW')
          || p.listings.find((l: any) => l.languageCode === 'en-US')
          || p.listings[0] || {}
      } else if (p.listings && typeof p.listings === 'object') {
        listing = p.listings['zh-TW'] || p.listings['en-US']
          || Object.values(p.listings)[0] || {}
      }

      // Get purchase options info
      const purchaseOptions = Array.isArray(p.purchaseOptions) ? p.purchaseOptions : []
      const activePO = purchaseOptions.find((po: any) => po.state === 'ACTIVE')
      const firstPO = purchaseOptions[0]

      // Determine status: if any PO is ACTIVE -> active, else use first PO state, else no PO
      let status = 'NO_PURCHASE_OPTION'
      if (activePO) {
        status = 'ACTIVE'
      } else if (firstPO) {
        status = firstPO.state || 'DRAFT'
      }

      allProducts.push({
        productId: p.productId || '',
        name: listing.title || p.productId || '',
        description: listing.description || '',
        status,
        purchaseOptionId: (activePO || firstPO)?.purchaseOptionId || '',
        purchaseOptionCount: purchaseOptions.length,
        defaultPrice: undefined
      })
    }

    pageToken = resp.nextPageToken
  } while (pageToken)

  return allProducts
}

// Batch activate/deactivate via purchaseOptions:batchUpdateStates
export async function batchUpdateStatus(
  projectId: string,
  productIds: string[],
  active: boolean,
  products: GoogleProductItem[]
): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
  const packageName = getPackageName(projectId)
  const success: string[] = []
  const failed: { id: string; error: string }[] = []

  // Build requests - need purchaseOptionId for each product
  const requests: any[] = []
  const requestProductIds: string[] = []

  for (const pid of productIds) {
    const product = products.find((p) => p.productId === pid)
    if (!product?.purchaseOptionId) {
      failed.push({ id: pid, error: '找不到 Purchase Option ID' })
      continue
    }

    const reqBody = active
      ? {
          activatePurchaseOptionRequest: {
            packageName,
            productId: pid,
            purchaseOptionId: product.purchaseOptionId
          }
        }
      : {
          deactivatePurchaseOptionRequest: {
            packageName,
            productId: pid,
            purchaseOptionId: product.purchaseOptionId
          }
        }

    requests.push(reqBody)
    requestProductIds.push(pid)
  }

  if (requests.length === 0) return { success, failed }

  // Process each product individually with its own endpoint
  for (let i = 0; i < requests.length; i++) {
    const pid = requestProductIds[i]
    const req = requests[i]
    try {
      const resp = await googleRequest(
        projectId,
        `/oneTimeProducts/${pid}/purchaseOptions:batchUpdateStates`,
        {
          method: 'POST',
          body: { requests: [req] }
        }
      )
      success.push(pid)
    } catch (e: any) {
      failed.push({ id: pid, error: e.message })
    }
  }

  return { success, failed }
}

export interface RegionInfo {
  regionCode: string
  currencyCode: string
}

export interface ConvertedPrice {
  regionCode: string
  currencyCode: string
  units: string
  nanos: number
}

// Used for onetimeproducts.patch. "2022/02" is currently the only accepted
// value; update when Google publishes a new regions version.
const REGIONS_VERSION = '2022/02'

// Fetch Google Play's supported regions and their currencies.
export async function fetchSupportedRegions(projectId: string): Promise<RegionInfo[]> {
  const resp = await googleRequest(projectId, '/pricing:convertRegionPrices', {
    method: 'POST',
    body: {
      price: { currencyCode: 'USD', units: '1', nanos: 0 }
    }
  })
  const converted = resp?.convertedRegionPrices || {}
  return Object.entries(converted).map(([regionCode, v]: [string, any]) => ({
    regionCode,
    currencyCode: v?.price?.currencyCode || ''
  }))
}

// Convert a base price to every supported region's local price via Google.
async function convertRegionPrices(
  projectId: string,
  basePrice: { currencyCode: string; units: string; nanos: number }
): Promise<ConvertedPrice[]> {
  const resp = await googleRequest(projectId, '/pricing:convertRegionPrices', {
    method: 'POST',
    body: { price: basePrice }
  })
  const converted = resp?.convertedRegionPrices || {}
  return Object.entries(converted).map(([regionCode, v]: [string, any]) => ({
    regionCode,
    currencyCode: v?.price?.currencyCode || '',
    units: v?.price?.units || '0',
    nanos: v?.price?.nanos || 0
  }))
}

export interface CreateOneTimeProductInput {
  productId: string
  name: string
  description: string
  languageCode: string
  purchaseOptionId: string
  baseRegionCode: string
  baseCurrencyCode: string
  basePriceUnits: string
  basePriceNanos: number
}

// Parse per-region errors out of the API response so we can drop the
// offending regions and retry. This covers mid-transition currency changes
// (e.g. BG joining the Eurozone after regionsVersion 2022/02) and regions
// that are no longer billable under the old version — without hard-coding
// region lists.
function parseProblematicRegions(message: string): string[] {
  const codes = new Set<string>()
  const patterns = [
    /Invalid currency for region code ([A-Z]{2,3})/g,
    /Region code ([A-Z]{2,3}) is not billable/g
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(message)) !== null) codes.add(m[1])
  }
  return [...codes]
}

// Create a DRAFT one-time product with a Buy purchase option and regional
// pricing converted from the user-supplied base price. Retries up to a few
// times dropping regions whose currency the patch endpoint rejects, so a few
// mid-transition regions don't block the whole create.
export async function createOneTimeProduct(
  projectId: string,
  data: CreateOneTimeProductInput
): Promise<{ result: any; skippedRegions: string[] }> {
  const regionalPrices = await convertRegionPrices(projectId, {
    currencyCode: data.baseCurrencyCode,
    units: data.basePriceUnits,
    nanos: data.basePriceNanos
  })

  // Google auto-rounds to "nice" market prices, which can shift the base
  // region's price. Force the base region to exactly what the user typed.
  let configs = regionalPrices.map((p) => ({
    regionCode: p.regionCode,
    availability: 'AVAILABLE' as const,
    price:
      p.regionCode === data.baseRegionCode
        ? {
            currencyCode: data.baseCurrencyCode,
            units: data.basePriceUnits,
            nanos: data.basePriceNanos
          }
        : {
            currencyCode: p.currencyCode,
            units: p.units,
            nanos: p.nanos
          }
  }))

  const params = new URLSearchParams({
    allowMissing: 'true',
    updateMask: 'listings,purchaseOptions',
    'regionsVersion.version': REGIONS_VERSION
  })

  const skipped: string[] = []
  let lastError = ''
  // Retry up to 20 times; each retry drops regions Google rejected. The limit
  // exists only to prevent infinite loops — in practice we stop as soon as an
  // error reveals no new region codes to drop.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const result = await googleRequest(
        projectId,
        `/onetimeproducts/${data.productId}?${params}`,
        {
          method: 'PATCH',
          body: {
            productId: data.productId,
            listings: [
              {
                languageCode: data.languageCode,
                title: data.name,
                description: data.description
              }
            ],
            purchaseOptions: [
              {
                purchaseOptionId: data.purchaseOptionId,
                state: 'DRAFT',
                buyOption: {
                  legacyCompatible: true,
                  multiQuantityEnabled: false
                },
                regionalPricingAndAvailabilityConfigs: configs
              }
            ]
          }
        }
      )
      return { result, skippedRegions: skipped }
    } catch (e: any) {
      lastError = e?.message || ''
      const bad = parseProblematicRegions(lastError)
      // Only keep codes we actually still have — if the same region keeps
      // appearing, something else is wrong and we should stop retrying.
      const newBad = bad.filter((code) => configs.some((c) => c.regionCode === code))
      if (newBad.length === 0) throw e
      skipped.push(...newBad)
      configs = configs.filter((c) => !newBad.includes(c.regionCode))
    }
  }
  throw new Error(`重試超過上限，Google 仍回報地區錯誤。最後錯誤：${lastError}`)
}

export interface OneTimeProductListing {
  languageCode: string
  title: string
  description: string
}

export interface OneTimeProductRegionalConfig {
  regionCode: string
  availability: string
  price?: { currencyCode: string; units: string; nanos: number }
}

export interface OneTimeProductPurchaseOption {
  purchaseOptionId: string
  state: string
  type: 'BUY' | 'RENT' | 'UNKNOWN'
  regionalConfigs: OneTimeProductRegionalConfig[]
}

export interface OneTimeProductDetail {
  productId: string
  listings: OneTimeProductListing[]
  purchaseOptions: OneTimeProductPurchaseOption[]
}

// Fetch a single one-time product (uses camelCase: oneTimeProducts).
export async function getOneTimeProduct(
  projectId: string,
  productId: string
): Promise<OneTimeProductDetail> {
  const resp = await googleRequest(projectId, `/oneTimeProducts/${productId}`)

  // listings may be returned as array or map; normalize to array.
  let listings: OneTimeProductListing[] = []
  if (Array.isArray(resp?.listings)) {
    listings = resp.listings.map((l: any) => ({
      languageCode: l.languageCode || '',
      title: l.title || '',
      description: l.description || ''
    }))
  } else if (resp?.listings && typeof resp.listings === 'object') {
    listings = Object.entries(resp.listings).map(([languageCode, l]: [string, any]) => ({
      languageCode,
      title: l?.title || '',
      description: l?.description || ''
    }))
  }

  const purchaseOptions: OneTimeProductPurchaseOption[] = (resp?.purchaseOptions || []).map(
    (po: any) => ({
      purchaseOptionId: po.purchaseOptionId || '',
      state: po.state || 'UNKNOWN',
      type: po.buyOption ? 'BUY' : po.rentOption ? 'RENT' : 'UNKNOWN',
      regionalConfigs: (po.regionalPricingAndAvailabilityConfigs || []).map((c: any) => ({
        regionCode: c.regionCode || '',
        availability: c.availability || 'UNKNOWN',
        price: c.price
          ? {
              currencyCode: c.price.currencyCode || '',
              units: c.price.units || '0',
              nanos: c.price.nanos || 0
            }
          : undefined
      }))
    })
  )

  return {
    productId: resp?.productId || productId,
    listings,
    purchaseOptions
  }
}

// Update the regional pricing of a single purchase option. Other purchase
// options are preserved. Internally re-uses the same drop-and-retry logic as
// createOneTimeProduct to handle regions Google rejects.
export async function updatePurchaseOptionPricing(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  basePrice: { currencyCode: string; units: string; nanos: number },
  baseRegionCode: string
): Promise<{ result: any; skippedRegions: string[] }> {
  const regionalPrices = await convertRegionPrices(projectId, basePrice)
  // Raw fetch so we can preserve all fields on the other purchase options.
  const currentResp = await googleRequest(projectId, `/oneTimeProducts/${productId}`)
  const currentPOs: any[] = currentResp?.purchaseOptions || []
  if (!currentPOs.some((po) => po.purchaseOptionId === purchaseOptionId)) {
    throw new Error(`找不到 Purchase Option：${purchaseOptionId}`)
  }

  // Google auto-rounds to "nice" market prices, which can shift the base
  // region's price (e.g. TWD 200 -> 210). Force the base region to exactly
  // what the user typed so the UX matches expectation; other regions keep
  // Google's market-optimized conversions.
  let configs = regionalPrices.map((p) => ({
    regionCode: p.regionCode,
    availability: 'AVAILABLE' as const,
    price:
      p.regionCode === baseRegionCode
        ? {
            currencyCode: basePrice.currencyCode,
            units: basePrice.units,
            nanos: basePrice.nanos
          }
        : {
            currencyCode: p.currencyCode,
            units: p.units,
            nanos: p.nanos
          }
  }))

  const params = new URLSearchParams({
    updateMask: 'purchaseOptions',
    'regionsVersion.version': REGIONS_VERSION
  })

  const skipped: string[] = []
  let lastError = ''
  for (let attempt = 0; attempt < 20; attempt++) {
    const poArray = currentPOs.map((po) =>
      po.purchaseOptionId === purchaseOptionId
        ? { ...po, regionalPricingAndAvailabilityConfigs: configs }
        : po
    )
    try {
      const result = await googleRequest(
        projectId,
        `/onetimeproducts/${productId}?${params}`,
        {
          method: 'PATCH',
          body: { productId, purchaseOptions: poArray }
        }
      )
      return { result, skippedRegions: skipped }
    } catch (e: any) {
      lastError = e?.message || ''
      const bad = parseProblematicRegions(lastError)
      const newBad = bad.filter((code) => configs.some((c) => c.regionCode === code))
      if (newBad.length === 0) throw e
      skipped.push(...newBad)
      configs = configs.filter((c) => !newBad.includes(c.regionCode))
    }
  }
  throw new Error(`重試超過上限，Google 仍回報地區錯誤。最後錯誤：${lastError}`)
}

// Activate or deactivate a single purchase option.
export async function setPurchaseOptionState(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  active: boolean
): Promise<void> {
  const packageName = getPackageName(projectId)
  const reqBody = active
    ? { activatePurchaseOptionRequest: { packageName, productId, purchaseOptionId } }
    : { deactivatePurchaseOptionRequest: { packageName, productId, purchaseOptionId } }
  await googleRequest(
    projectId,
    `/oneTimeProducts/${productId}/purchaseOptions:batchUpdateStates`,
    {
      method: 'POST',
      body: { requests: [reqBody] }
    }
  )
}

// Replace all listings of a one-time product (create/update/delete via full
// replacement). Google's patch with updateMask=listings replaces the entire
// listings set with what we send.
export async function updateOneTimeProductListings(
  projectId: string,
  productId: string,
  listings: OneTimeProductListing[]
): Promise<OneTimeProductDetail> {
  const params = new URLSearchParams({
    updateMask: 'listings',
    'regionsVersion.version': REGIONS_VERSION
  })
  await googleRequest(projectId, `/onetimeproducts/${productId}?${params}`, {
    method: 'PATCH',
    body: {
      productId,
      listings
    }
  })
  return getOneTimeProduct(projectId, productId)
}

// Test connection
export async function testConnection(projectId: string): Promise<void> {
  await googleRequest(projectId, `/oneTimeProducts?pageSize=1`)
}
