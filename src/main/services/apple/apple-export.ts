import { loadCredentials } from '../credential-store'
import {
  getIapAvailabilityDetail,
  getIapLocalizations,
  getIapAllTerritoryPrices
} from './apple-iap'
import { runWithConcurrency, EXPORT_CONCURRENCY } from '../concurrency'
import {
  EXPORT_FORMAT_VERSION,
  type ExportData,
  type ExportedProduct,
  type ExportError
} from './apple-types'

export interface ExportProductInput {
  id: string
  productId: string
  referenceName: string
  type: string
}

export type ExportProgressCallback = (current: number, total: number, phase: string) => void

async function fetchProductDetails(
  projectId: string,
  product: ExportProductInput
): Promise<ExportedProduct> {
  const [availability, localizations, priceData] = await Promise.all([
    getIapAvailabilityDetail(projectId, product.id),
    getIapLocalizations(projectId, product.id),
    getIapAllTerritoryPrices(projectId, product.id)
  ])

  const exported: ExportedProduct = {
    productId: product.productId,
    referenceName: product.referenceName,
    type: product.type,
    availability: {
      territories: [...availability.territoryIds].sort(),
      availableInNewTerritories: availability.availableInNewTerritories
    }
  }

  if (priceData.baseTerritory && priceData.basePrice) {
    const customPrices = priceData.territoryPrices
      .filter((tp) => tp.isManual && tp.territory !== priceData.baseTerritory)
      .map((tp) => ({ territory: tp.territory, price: tp.customerPrice }))
      .sort((a, b) => a.territory.localeCompare(b.territory))

    exported.priceSchedule = {
      baseTerritory: priceData.baseTerritory,
      basePrice: priceData.basePrice,
      ...(customPrices.length > 0 ? { customPrices } : {})
    }
  }

  if (localizations.length > 0) {
    exported.localizations = localizations
      .map((l) => ({
        locale: l.locale,
        name: l.name,
        description: l.description
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale))
  }

  return exported
}

export async function exportAppleProducts(
  projectId: string,
  products: ExportProductInput[],
  onProgress?: ExportProgressCallback
): Promise<{ data: ExportData; errors: ExportError[] }> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error('未設定 App ID')

  const total = products.length
  const errors: ExportError[] = []
  const exported: ExportedProduct[] = []
  let done = 0

  onProgress?.(0, total, '開始匯出...')

  await runWithConcurrency(products, EXPORT_CONCURRENCY, async (product) => {
    try {
      const result = await fetchProductDetails(projectId, product)
      exported.push(result)
    } catch (e: any) {
      errors.push({
        productId: product.productId,
        referenceName: product.referenceName,
        error: e.message || String(e)
      })
    } finally {
      done++
      onProgress?.(done, total, `匯出中 ${done}/${total}`)
    }
  })

  // Stable ordering by productId so diffs are meaningful
  exported.sort((a, b) => a.productId.localeCompare(b.productId))

  const data: ExportData = {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appId: creds.apple.appId,
    products: exported
  }

  return { data, errors }
}

export function buildExportFileName(appId: string, date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `iap-export-${appId}-${stamp}.json`
}
