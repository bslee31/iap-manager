import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import {
  listInAppPurchases,
  createInAppPurchase,
  updateInAppPurchase,
  batchUpdateAvailability,
  getExistingAvailability,
  getAppPrimaryLocale,
  getIapAllTerritoryPrices,
  setManualTerritoryPrice,
  getIapAvailabilityDetail,
  updateIapAvailability,
  getAllTerritories,
  getIapLocalizations,
  createIapLocalization,
  updateIapLocalization,
  deleteIapLocalization,
  getIapPriceSchedule,
  getIapPricePoints,
  setIapPriceSchedule
} from '../services/apple/apple-iap'
import { loadCredentials } from '../services/credential-store'
import { getDatabase } from '../db/database'
import type { CreateIapPayload, ExportedProduct } from '../services/apple/apple-types'
import {
  exportAppleProducts,
  buildExportFileName,
  type ExportProductInput
} from '../services/apple/apple-export'
import { validateImport, executeImport } from '../services/apple/apple-import'
import { sanitizeError } from './sanitize-error'
import { t } from '../i18n'

export function registerAppleHandlers(): void {
  ipcMain.handle('apple:fetch-products', async (event, projectId: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (current: number, total: number, phase: string) => {
        win?.webContents.send('sync:progress', { current, total, phase })
      }

      const results = await listInAppPurchases(projectId, onProgress)

      // Cache to local DB
      const db = getDatabase()
      const now = new Date().toISOString()
      const upsert = db.prepare(
        `INSERT INTO apple_products (id, project_id, product_id, reference_name, product_type, state, available, territory_count, sort_order, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           product_id = excluded.product_id,
           reference_name = excluded.reference_name,
           product_type = excluded.product_type,
           state = excluded.state,
           sort_order = excluded.sort_order,
           synced_at = excluded.synced_at`
      )
      const tx = db.transaction(() => {
        let idx = 0
        for (const { iap } of results) {
          upsert.run(
            iap.id,
            projectId,
            iap.attributes.productId,
            iap.attributes.referenceName || iap.attributes.name,
            iap.attributes.inAppPurchaseType,
            iap.attributes.state,
            idx++,
            now
          )
        }
      })
      tx()

      // Read back cached data (territory_count, base_price, base_currency)
      const cachedRows = db
        .prepare(
          'SELECT id, territory_count, base_price, base_currency FROM apple_products WHERE project_id = ?'
        )
        .all(projectId) as any[]
      const cacheMap = new Map<string, any>()
      for (const r of cachedRows) {
        cacheMap.set(r.id, r)
      }

      return {
        success: true,
        data: results.map(({ iap }) => {
          const cached = cacheMap.get(iap.id)
          return {
            id: iap.id,
            productId: iap.attributes.productId,
            referenceName: iap.attributes.referenceName || iap.attributes.name,
            type: iap.attributes.inAppPurchaseType,
            state: iap.attributes.state,
            territoryCount: cached?.territory_count ?? 0,
            basePrice: cached?.base_price || '',
            baseCurrency: cached?.base_currency || '',
            syncedAt: now
          }
        })
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('apple:get-cached-products', async (_event, projectId: string) => {
    try {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM apple_products WHERE project_id = ? ORDER BY sort_order')
        .all(projectId) as any[]
      return {
        success: true,
        data: rows.map((r: any) => ({
          id: r.id,
          productId: r.product_id,
          referenceName: r.reference_name,
          type: r.product_type,
          state: r.state,
          territoryCount: r.territory_count ?? 0,
          basePrice: r.base_price || '',
          baseCurrency: r.base_currency || '',
          syncedAt: r.synced_at
        }))
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('apple:sync-availability', async (_event, projectId: string, iapId: string) => {
    try {
      const avail = await getExistingAvailability(projectId, iapId)
      const territoryCount = avail ? avail.territoryIds.length : 0

      // Update DB
      const db = getDatabase()
      db.prepare('UPDATE apple_products SET territory_count = ?, available = ? WHERE id = ?').run(
        territoryCount,
        territoryCount > 0 ? 1 : 0,
        iapId
      )

      return { success: true, data: { territoryCount } }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'apple:create-product',
    async (_event, projectId: string, data: CreateIapPayload) => {
      try {
        const product = await createInAppPurchase(projectId, data)
        return { success: true, data: product }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:update-product',
    async (_event, projectId: string, iapId: string, updates: { referenceName?: string }) => {
      try {
        const attributes: { name?: string } = {}
        if (updates.referenceName !== undefined) attributes.name = updates.referenceName
        const product = await updateInAppPurchase(projectId, iapId, attributes)

        // Sync local cache
        const newRefName = product.attributes.referenceName || product.attributes.name
        const db = getDatabase()
        db.prepare('UPDATE apple_products SET reference_name = ? WHERE id = ?').run(
          newRefName,
          iapId
        )
        return { success: true, data: { referenceName: newRefName } }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:batch-availability',
    async (_event, projectId: string, iapIds: string[], activate: boolean) => {
      try {
        const result = await batchUpdateAvailability(projectId, iapIds, activate)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  // ── Apple IAP Detail (Availability, Localization, Price Schedule) ──

  ipcMain.handle(
    'apple:get-availability-detail',
    async (_event, projectId: string, iapId: string) => {
      try {
        const data = await getIapAvailabilityDetail(projectId, iapId)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:update-availability',
    async (
      _event,
      projectId: string,
      iapId: string,
      territoryIds: string[],
      availableInNewTerritories: boolean
    ) => {
      try {
        await updateIapAvailability(projectId, iapId, territoryIds, availableInNewTerritories)
        // Update DB
        const db = getDatabase()
        db.prepare('UPDATE apple_products SET territory_count = ?, available = ? WHERE id = ?').run(
          territoryIds.length,
          territoryIds.length > 0 ? 1 : 0,
          iapId
        )
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('apple:get-all-territories', async (_event, projectId: string) => {
    try {
      const data = await getAllTerritories(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('apple:get-localizations', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapLocalizations(projectId, iapId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'apple:create-localization',
    async (
      _event,
      projectId: string,
      iapId: string,
      data: { locale: string; name: string; description?: string }
    ) => {
      try {
        const loc = await createIapLocalization(projectId, iapId, data)
        return { success: true, data: loc }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:update-localization',
    async (
      _event,
      projectId: string,
      localizationId: string,
      data: { name?: string; description?: string }
    ) => {
      try {
        const loc = await updateIapLocalization(projectId, localizationId, data)
        return { success: true, data: loc }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:delete-localization',
    async (_event, projectId: string, localizationId: string) => {
      try {
        await deleteIapLocalization(projectId, localizationId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('apple:get-price-schedule', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapPriceSchedule(projectId, iapId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'apple:get-price-points',
    async (_event, projectId: string, iapId: string, territory: string) => {
      try {
        const data = await getIapPricePoints(projectId, iapId, territory)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:set-price-schedule',
    async (
      _event,
      projectId: string,
      iapId: string,
      baseTerritory: string,
      pricePointId: string
    ) => {
      try {
        await setIapPriceSchedule(projectId, iapId, baseTerritory, pricePointId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('apple:get-primary-locale', async (_event, projectId: string) => {
    try {
      const locale = await getAppPrimaryLocale(projectId)
      return { success: true, data: locale }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'apple:set-manual-territory-price',
    async (_event, projectId: string, iapId: string, territory: string, pricePointId: string) => {
      try {
        await setManualTerritoryPrice(projectId, iapId, territory, pricePointId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('apple:sync-base-price', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapAllTerritoryPrices(projectId, iapId)
      if (data.basePrice) {
        const db = getDatabase()
        db.prepare('UPDATE apple_products SET base_price = ?, base_currency = ? WHERE id = ?').run(
          data.basePrice,
          data.baseCurrency,
          iapId
        )
      }
      return { success: true, data: { basePrice: data.basePrice, baseCurrency: data.baseCurrency } }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'apple:get-all-territory-prices',
    async (_event, projectId: string, iapId: string) => {
      try {
        const data = await getIapAllTerritoryPrices(projectId, iapId)
        // Cache base price to local DB
        if (data.basePrice) {
          const db = getDatabase()
          db.prepare(
            'UPDATE apple_products SET base_price = ?, base_currency = ? WHERE id = ?'
          ).run(data.basePrice, data.baseCurrency, iapId)
        }
        return { success: true, data }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:export-products',
    async (event, projectId: string, products: ExportProductInput[]) => {
      try {
        if (!products || products.length === 0) {
          return { success: false, error: t('apple.export.noProducts') }
        }

        const win = BrowserWindow.fromWebContents(event.sender)
        const creds = loadCredentials(projectId)
        const appId = creds.apple?.appId || 'unknown'

        const saveResult = await dialog.showSaveDialog(win!, {
          title: t('apple.export.title'),
          defaultPath: buildExportFileName(appId),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, data: { cancelled: true } }
        }

        const onProgress = (current: number, total: number, phase: string): void => {
          win?.webContents.send('export:progress', { current, total, phase })
        }

        const { data, errors } = await exportAppleProducts(projectId, products, onProgress)

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
    'apple:import-validate',
    async (_event, projectId: string, fileContent: string, existingProductIds: string[]) => {
      try {
        const preview = await validateImport(projectId, fileContent, existingProductIds)
        return { success: true, data: preview }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'apple:import-execute',
    async (
      event,
      projectId: string,
      products: ExportedProduct[],
      territoryCurrencyMap: Record<string, string>
    ) => {
      try {
        if (!products || products.length === 0) {
          return { success: false, error: t('apple.import.noProducts') }
        }
        const win = BrowserWindow.fromWebContents(event.sender)
        const onProgress = (current: number, total: number, phase: string): void => {
          win?.webContents.send('import:progress', { current, total, phase })
        }
        const { results } = await executeImport(projectId, products, onProgress)

        // Write successfully created products to local cache so the UI reflects
        // the new rows without requiring a full re-sync. Fields are only written
        // when their corresponding step succeeded.
        const db = getDatabase()
        const now = new Date().toISOString()
        const maxRow = db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM apple_products WHERE project_id = ?'
          )
          .get(projectId) as { maxOrder: number }
        let nextOrder = maxRow.maxOrder + 1

        const upsert = db.prepare(
          `INSERT INTO apple_products (
             id, project_id, product_id, reference_name, product_type, state,
             available, territory_count, base_price, base_currency, sort_order, synced_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             product_id = excluded.product_id,
             reference_name = excluded.reference_name,
             product_type = excluded.product_type,
             state = excluded.state,
             available = excluded.available,
             territory_count = excluded.territory_count,
             base_price = excluded.base_price,
             base_currency = excluded.base_currency,
             synced_at = excluded.synced_at`
        )

        const productByProductId = new Map(products.map((p) => [p.productId, p]))

        const tx = db.transaction(() => {
          for (const r of results) {
            if (!r.created || !r.iapId) continue
            const product = productByProductId.get(r.productId)
            if (!product) continue

            const territoryCount = r.availabilityApplied
              ? product.availability.territories.length
              : 0
            const available = territoryCount > 0 ? 1 : 0
            const basePrice =
              r.priceApplied && product.priceSchedule ? product.priceSchedule.basePrice : ''
            const baseCurrency =
              r.priceApplied && product.priceSchedule
                ? territoryCurrencyMap[product.priceSchedule.baseTerritory] || ''
                : ''

            upsert.run(
              r.iapId,
              projectId,
              product.productId,
              product.referenceName,
              product.type,
              r.createdState || 'MISSING_METADATA',
              available,
              territoryCount,
              basePrice,
              baseCurrency,
              nextOrder++,
              now
            )
          }
        })
        tx()

        return { success: true, data: { results } }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )
}
