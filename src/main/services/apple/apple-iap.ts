import { generateAppleJwt, clearTokenCache } from './apple-auth'
import { loadCredentials } from '../credential-store'
import { fetchWithRetry } from '../http-retry'
import { t } from '../../i18n'
import type {
  AppleInAppPurchase,
  AppleApiListResponse,
  AppleApiResponse,
  CreateIapPayload,
  AvailabilityDetail,
  TerritoryInfo,
  IapLocalization,
  IapPriceInfo,
  IapPricePoint,
  TerritoryPrice
} from './apple-types'

const API_BASE = 'https://api.appstoreconnect.apple.com'
// Allowlist for absolute URLs — currently only the App Store Connect host.
const ALLOWED_HOSTS = new Set(['api.appstoreconnect.apple.com'])

async function appleRequest(
  projectId: string,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const creds = loadCredentials(projectId)
  if (!creds.apple) throw new Error(t('credentials.apple.notSet'))

  const token = await generateAppleJwt(
    creds.apple.keyId,
    creds.apple.issuerId,
    creds.apple.privateKey,
    projectId
  )

  // Restrict absolute URLs to the Apple API host. Anything else means the
  // caller (or a malformed pagination link) is trying to hit a different
  // origin with our bearer token — refuse rather than leak credentials.
  let url: string
  if (path.startsWith('http')) {
    let parsed: URL
    try {
      parsed = new URL(path)
    } catch {
      throw new Error(t('apple.api.invalidUrl', { path }))
    }
    if (!ALLOWED_HOSTS.has(parsed.host)) {
      throw new Error(t('apple.api.forbiddenHost', { host: parsed.host }))
    }
    url = path
  } else {
    url = `${API_BASE}${path}`
  }
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (!response.ok) {
    const body = await response.text()
    let errorMsg = t('apple.api.apiError', { status: response.status })
    try {
      const parsed = JSON.parse(body)
      if (parsed.errors?.[0]?.detail) {
        errorMsg = parsed.errors[0].detail
      }
    } catch {
      // use default message
    }
    throw new Error(errorMsg)
  }

  if (response.status === 204) return null
  return response.json()
}

export interface IapWithAvailability {
  iap: AppleInAppPurchase
  territoryCount: number
}

export type ProgressCallback = (current: number, total: number, phase: string) => void

// Fetch all IAPs for an app (without availability — use batch sync separately)
export async function listInAppPurchases(
  projectId: string,
  onProgress?: ProgressCallback
): Promise<IapWithAvailability[]> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error(t('credentials.apple.missingAppId'))

  onProgress?.(0, 0, t('apple.sync.fetchingList'))
  const allIaps: AppleInAppPurchase[] = []
  let url: string | null = `/v1/apps/${creds.apple.appId}/inAppPurchasesV2?limit=200`

  while (url) {
    const resp: AppleApiListResponse<AppleInAppPurchase> = await appleRequest(projectId, url)
    allIaps.push(...resp.data)
    onProgress?.(allIaps.length, 0, t('apple.sync.fetched', { count: allIaps.length }))
    url = resp.links?.next || null
  }

  return allIaps.map((iap) => ({ iap, territoryCount: -1 }))
}

export async function getInAppPurchase(
  projectId: string,
  iapId: string
): Promise<AppleInAppPurchase> {
  const resp: AppleApiResponse<AppleInAppPurchase> = await appleRequest(
    projectId,
    `/v2/inAppPurchases/${iapId}`
  )
  return resp.data
}

export async function createInAppPurchase(
  projectId: string,
  payload: CreateIapPayload
): Promise<AppleInAppPurchase> {
  const creds = loadCredentials(projectId)
  const appId = payload.appId || creds.apple?.appId
  if (!appId) throw new Error(t('credentials.apple.missingAppId'))

  const resp: AppleApiResponse<AppleInAppPurchase> = await appleRequest(
    projectId,
    '/v2/inAppPurchases',
    {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'inAppPurchases',
          attributes: {
            productId: payload.productId,
            name: payload.referenceName,
            inAppPurchaseType: payload.inAppPurchaseType,
            reviewNote: payload.reviewNote || ''
          },
          relationships: {
            app: {
              data: { type: 'apps', id: appId }
            }
          }
        }
      })
    }
  )
  return resp.data
}

