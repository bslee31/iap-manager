import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import {
  listOneTimeProducts,
  createOneTimeProduct,
  batchUpdateStatus as googleBatchUpdateStatus,
  fetchSupportedRegions,
  getOneTimeProduct,
  updateOneTimeProductListings,
  setPurchaseOptionState,
  updatePurchaseOptionPricing,
  addPurchaseOption,
  setLegacyCompatiblePurchaseOption,
  type CreateOneTimeProductInput,
  type OneTimeProductListing
} from '../services/google/google-product'
import { fetchAppDefaultLanguage } from '../services/google/google-app'
import {
  exportGoogleProducts,
  buildGoogleExportFileName,
  type ExportGoogleProductInput
} from '../services/google/google-export'
import {
  validateImport as validateGoogleImport,
  executeImport as executeGoogleImport
} from '../services/google/google-import'
import type { ExportedGoogleProduct } from '../services/google/google-types'
import {
  getGoogleDefaultLanguage,
  setGoogleDefaultLanguage,
  getGoogleBaseRegion,
  setGoogleBaseRegion
} from '../db/repositories/google-settings.repo'
import { loadCredentials } from '../services/credential-store'
import { getDatabase } from '../db/database'
import { sanitizeError } from './sanitize-error'

export function registerGoogleHandlers(): void {
  ipcMain.handle('google:fetch-products', async (event, projectId: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.send('sync:progress', {
        current: 0,
        total: 0,
        phase: '正在從 Google Play 同步...'
      })
      const baseRegion = getGoogleBaseRegion(projectId) || undefined
      const defaultLanguage = getGoogleDefaultLanguage(projectId) || undefined
      const products = await listOneTimeProducts(projectId, baseRegion, defaultLanguage)
      win?.webContents.send('sync:progress', {
        current: products.length,
        total: products.length,
        phase: `已取得 ${products.length} 個商品`
      })
      // Cache to local DB
      const db = getDatabase()
      const now = new Date().toISOString()
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO google_products (id, project_id, product_id, name, description, status, purchase_option_id, purchase_option_count, active_purchase_option_count, base_price, base_currency, sort_order, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const tx = db.transaction(() => {
        let idx = 0
        for (const p of products) {
          upsert.run(
            p.productId,
            projectId,
            p.productId,
            p.name,
            p.description,
            p.status,
            p.purchaseOptionId || null,
            p.purchaseOptionCount ?? 0,
            p.activePurchaseOptionCount ?? 0,
            p.basePrice || null,
            p.baseCurrency || null,
            idx++,
            now
          )
        }
      })
      tx()

      return {
        success: true,
        data: products.map((p) => ({ ...p, syncedAt: now }))
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('google:get-cached-products', async (_event, projectId: string) => {
    try {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM google_products WHERE project_id = ? ORDER BY sort_order')
        .all(projectId) as any[]
      return {
        success: true,
        data: rows.map((r: any) => ({
          productId: r.product_id,
          name: r.name,
          description: r.description,
          status: r.status,
          purchaseOptionId: r.purchase_option_id || '',
          purchaseOptionCount: r.purchase_option_count ?? 0,
          activePurchaseOptionCount: r.active_purchase_option_count ?? 0,
          basePrice: r.base_price || undefined,
          baseCurrency: r.base_currency || undefined,
          syncedAt: r.synced_at
        }))
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'google:create-product',
    async (_event, projectId: string, data: CreateOneTimeProductInput) => {
      try {
        if (!data.languageCode) return { success: false, error: '請選擇語言' }
        if (!data.baseRegionCode) return { success: false, error: '請選擇基準國家' }
        if (!data.baseCurrencyCode) return { success: false, error: '請選擇基準幣別' }
        if (!data.purchaseOptionId) return { success: false, error: '請填寫 Purchase Option ID' }
        const { result, skippedRegions } = await createOneTimeProduct(projectId, data)
        // Remember the chosen base region as the project default if none set,
        // so detail views can show it first.
        if (!getGoogleBaseRegion(projectId)) {
          setGoogleBaseRegion(projectId, data.baseRegionCode)
        }
        return { success: true, data: result, skippedRegions }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:get-product-detail',
    async (_event, projectId: string, productId: string) => {
      try {
        const data = await getOneTimeProduct(projectId, productId)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:update-listings',
    async (_event, projectId: string, productId: string, listings: OneTimeProductListing[]) => {
      try {
        const data = await updateOneTimeProductListings(projectId, productId, listings)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:set-po-state',
    async (
      _event,
      projectId: string,
      productId: string,
      purchaseOptionId: string,
      active: boolean
    ) => {
      try {
        await setPurchaseOptionState(projectId, productId, purchaseOptionId, active)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:update-po-pricing',
    async (
      _event,
      projectId: string,
      productId: string,
      purchaseOptionId: string,
      basePrice: { currencyCode: string; units: string; nanos: number },
      baseRegionCode: string
    ) => {
      try {
        const { result, skippedRegions } = await updatePurchaseOptionPricing(
          projectId,
          productId,
          purchaseOptionId,
          basePrice,
          baseRegionCode
        )
        return { success: true, data: result, skippedRegions }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:add-purchase-option',
    async (
      _event,
      projectId: string,
      productId: string,
      purchaseOptionId: string,
      basePrice: { currencyCode: string; units: string; nanos: number },
      baseRegionCode: string
    ) => {
      try {
        const { result, skippedRegions } = await addPurchaseOption(
          projectId,
          productId,
          purchaseOptionId,
          basePrice,
          baseRegionCode
        )
        return { success: true, data: result, skippedRegions }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:set-legacy-compatible',
    async (_event, projectId: string, productId: string, purchaseOptionId: string) => {
      try {
        await setLegacyCompatiblePurchaseOption(projectId, productId, purchaseOptionId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:export-products',
    async (event, projectId: string, products: ExportGoogleProductInput[]) => {
      try {
        if (!products || products.length === 0) {
          return { success: false, error: '沒有可匯出的商品' }
        }

        const win = BrowserWindow.fromWebContents(event.sender)
        const creds = loadCredentials(projectId)
        const packageName = creds.google?.packageName || 'unknown'

        const saveResult = await dialog.showSaveDialog(win!, {
          title: '匯出 Google One-time Products',
          defaultPath: buildGoogleExportFileName(packageName),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, data: { cancelled: true } }
        }

        const onProgress = (current: number, total: number, phase: string): void => {
          win?.webContents.send('export:progress', { current, total, phase })
        }

        const { data, errors } = await exportGoogleProducts(projectId, products, onProgress)

        writeFileSync(saveResult.filePath, JSON.stringify(data, null, 2), 'utf-8')

        return {
          success: true,
          data: {
            cancelled: false,
            filePath: saveResult.filePath,
            total: products.length,
            exported: data.products.length,
            errors
          }
        }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:import-validate',
    async (_event, projectId: string, fileContent: string, existingProductIds: string[]) => {
      try {
        const preview = await validateGoogleImport(projectId, fileContent, existingProductIds)
        return { success: true, data: preview }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:import-execute',
    async (event, projectId: string, products: ExportedGoogleProduct[]) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        const onProgress = (current: number, total: number, phase: string): void => {
          win?.webContents.send('import:progress', { current, total, phase })
        }
        const { results } = await executeGoogleImport(projectId, products, onProgress)
        return { success: true, data: { results } }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('google:get-regions', async (_event, projectId: string) => {
    try {
      const regions = await fetchSupportedRegions(projectId)
      return { success: true, data: regions }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('google:get-settings', async (_event, projectId: string) => {
    try {
      return {
        success: true,
        data: {
          defaultLanguage: getGoogleDefaultLanguage(projectId),
          baseRegion: getGoogleBaseRegion(projectId)
        }
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'google:set-base-region',
    async (_event, projectId: string, regionCode: string | null) => {
      try {
        setGoogleBaseRegion(projectId, regionCode)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'google:set-default-language',
    async (_event, projectId: string, languageCode: string | null) => {
      try {
        setGoogleDefaultLanguage(projectId, languageCode)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('google:detect-default-language', async (_event, projectId: string) => {
    try {
      const languageCode = await fetchAppDefaultLanguage(projectId)
      setGoogleDefaultLanguage(projectId, languageCode)
      return { success: true, data: { defaultLanguage: languageCode } }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'google:batch-status',
    async (_event, projectId: string, productIds: string[], active: boolean, products: any[]) => {
      try {
        const result = await googleBatchUpdateStatus(projectId, productIds, active, products)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )
}
