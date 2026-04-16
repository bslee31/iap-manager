import { generateAppleJwt, clearTokenCache } from './apple-auth'
import { loadCredentials } from '../credential-store'
import type {
  AppleInAppPurchase,
  AppleApiListResponse,
  AppleApiResponse,
  CreateIapPayload,
  AvailabilityDetail,
  TerritoryInfo,
  IapLocalization,
  IapPriceInfo,
  IapPricePoint
} from './apple-types'

const API_BASE = 'https://api.appstoreconnect.apple.com'

async function appleRequest(
  projectId: string,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const creds = loadCredentials(projectId)
  if (!creds.apple) throw new Error('Apple 憑證未設定')

  const token = await generateAppleJwt(
    creds.apple.keyId,
    creds.apple.issuerId,
    creds.apple.privateKey
  )

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (!response.ok) {
    const body = await response.text()
    let errorMsg = `Apple API 錯誤 (${response.status})`
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

// Fetch all IAPs for an app, then fetch availability per product
export async function listInAppPurchases(
  projectId: string,
  onProgress?: ProgressCallback
): Promise<IapWithAvailability[]> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error('未設定 App ID')

  // Step 1: Fetch all IAPs
  onProgress?.(0, 0, '取得商品列表...')
  const allIaps: AppleInAppPurchase[] = []
  let url: string | null = `/v1/apps/${creds.apple.appId}/inAppPurchasesV2?limit=200`

  while (url) {
    const resp: AppleApiListResponse<AppleInAppPurchase> = await appleRequest(
      projectId,
      url
    )
    allIaps.push(...resp.data)
    onProgress?.(allIaps.length, 0, `已取得 ${allIaps.length} 個商品...`)
    url = resp.links?.next || null
  }

  // Step 2: Fetch availability for all IAPs in parallel (concurrency limited)
  const CONCURRENCY = 5
  const BATCH_DELAY = 1000 // 1 second between batches
  const MAX_RETRIES = 2

  async function fetchAvailability(iap: AppleInAppPurchase): Promise<IapWithAvailability> {
    let territoryCount = 0
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const availResp = await appleRequest(
          projectId,
          `/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`
        )
        if (availResp.data?.id) {
          const terrResp = await appleRequest(
            projectId,
            `/v1/inAppPurchaseAvailabilities/${availResp.data.id}/availableTerritories?limit=200`
          )
          territoryCount = terrResp.data?.length ?? 0
        }
        break // success
      } catch (e: any) {
        if (attempt < MAX_RETRIES && (e.message?.includes('429') || e.message?.includes('rate'))) {
          // Rate limited — wait and retry
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
        }
        // Last attempt or non-rate-limit error: leave as 0
      }
    }
    return { iap, territoryCount }
  }

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Process in batches of CONCURRENCY with delay between batches
  const total = allIaps.length
  const results: IapWithAvailability[] = []
  for (let i = 0; i < allIaps.length; i += CONCURRENCY) {
    if (i > 0) await delay(BATCH_DELAY)
    const batch = allIaps.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(fetchAvailability))
    results.push(...batchResults)
    onProgress?.(results.length, total, `查詢 Availability... ${results.length}/${total}`)
  }

  return results
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
  if (!appId) throw new Error('未設定 App ID')

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

export async function deleteInAppPurchase(
  projectId: string,
  iapId: string
): Promise<void> {
  await appleRequest(projectId, `/v2/inAppPurchases/${iapId}`, {
    method: 'DELETE'
  })
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
      failed: iapIds.map((id) => ({ id, error: '無法取得地區列表: ' + e.message }))
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

export async function getAllTerritories(
  projectId: string
): Promise<TerritoryInfo[]> {
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
  let url: string | null =
    `/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=200`
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
          inAppPurchase: {
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
  const resp = await appleRequest(
    projectId,
    `/v1/inAppPurchaseLocalizations/${localizationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'inAppPurchaseLocalizations',
          id: localizationId,
          attributes: data
        }
      })
    }
  )
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
  await appleRequest(
    projectId,
    `/v1/inAppPurchaseLocalizations/${localizationId}`,
    { method: 'DELETE' }
  )
}

// ── Price Schedule ──

export async function getIapPriceSchedule(
  projectId: string,
  iapId: string
): Promise<IapPriceInfo[]> {
  try {
    const resp = await appleRequest(
      projectId,
      `/v2/inAppPurchases/${iapId}/iapPriceSchedule?include=manualPrices&fields[inAppPurchasePrices]=startDate,endDate`
    )

    if (!resp.data?.id) return []

    const manualPrices = resp.included || []
    const prices: IapPriceInfo[] = []

    for (const mp of manualPrices) {
      if (mp.type !== 'inAppPurchasePrices') continue
      // Fetch territory and price point details for each manual price
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

    return prices
  } catch {
    return []
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

// Test connection by fetching app info
export async function testConnection(projectId: string): Promise<void> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error('未設定 App ID')
  await appleRequest(projectId, `/v1/apps/${creds.apple.appId}`)
}

export { clearTokenCache }