export async function deleteInAppPurchase(projectId: string, iapId: string): Promise<void> {
  await appleRequest(projectId, `/v2/inAppPurchases/${iapId}`, {
    method: 'DELETE'
  })
}

// Update editable attributes on an IAP (currently just reference name).
// Apple rejects updates when the product is under review.
export async function updateInAppPurchase(
  projectId: string,
  iapId: string,
  attributes: { name?: string }
): Promise<AppleInAppPurchase> {
  const resp: AppleApiResponse<AppleInAppPurchase> = await appleRequest(
    projectId,
    `/v2/inAppPurchases/${iapId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'inAppPurchases',
          id: iapId,
          attributes
        }
      })
    }
  )
  return resp.data
}

// Fetch all available territory IDs from Apple
async function fetchAllTerritoryIds(projectId: string): Promise<string[]> {
  const allIds: string[] = []
  let url: string | null = '/v1/territories?limit=200'

  while (url) {
    const resp = await appleRequest(projectId, url)
    for (const t of resp.data) {
      allIds.push(t.id)
    }
    url = resp.links?.next || null
  }

  return allIds
}

// Get current availability for an IAP (returns availability ID + territory count)
// Uses the same endpoints as the batch sync to ensure consistency
export async function getExistingAvailability(
  projectId: string,
  iapId: string
): Promise<{ availabilityId: string; territoryIds: string[] } | null> {
  try {
    // Step 1: Get availability resource ID
    const availResp = await appleRequest(
      projectId,
      `/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`
    )
    if (!availResp.data?.id) return null

    // Step 2: Get territory list
    const terrResp = await appleRequest(
      projectId,
      `/v1/inAppPurchaseAvailabilities/${availResp.data.id}/availableTerritories?limit=200`
    )
    const territoryIds = (terrResp.data || []).map((t: any) => t.id)

    return {
      availabilityId: availResp.data.id,
      territoryIds
    }
  } catch {
    return null
  }
}

// Update availability for a single IAP
// - If no availability exists: POST to create one
// - If availability exists: POST replaces it (Apple treats POST as upsert per IAP)
async function setIapAvailability(
  projectId: string,
  iapId: string,
  territories: string[],
  availableInNewTerritories: boolean
): Promise<void> {
  await appleRequest(projectId, '/v1/inAppPurchaseAvailabilities', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchaseAvailabilities',
        attributes: {
          availableInNewTerritories
        },
        relationships: {
          inAppPurchase: {
            data: { type: 'inAppPurchases', id: iapId }
          },
          availableTerritories: {
            data: territories.map((tid) => ({ type: 'territories', id: tid }))
          }
        }
      }
    })
  })
}

// Batch update availability for multiple IAPs
export async function batchUpdateAvailability(
  projectId: string,
  iapIds: string[],
  activate: boolean
): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
  const success: string[] = []
  const failed: { id: string; error: string }[] = []

  // Pre-fetch all territory IDs once
  let allTerritories: string[]
  try {
    allTerritories = await fetchAllTerritoryIds(projectId)
  } catch (e: any) {
    return {
      success: [],
      failed: iapIds.map((id) => ({
        id,
        error: t('apple.iap.regionListFail', { error: e.message })
      }))
    }
  }

  for (const iapId of iapIds) {
    try {
      if (activate) {
        // 上架: set all territories
        await setIapAvailability(projectId, iapId, allTerritories, true)
      } else {
        // 下架: set empty territories
        // Apple requires at least the base territory, so we keep one and set availableInNewTerritories=false
        // Actually, to fully remove: pass empty array
        await setIapAvailability(projectId, iapId, [], false)
      }
      success.push(iapId)
    } catch (e: any) {
      failed.push({ id: iapId, error: e.message })
    }
  }

  return { success, failed }
}

// ── Availability Detail ──

export async function getIapAvailabilityDetail(
  projectId: string,
  iapId: string
): Promise<AvailabilityDetail> {
  try {
    const availResp = await appleRequest(
      projectId,
      `/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`
    )
    if (!availResp.data?.id) {
      return { availableInNewTerritories: false, territoryIds: [] }
    }

    const availableInNewTerritories = availResp.data.attributes?.availableInNewTerritories ?? false

    // Paginate territories
    const territoryIds: string[] = []
    let url: string | null =
      `/v1/inAppPurchaseAvailabilities/${availResp.data.id}/availableTerritories?limit=200`
    while (url) {
      const terrResp = await appleRequest(projectId, url)
      for (const t of terrResp.data || []) {
        territoryIds.push(t.id)
      }
      url = terrResp.links?.next || null
    }

    return { availableInNewTerritories, territoryIds }
  } catch {
    return { availableInNewTerritories: false, territoryIds: [] }
  }
}

export async function updateIapAvailability(
  projectId: string,
  iapId: string,
  territoryIds: string[],
  availableInNewTerritories: boolean
): Promise<void> {
  await setIapAvailability(projectId, iapId, territoryIds, availableInNewTerritories)
}

export async function getAllTerritories(projectId: string): Promise<TerritoryInfo[]> {
  const territories: TerritoryInfo[] = []
  let url: string | null = '/v1/territories?limit=200'
  while (url) {
    const resp = await appleRequest(projectId, url)
    for (const t of resp.data) {
      territories.push({ id: t.id, currency: t.attributes?.currency || '' })
    }
    url = resp.links?.next || null
  }
  return territories
}

// ── Localizations ──

export async function getIapLocalizations(
  projectId: string,
  iapId: string
): Promise<IapLocalization[]> {
  const localizations: IapLocalization[] = []
  let url: string | null = `/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=200`
  while (url) {
    const resp = await appleRequest(projectId, url)
    for (const loc of resp.data || []) {
      localizations.push({
        id: loc.id,
        locale: loc.attributes.locale,
        name: loc.attributes.name || '',
        description: loc.attributes.description || ''
      })
    }
    url = resp.links?.next || null
  }
  return localizations
}

export async function createIapLocalization(
  projectId: string,
  iapId: string,
  data: { locale: string; name: string; description?: string }
): Promise<IapLocalization> {
  const resp = await appleRequest(projectId, '/v1/inAppPurchaseLocalizations', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchaseLocalizations',
        attributes: {
          locale: data.locale,
          name: data.name,
          description: data.description || ''
        },
        relationships: {
          inAppPurchaseV2: {
            data: { type: 'inAppPurchases', id: iapId }
          }
        }
      }
    })
  })
  return {
    id: resp.data.id,
    locale: resp.data.attributes.locale,
    name: resp.data.attributes.name || '',
    description: resp.data.attributes.description || ''
  }
}

export async function updateIapLocalization(
  projectId: string,
  localizationId: string,
  data: { name?: string; description?: string }
): Promise<IapLocalization> {
  const resp = await appleRequest(projectId, `/v1/inAppPurchaseLocalizations/${localizationId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchaseLocalizations',
        id: localizationId,
        attributes: data
      }
    })
  })
  return {
    id: resp.data.id,
    locale: resp.data.attributes.locale,
    name: resp.data.attributes.name || '',
    description: resp.data.attributes.description || ''
  }
}

