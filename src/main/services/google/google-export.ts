import { getPackageName } from './google-auth'
import { getOneTimeProduct } from './google-product'
import { runWithConcurrency, EXPORT_CONCURRENCY } from '../concurrency'
import {
  GOOGLE_EXPORT_FORMAT_VERSION,
  type ExportedGoogleProduct,
  type ExportedGooglePurchaseOption,
  type ExportedGoogleRegionPrice,
  type GoogleExportData,
  type GoogleExportError
} from './google-types'

export interface ExportGoogleProductInput {
  productId: string
}

export type GoogleExportProgressCallback = (
  current: number,
  total: number,
  phase: string
) => void

async function fetchProductForExport(
  projectId: string,
  productId: string
): Promise<ExportedGoogleProduct> {
  const detail = await getOneTimeProduct(projectId, productId)

  // Sort listings and regions so diffs between exports are meaningful.
  const listings = detail.listings
    .map((l) => ({
      languageCode: l.languageCode,
      title: l.title,
      description: l.description
    }))
    .sort((a, b) => a.languageCode.localeCompare(b.languageCode))

  const purchaseOptions: ExportedGooglePurchaseOption[] = detail.purchaseOptions.map((po) => {
    const regions: ExportedGoogleRegionPrice[] = po.regionalConfigs
      .map((c) => ({
        regionCode: c.regionCode,
        availability: c.availability,
        currencyCode: c.price?.currencyCode || '',
        units: c.price?.units || '0',
        nanos: c.price?.nanos || 0
      }))
      .sort((a, b) => a.regionCode.localeCompare(b.regionCode))

    return {
      purchaseOptionId: po.purchaseOptionId,
      state: po.state,
      type: po.type,
      legacyCompatible: po.legacyCompatible,
      regions
    }
  })

  // Stable PO order: legacyCompatible first, then by POid.
  purchaseOptions.sort((a, b) => {
    if (a.legacyCompatible !== b.legacyCompatible) return a.legacyCompatible ? -1 : 1
    return a.purchaseOptionId.localeCompare(b.purchaseOptionId)
  })

  return {
    productId: detail.productId,
    listings,
    purchaseOptions
  }
}

export async function exportGoogleProducts(
  projectId: string,
  products: ExportGoogleProductInput[],
  onProgress?: GoogleExportProgressCallback
): Promise<{ data: GoogleExportData; errors: GoogleExportError[] }> {
  const packageName = getPackageName(projectId)

  const total = products.length
  const errors: GoogleExportError[] = []
  const exported: ExportedGoogleProduct[] = []
  let done = 0

  onProgress?.(0, total, '開始匯出...')

  await runWithConcurrency(products, EXPORT_CONCURRENCY, async (product) => {
    try {
      const result = await fetchProductForExport(projectId, product.productId)
      exported.push(result)
    } catch (e: any) {
      errors.push({
        productId: product.productId,
        error: e.message || String(e)
      })
    } finally {
      done++
      onProgress?.(done, total, `匯出中 ${done}/${total}`)
    }
  })

  exported.sort((a, b) => a.productId.localeCompare(b.productId))

  const data: GoogleExportData = {
    formatVersion: GOOGLE_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    packageName,
    products: exported
  }

  return { data, errors }
}

export function buildGoogleExportFileName(packageName: string, date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  // Replace dots so the file extension stays unambiguous.
  const safePkg = packageName.replace(/\./g, '_')
  return `google-iap-export-${safePkg}-${stamp}.json`
}
