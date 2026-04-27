import { googleRequest, getPackageName } from './google-auth'

export interface GoogleProductItem {
  productId: string
  name: string
  description: string
  status: string
  purchaseOptionId?: string
  purchaseOptionCount?: number
  activePurchaseOptionCount?: number
  // Primary PO's price at the project's base region, when resolvable.
  // Stored as a formatted amount string (e.g. "200.00") plus currency code.
  basePrice?: string
  baseCurrency?: string
}

// Pick the representative PO for list-level display: Google guarantees at
// most one PO with buyOption.legacyCompatible=true per product (the "main"
// one). Fall back to first ACTIVE, then first overall.
function pickPrimaryPurchaseOption(purchaseOptions: any[]): any | null {
  if (!purchaseOptions.length) return null
  const legacy = purchaseOptions.find((po) => po.buyOption?.legacyCompatible === true)
  if (legacy) return legacy
  return purchaseOptions.find((po) => po.state === 'ACTIVE') || purchaseOptions[0]
}

function formatPriceAmount(units: string, nanos: number): string {
  const whole = units || '0'
  const frac = Math.round((nanos || 0) / 1e7)
    .toString()
    .padStart(2, '0')
  return `${whole}.${frac}`
}

// List one-time products (uses camelCase: oneTimeProducts).
// baseRegion, when provided, is used to extract the primary PO's price at
// that region for the list-level Price column.
// defaultLanguage, when provided, picks which listing's title/description
// populates the list row; falls back to the first listing if not set or
// not present.
export async function listOneTimeProducts(
  projectId: string,
  baseRegion?: string,
  defaultLanguage?: string
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
      // Get listing: prefer the project's defaultLanguage if set, otherwise
      // fall back to the first available listing — no hardcoded locale.
      let listing: any = {}
      if (Array.isArray(p.listings)) {
        listing =
          (defaultLanguage && p.listings.find((l: any) => l.languageCode === defaultLanguage)) ||
          p.listings[0] ||
          {}
      } else if (p.listings && typeof p.listings === 'object') {
        listing =
          (defaultLanguage && p.listings[defaultLanguage]) || Object.values(p.listings)[0] || {}
      }

      // Get purchase options info
      const purchaseOptions = Array.isArray(p.purchaseOptions) ? p.purchaseOptions : []
      const activePOs = purchaseOptions.filter((po: any) => po.state === 'ACTIVE')

      // Priority-based aggregation so the summary is deterministic and
      // independent of PO order returned by the API:
      //   ACTIVE > INACTIVE/INACTIVE_PUBLISHED > DRAFT > NO_PURCHASE_OPTION.
      let status = 'NO_PURCHASE_OPTION'
      if (purchaseOptions.length > 0) {
        if (activePOs.length > 0) {
          status = 'ACTIVE'
        } else if (
          purchaseOptions.some(
            (po: any) => po.state === 'INACTIVE' || po.state === 'INACTIVE_PUBLISHED'
          )
        ) {
          status = 'INACTIVE'
        } else {
          status = 'DRAFT'
        }
      }

      // Pick the primary PO once — used for both the list Price column and
      // the cached purchaseOptionId (which drives batch activate/deactivate).
      // Using the primary PO makes batch ops target the same "representative"
      // option the Price column and Status reflect, instead of whichever PO
      // happens to be active at sync time.
      const primaryPO = pickPrimaryPurchaseOption(purchaseOptions)

      let basePrice: string | undefined
      let baseCurrency: string | undefined
      if (baseRegion) {
        const cfg = primaryPO?.regionalPricingAndAvailabilityConfigs?.find(
          (c: any) => c.regionCode === baseRegion
        )
        if (cfg?.price) {
          basePrice = formatPriceAmount(cfg.price.units || '0', cfg.price.nanos || 0)
          baseCurrency = cfg.price.currencyCode
        }
      }

      allProducts.push({
        productId: p.productId || '',
        name: listing.title || p.productId || '',
        description: listing.description || '',
        status,
        purchaseOptionId: primaryPO?.purchaseOptionId || '',
        purchaseOptionCount: purchaseOptions.length,
        activePurchaseOptionCount: activePOs.length,
        basePrice,
        baseCurrency
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
      await googleRequest(projectId, `/oneTimeProducts/${pid}/purchaseOptions:batchUpdateStates`, {
        method: 'POST',
        body: { requests: [req] }
      })
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
export const REGIONS_VERSION = '2022/02'

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
export function parseProblematicRegions(message: string): string[] {
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

// Retry an operation that takes a list of region configs, dropping any
// regions Google rejects in the error message and trying again. Used by
// create / update / add purchase-option flows so a few mid-transition regions
// don't block the whole call. The cap exists only to prevent infinite loops:
// in practice we stop as soon as an error reveals no new region codes to
// drop. `T` lets callers use any config shape with a `regionCode` field.
const REGION_RETRY_LIMIT = 20

async function withRegionRetry<T extends { regionCode: string }, R>(
  initialConfigs: T[],
  send: (configs: T[]) => Promise<R>
): Promise<{ result: R; skippedRegions: string[] }> {
  let configs = initialConfigs
  const skipped: string[] = []
  let lastError = ''

  for (let attempt = 0; attempt < REGION_RETRY_LIMIT; attempt++) {
    try {
      const result = await send(configs)
      return { result, skippedRegions: skipped }
    } catch (e: any) {
      lastError = e?.message || ''
      const bad = parseProblematicRegions(lastError)
      // Only react to region codes we actually still have. If the same
      // region keeps appearing or no new codes are reported, the failure
      // isn't region-specific and we should propagate it.
      const newBad = bad.filter((code) => configs.some((c) => c.regionCode === code))
      if (newBad.length === 0) throw e
      skipped.push(...newBad)
      configs = configs.filter((c) => !newBad.includes(c.regionCode))
    }
  }
  throw new Error(`重試超過上限，Google 仍回報地區錯誤。最後錯誤：${lastError}`)
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
  const initialConfigs = regionalPrices.map((p) => ({
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

  return withRegionRetry(initialConfigs, (configs) =>
    googleRequest(projectId, `/onetimeproducts/${data.productId}?${params}`, {
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
    })
  )
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
  // True when Google Play marks this as the "Backwards compatible" PO —
  // the one seen by pre-Billing-Library-5 clients.
  legacyCompatible: boolean
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
      legacyCompatible: po.buyOption?.legacyCompatible === true,
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
  const initialConfigs = regionalPrices.map((p) => ({
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

  return withRegionRetry(initialConfigs, (configs) => {
    const poArray = currentPOs.map((po) =>
      po.purchaseOptionId === purchaseOptionId
        ? { ...po, regionalPricingAndAvailabilityConfigs: configs }
        : po
    )
    return googleRequest(projectId, `/onetimeproducts/${productId}?${params}`, {
      method: 'PATCH',
      body: { productId, purchaseOptions: poArray }
    })
  })
}

// Add a new purchase option (BUY, DRAFT) to an existing one-time product.
// Preserves existing purchase options. Base region is forced to the exact
// user-supplied price; other regions use Google's convertRegionPrices output.
export async function addPurchaseOption(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  basePrice: { currencyCode: string; units: string; nanos: number },
  baseRegionCode: string
): Promise<{ result: any; skippedRegions: string[] }> {
  const currentResp = await googleRequest(projectId, `/oneTimeProducts/${productId}`)
  const currentPOs: any[] = currentResp?.purchaseOptions || []
  if (currentPOs.some((po) => po.purchaseOptionId === purchaseOptionId)) {
    throw new Error(`Purchase Option 已存在：${purchaseOptionId}`)
  }

  const regionalPrices = await convertRegionPrices(projectId, basePrice)
  const initialConfigs = regionalPrices.map((p) => ({
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

  return withRegionRetry(initialConfigs, (configs) => {
    const newPO = {
      purchaseOptionId,
      state: 'DRAFT',
      buyOption: {
        legacyCompatible: false,
        multiQuantityEnabled: false
      },
      regionalPricingAndAvailabilityConfigs: configs
    }
    const poArray = [...currentPOs, newPO]
    return googleRequest(projectId, `/onetimeproducts/${productId}?${params}`, {
      method: 'PATCH',
      body: { productId, purchaseOptions: poArray }
    })
  })
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

// Flip the "Backwards compatible" flag (buyOption.legacyCompatible) to the
// given purchase option. Google allows at most one legacyCompatible PO per
// product, so we also clear the flag on every other BUY PO. RENT POs have
// no legacyCompatible concept and are preserved as-is.
export async function setLegacyCompatiblePurchaseOption(
  projectId: string,
  productId: string,
  purchaseOptionId: string
): Promise<void> {
  const currentResp = await googleRequest(projectId, `/oneTimeProducts/${productId}`)
  const currentPOs: any[] = currentResp?.purchaseOptions || []
  const target = currentPOs.find((po) => po.purchaseOptionId === purchaseOptionId)
  if (!target) {
    throw new Error(`找不到 Purchase Option：${purchaseOptionId}`)
  }
  if (!target.buyOption) {
    throw new Error('只有 BUY 型方案可以設為主方案')
  }

  const updatedPOs = currentPOs.map((po) => {
    if (!po.buyOption) return po
    return {
      ...po,
      buyOption: {
        ...po.buyOption,
        legacyCompatible: po.purchaseOptionId === purchaseOptionId
      }
    }
  })

  const params = new URLSearchParams({
    updateMask: 'purchaseOptions',
    'regionsVersion.version': REGIONS_VERSION
  })

  await googleRequest(projectId, `/onetimeproducts/${productId}?${params}`, {
    method: 'PATCH',
    body: { productId, purchaseOptions: updatedPOs }
  })
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