export async function deleteIapLocalization(
  projectId: string,
  localizationId: string
): Promise<void> {
  await appleRequest(projectId, `/v1/inAppPurchaseLocalizations/${localizationId}`, {
    method: 'DELETE'
  })
}

// ── Price Schedule ──

export async function getIapPriceSchedule(
  projectId: string,
  iapId: string
): Promise<{ baseTerritory: string; prices: IapPriceInfo[] }> {
  try {
    const resp = await appleRequest(
      projectId,
      `/v2/inAppPurchases/${iapId}/iapPriceSchedule?include=manualPrices,baseTerritory&fields[inAppPurchasePrices]=startDate,endDate`
    )

    if (!resp.data?.id) return { baseTerritory: '', prices: [] }

    const allIncluded = resp.included || []
    const baseTerrObj = allIncluded.find((i: any) => i.type === 'territories')
    const baseTerritory = baseTerrObj?.id || ''

    const manualPrices = allIncluded.filter((i: any) => i.type === 'inAppPurchasePrices')
    const prices: IapPriceInfo[] = []

    for (const mp of manualPrices) {
      try {
        const priceDetail = await appleRequest(
          projectId,
          `/v1/inAppPurchasePrices/${mp.id}?include=inAppPurchasePricePoint,territory`
        )
        const included = priceDetail.included || []
        const territory = included.find((i: any) => i.type === 'territories')
        const pricePoint = included.find((i: any) => i.type === 'inAppPurchasePricePoints')

        prices.push({
          startDate: mp.attributes?.startDate || null,
          endDate: mp.attributes?.endDate || null,
          territory: territory?.id || '',
          price: pricePoint?.attributes?.customerPrice || '',
          pricePointId: pricePoint?.id || ''
        })
      } catch {
        // skip individual price errors
      }
    }

    return { baseTerritory, prices }
  } catch {
    return { baseTerritory: '', prices: [] }
  }
}

