import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import {
  findAllProjects,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects
} from './db/repositories/project.repo'
import {
  saveAppleCredentials,
  saveGoogleCredentials,
  loadCredentials,
  importFileDialog,
  deleteCredentials,
  type AppleCredentials,
  type GoogleCredentials
} from './services/credential-store'
import { getDatabase } from './db/database'
import {
  listInAppPurchases,
  createInAppPurchase,
  updateInAppPurchase,
  batchUpdateAvailability,
  getExistingAvailability,
  testConnection as testAppleConnection,
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
} from './services/apple/apple-iap'
import type { CreateIapPayload } from './services/apple/apple-types'
import {
  exportAppleProducts,
  buildExportFileName,
  type ExportProductInput
} from './services/apple/apple-export'
import {
  validateImport,
  executeImport
} from './services/apple/apple-import'
import type { ExportedProduct } from './services/apple/apple-types'
import {
  listOneTimeProducts,
  createOneTimeProduct,
  batchUpdateStatus as googleBatchUpdateStatus,
  testConnection as testGoogleConnection
} from './services/google/google-product'

export function registerIpcHandlers(): void {
  // ── Project CRUD ──

  ipcMain.handle('project:list', async () => {
    try {
      const projects = findAllProjects()
      return projects.map((p) => ({
        ...p,
        has_apple: !!p.has_apple,
        has_google: !!p.has_google
      }))
    } catch (e: any) {
      console.error('project:list error', e)
      return []
    }
  })

  ipcMain.handle('project:create', async (_event, data: { name: string; description?: string }) => {
    try {
      const project = createProject(data)
      return { success: true, data: project }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'project:update',
    async (_event, id: string, data: { name?: string; description?: string }) => {
      try {
        const project = updateProject(id, data)
        if (!project) return { success: false, error: '專案不存在' }
        return { success: true, data: project }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const deleted = deleteProject(id)
      if (deleted) deleteCredentials(id)
      if (!deleted) return { success: false, error: '專案不存在' }
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('project:reorder', async (_event, orderedIds: string[]) => {
    try {
      reorderProjects(orderedIds)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Credentials ──

  ipcMain.handle(
    'credential:save-apple',
    async (_event, projectId: string, creds: AppleCredentials) => {
      try {
        saveAppleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_apple = 1 WHERE project_id = ?').run(projectId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'credential:save-google',
    async (_event, projectId: string, creds: GoogleCredentials) => {
      try {
        saveGoogleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_google = 1 WHERE project_id = ?').run(projectId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('credential:get', async (_event, projectId: string) => {
    try {
      const creds = loadCredentials(projectId)
      return {
        success: true,
        data: {
          apple: creds.apple
            ? { keyId: creds.apple.keyId, issuerId: creds.apple.issuerId, appId: creds.apple.appId, hasPrivateKey: true }
            : null,
          google: creds.google
            ? { packageName: creds.google.packageName, hasServiceAccount: true }
            : null
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('credential:test-apple', async (_event, projectId: string) => {
    try {
      await testAppleConnection(projectId)
      return { success: true, message: 'Apple API 連線成功' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('credential:test-google', async (_event, projectId: string) => {
    try {
      await testGoogleConnection(projectId)
      return { success: true, message: 'Google API 連線成功' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'dialog:import-file',
    async (_event, filters: { name: string; extensions: string[] }[]) => {
      try {
        const content = await importFileDialog(filters)
        return { success: true, data: content }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  // ── Apple IAP ──

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
      const cachedRows = db.prepare('SELECT id, territory_count, base_price, base_currency FROM apple_products WHERE project_id = ?').all(projectId) as any[]
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
    } catch (e: any) {
      return { success: false, error: e.message }
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
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:sync-availability',
    async (_event, projectId: string, iapId: string) => {
      try {
        const avail = await getExistingAvailability(projectId, iapId)
        const territoryCount = avail ? avail.territoryIds.length : 0

        // Update DB
        const db = getDatabase()
        db.prepare(
          'UPDATE apple_products SET territory_count = ?, available = ? WHERE id = ?'
        ).run(territoryCount, territoryCount > 0 ? 1 : 0, iapId)

        return { success: true, data: { territoryCount } }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:create-product',
    async (_event, projectId: string, data: CreateIapPayload) => {
      try {
        const product = await createInAppPurchase(projectId, data)
        return { success: true, data: product }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:update-product',
    async (
      _event,
      projectId: string,
      iapId: string,
      updates: { referenceName?: string }
    ) => {
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
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:batch-availability',
    async (
      _event,
      projectId: string,
      iapIds: string[],
      activate: boolean
    ) => {
      try {
        const result = await batchUpdateAvailability(
          projectId,
          iapIds,
          activate
        )
        return { success: true, data: result }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  // ── Apple IAP Detail (Availability, Localization, Price Schedule) ──

  ipcMain.handle('apple:get-availability-detail', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapAvailabilityDetail(projectId, iapId)
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:update-availability',
    async (_event, projectId: string, iapId: string, territoryIds: string[], availableInNewTerritories: boolean) => {
      try {
        await updateIapAvailability(projectId, iapId, territoryIds, availableInNewTerritories)
        // Update DB
        const db = getDatabase()
        db.prepare(
          'UPDATE apple_products SET territory_count = ?, available = ? WHERE id = ?'
        ).run(territoryIds.length, territoryIds.length > 0 ? 1 : 0, iapId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('apple:get-all-territories', async (_event, projectId: string) => {
    try {
      const data = await getAllTerritories(projectId)
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('apple:get-localizations', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapLocalizations(projectId, iapId)
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:create-localization',
    async (_event, projectId: string, iapId: string, data: { locale: string; name: string; description?: string }) => {
      try {
        const loc = await createIapLocalization(projectId, iapId, data)
        return { success: true, data: loc }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:update-localization',
    async (_event, projectId: string, localizationId: string, data: { name?: string; description?: string }) => {
      try {
        const loc = await updateIapLocalization(projectId, localizationId, data)
        return { success: true, data: loc }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('apple:delete-localization', async (_event, projectId: string, localizationId: string) => {
    try {
      await deleteIapLocalization(projectId, localizationId)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('apple:get-price-schedule', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapPriceSchedule(projectId, iapId)
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('apple:get-price-points', async (_event, projectId: string, iapId: string, territory: string) => {
    try {
      const data = await getIapPricePoints(projectId, iapId, territory)
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:set-price-schedule',
    async (_event, projectId: string, iapId: string, baseTerritory: string, pricePointId: string) => {
      try {
        await setIapPriceSchedule(projectId, iapId, baseTerritory, pricePointId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('apple:get-primary-locale', async (_event, projectId: string) => {
    try {
      const locale = await getAppPrimaryLocale(projectId)
      return { success: true, data: locale }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:set-manual-territory-price',
    async (_event, projectId: string, iapId: string, territory: string, pricePointId: string) => {
      try {
        await setManualTerritoryPrice(projectId, iapId, territory, pricePointId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('apple:sync-base-price', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapAllTerritoryPrices(projectId, iapId)
      if (data.basePrice) {
        const db = getDatabase()
        db.prepare('UPDATE apple_products SET base_price = ?, base_currency = ? WHERE id = ?')
          .run(data.basePrice, data.baseCurrency, iapId)
      }
      return { success: true, data: { basePrice: data.basePrice, baseCurrency: data.baseCurrency } }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:export-products',
    async (event, projectId: string, products: ExportProductInput[]) => {
      try {
        if (!products || products.length === 0) {
          return { success: false, error: '沒有可匯出的商品' }
        }

        const win = BrowserWindow.fromWebContents(event.sender)
        const creds = loadCredentials(projectId)
        const appId = creds.apple?.appId || 'unknown'

        const saveResult = await dialog.showSaveDialog(win!, {
          title: '匯出 Apple IAP',
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
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:import-validate',
    async (
      _event,
      projectId: string,
      fileContent: string,
      existingProductIds: string[]
    ) => {
      try {
        const preview = await validateImport(projectId, fileContent, existingProductIds)
        return { success: true, data: preview }
      } catch (e: any) {
        return { success: false, error: e.message }
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
          return { success: false, error: '沒有可匯入的商品' }
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
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('apple:get-all-territory-prices', async (_event, projectId: string, iapId: string) => {
    try {
      const data = await getIapAllTerritoryPrices(projectId, iapId)
      // Cache base price to local DB
      if (data.basePrice) {
        const db = getDatabase()
        db.prepare('UPDATE apple_products SET base_price = ?, base_currency = ? WHERE id = ?')
          .run(data.basePrice, data.baseCurrency, iapId)
      }
      return { success: true, data }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Google Products ──

  ipcMain.handle('google:fetch-products', async (event, projectId: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.send('sync:progress', { current: 0, total: 0, phase: '正在從 Google Play 同步...' })
      const products = await listOneTimeProducts(projectId)
      win?.webContents.send('sync:progress', { current: products.length, total: products.length, phase: `已取得 ${products.length} 個商品` })
      // Cache to local DB
      const db = getDatabase()
      const now = new Date().toISOString()
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO google_products (id, project_id, product_id, name, description, status, purchase_option_id, sort_order, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const tx = db.transaction(() => {
        let idx = 0
        for (const p of products) {
          upsert.run(p.productId, projectId, p.productId, p.name, p.description, p.status, p.purchaseOptionId || null, idx++, now)
        }
      })
      tx()

      return {
        success: true,
        data: products.map((p) => ({ ...p, syncedAt: now }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
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
          syncedAt: r.synced_at
        }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'google:create-product',
    async (_event, projectId: string, data: { productId: string; name: string; description: string }) => {
      try {
        const product = await createOneTimeProduct(projectId, data)
        return { success: true, data: product }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'google:batch-status',
    async (_event, projectId: string, productIds: string[], active: boolean, products: any[]) => {
      try {
        const result = await googleBatchUpdateStatus(projectId, productIds, active, products)
        return { success: true, data: result }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )
}