export async function getIapPricePoints(
  projectId: string,
  iapId: string,
  territory: string
): Promise<IapPricePoint[]> {
  const points: IapPricePoint[] = []
  let url: string | null =
    `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=${territory}&limit=200`
  while (url) {
    const resp = await appleRequest(projectId, url)
    for (const pp of resp.data || []) {
      points.push({
        id: pp.id,
        customerPrice: pp.attributes?.customerPrice || '',
        proceeds: pp.attributes?.proceeds || '',
        territory
      })
    }
    url = resp.links?.next || null
  }
  return points
}

export async function setIapPriceSchedule(
  projectId: string,
  iapId: string,
  baseTerritory: string,
  pricePointId: string
): Promise<void> {
  const priceId = `\${new-price}`
  await appleRequest(projectId, '/v1/inAppPurchasePriceSchedules', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: {
            data: { type: 'inAppPurchases', id: iapId }
          },
          baseTerritory: {
            data: { type: 'territories', id: baseTerritory }
          },
          manualPrices: {
            data: [{ type: 'inAppPurchasePrices', id: priceId }]
          }
        }
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceId,
          attributes: {
            startDate: null,
            endDate: null
          },
          relationships: {
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: pricePointId }
            }
          }
        }
      ]
    })
  })
}

// Set full price schedule in one request: base + multiple manual prices
// Each pricePointId is already territory-scoped (Apple's API returns per-territory points)
export async function setIapPriceScheduleBatch(
  projectId: string,
  iapId: string,
  baseTerritory: string,
  pricePointIds: string[]
): Promise<void> {
  const priceData: any[] = []
  const priceIncluded: any[] = []

  pricePointIds.forEach((ppid, idx) => {
    const id = `\${price-${idx}}`
    priceData.push({ type: 'inAppPurchasePrices', id })
    priceIncluded.push({
      type: 'inAppPurchasePrices',
      id,
      attributes: { startDate: null, endDate: null },
      relationships: {
        inAppPurchasePricePoint: {
          data: { type: 'inAppPurchasePricePoints', id: ppid }
        }
      }
    })
  })

  await appleRequest(projectId, '/v1/inAppPurchasePriceSchedules', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: priceData }
        }
      },
      included: priceIncluded
    })
  })
}

// Set a manual price override for a specific territory
export async function setManualTerritoryPrice(
  projectId: string,
  iapId: string,
  territory: string,
  pricePointId: string
): Promise<void> {
  // 1. Get current schedule to find base territory and existing manual prices
  const scheduleResp = await appleRequest(
    projectId,
    `/v2/inAppPurchases/${iapId}/iapPriceSchedule?include=manualPrices,baseTerritory`
  )

  if (!scheduleResp.data?.id) throw new Error(t('apple.iap.noPriceSet'))

  const scheduleId = scheduleResp.data.id
  const allIncluded = scheduleResp.included || []
  const baseTerrObj = allIncluded.find((i: any) => i.type === 'territories')
  const baseTerritory = baseTerrObj?.id || ''

  if (!baseTerritory) throw new Error(t('apple.iap.missingBaseTerritory'))

  // 2. Get existing manual prices with their price points and territories
  const existingManual: { territory: string; pricePointId: string }[] = []
  let url: string | null =
    `/v1/inAppPurchasePriceSchedules/${scheduleId}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200`

  while (url) {
    const resp = await appleRequest(projectId, url)
    const included = resp.included || []
    const terrMap = new Map<string, string>()
    const ppMap = new Map<string, string>()
    for (const item of included) {
      if (item.type === 'territories') terrMap.set(item.id, item.id)
      if (item.type === 'inAppPurchasePricePoints') ppMap.set(item.id, item.id)
    }
    for (const price of resp.data || []) {
      const terrId = price.relationships?.territory?.data?.id
      const ppId = price.relationships?.inAppPurchasePricePoint?.data?.id
      if (terrId && ppId) {
        existingManual.push({ territory: terrId, pricePointId: ppId })
      }
    }
    url = resp.links?.next || null
  }

  // 3. Replace/add the target territory
  const manualPrices = existingManual.filter((m) => m.territory !== territory)
  manualPrices.push({ territory, pricePointId })

  // 4. Also need the base territory price point - get from current manual prices for base
  // The base territory price is always the first manual price
  const basePriceEntry = existingManual.find((m) => m.territory === baseTerritory)

  // Build the included array and data references
  const priceData: any[] = []
  const priceIncluded: any[] = []

  manualPrices.forEach((mp, idx) => {
    const id = `\${price-${idx}}`
    priceData.push({ type: 'inAppPurchasePrices', id })
    priceIncluded.push({
      type: 'inAppPurchasePrices',
      id,
      attributes: { startDate: null, endDate: null },
      relationships: {
        inAppPurchasePricePoint: {
          data: { type: 'inAppPurchasePricePoints', id: mp.pricePointId }
        }
      }
    })
  })

  // If base territory doesn't have a manual price, add it from existing
  if (basePriceEntry && !manualPrices.some((m) => m.territory === baseTerritory)) {
    const id = `\${price-base}`
    priceData.push({ type: 'inAppPurchasePrices', id })
    priceIncluded.push({
      type: 'inAppPurchasePrices',
      id,
      attributes: { startDate: null, endDate: null },
      relationships: {
        inAppPurchasePricePoint: {
          data: { type: 'inAppPurchasePricePoints', id: basePriceEntry.pricePointId }
        }
      }
    })
  }

  // 5. POST new price schedule
  await appleRequest(projectId, '/v1/inAppPurchasePriceSchedules', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: {
            data: { type: 'inAppPurchases', id: iapId }
          },
          baseTerritory: {
            data: { type: 'territories', id: baseTerritory }
          },
          manualPrices: {
            data: priceData
          }
        }
      },
      included: priceIncluded
    })
  })
}

// Get all territory equivalent prices for the current price schedule
export async function getIapAllTerritoryPrices(
  projectId: string,
  iapId: string
): Promise<{
  baseTerritory: string
  basePrice: string
  baseCurrency: string
  territoryPrices: TerritoryPrice[]
}> {
  const resp = await appleRequest(
    projectId,
    `/v2/inAppPurchases/${iapId}/iapPriceSchedule?include=baseTerritory`
  )

  if (!resp.data?.id) {
    return { baseTerritory: '', basePrice: '', baseCurrency: '', territoryPrices: [] }
  }

  const scheduleId = resp.data.id
  const baseTerrObj = (resp.included || []).find((i: any) => i.type === 'territories')
  const baseTerritory = baseTerrObj?.id || ''
  const baseCurrency = baseTerrObj?.attributes?.currency || ''

  // Fetch automatic prices (paginated)
  const territoryPrices: TerritoryPrice[] = []
  let basePrice = ''

  let url: string | null =
    `/v1/inAppPurchasePriceSchedules/${scheduleId}/automaticPrices?include=inAppPurchasePricePoint,territory&limit=200`

  while (url) {
    const pricesResp = await appleRequest(projectId, url)
    const included = pricesResp.included || []

    const territoryMap = new Map<string, any>()
    const pricePointMap = new Map<string, any>()
    for (const item of included) {
      if (item.type === 'territories') territoryMap.set(item.id, item)
      if (item.type === 'inAppPurchasePricePoints') pricePointMap.set(item.id, item)
    }

    for (const price of pricesResp.data || []) {
      const terrId = price.relationships?.territory?.data?.id
      const ppId = price.relationships?.inAppPurchasePricePoint?.data?.id
      const territory = terrId ? territoryMap.get(terrId) : null
      const pricePoint = ppId ? pricePointMap.get(ppId) : null

      if (territory && pricePoint) {
        const entry: TerritoryPrice = {
          territory: territory.id,
          currency: territory.attributes?.currency || '',
          customerPrice: pricePoint.attributes?.customerPrice || '',
          proceeds: pricePoint.attributes?.proceeds || '',
          isManual: false
        }
        territoryPrices.push(entry)
        if (territory.id === baseTerritory) {
          basePrice = entry.customerPrice
        }
      }
    }

    url = pricesResp.links?.next || null
  }

  // Also fetch manual prices (overrides)
  const manualTerritoryIds = new Set<string>()
  url = `/v1/inAppPurchasePriceSchedules/${scheduleId}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200`

  while (url) {
    const pricesResp = await appleRequest(projectId, url)
    const included = pricesResp.included || []

    const territoryMap = new Map<string, any>()
    const pricePointMap = new Map<string, any>()
    for (const item of included) {
      if (item.type === 'territories') territoryMap.set(item.id, item)
      if (item.type === 'inAppPurchasePricePoints') pricePointMap.set(item.id, item)
    }

    for (const price of pricesResp.data || []) {
      const terrId = price.relationships?.territory?.data?.id
      const ppId = price.relationships?.inAppPurchasePricePoint?.data?.id
      const territory = terrId ? territoryMap.get(terrId) : null
      const pricePoint = ppId ? pricePointMap.get(ppId) : null

      if (territory && pricePoint) {
        // Track which territories have manual overrides (excluding base)
        if (territory.id !== baseTerritory) {
          manualTerritoryIds.add(territory.id)
        }

        // Override the automatic price
        const idx = territoryPrices.findIndex((tp) => tp.territory === territory.id)
        const entry: TerritoryPrice = {
          territory: territory.id,
          currency: territory.attributes?.currency || '',
          customerPrice: pricePoint.attributes?.customerPrice || '',
          proceeds: pricePoint.attributes?.proceeds || '',
          isManual: false // will be set below
        }
        if (idx >= 0) territoryPrices[idx] = entry
        else territoryPrices.push(entry)

        if (territory.id === baseTerritory) {
          basePrice = entry.customerPrice
        }
      }
    }

    url = pricesResp.links?.next || null
  }

  // Mark manual overrides (excluding base territory)
  for (const tp of territoryPrices) {
    tp.isManual = manualTerritoryIds.has(tp.territory)
  }

  territoryPrices.sort((a, b) => a.territory.localeCompare(b.territory))

  return { baseTerritory, basePrice, baseCurrency, territoryPrices }
}

// Get app primary locale
export async function getAppPrimaryLocale(projectId: string): Promise<string> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error(t('credentials.apple.missingAppId'))
  const resp = await appleRequest(projectId, `/v1/apps/${creds.apple.appId}`)
  return resp.data?.attributes?.primaryLocale || 'en-US'
}

// Test connection by fetching app info
export async function testConnection(projectId: string): Promise<void> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error(t('credentials.apple.missingAppId'))
  await appleRequest(projectId, `/v1/apps/${creds.apple.appId}`)
}

export { clearTokenCache }
